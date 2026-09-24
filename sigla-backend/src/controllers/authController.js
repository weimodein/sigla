const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const {
  Administrator,
  EmailVerification,
  RevokedAuthToken,
} = require("../models/index.js");
const {
  sendVerificationCode,
  sendPasswordChangedNotice,
} = require("../utils/mailer.js");
const { logActivity } = require("../utils/activityLogger.js");
const {
  validateEmail,
  validatePassword,
  isPasswordWithinBcryptLimit,
  normalizeEmail,
} = require("../utils/validators.js");
require("dotenv").config();

// ── Helper: generate 6-digit code ────────────────────────────
const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// 0 = super administrator, 1 = administrator. These are the only valid roles;
// the administrators table is exclusive to admin accounts. Shared by login()
// and getMe() so both return the same role string for a given role_id.
const ROLE_MAP = { 0: "super_admin", 1: "admin" };

// The administrator object sent to the client, built in one place so login() and
// getMe() cannot disagree.
//
// They used to disagree: login() listed its fields by hand and omitted `status`,
// while getMe() spread the whole row. The admin UI reads `status` for the Account
// Status field, so it rendered blank right after signing in and only filled in
// after a page refresh happened to call getMe().
//
// An explicit allow-list rather than a spread — getMe() previously leaked
// failed_login_attempts, lockout_until and lockout_count to the browser, where
// AuthContext writes them into localStorage. Those are internal security state,
// and nothing in the client reads them.
const toAdministratorDTO = (admin, roleName) => ({
  id: admin.id,
  username: admin.username,
  email: admin.email,
  role: roleName ?? ROLE_MAP[admin.role_id],
  status: admin.status,
  created_at: admin.created_at,
  must_complete_setup: admin.must_complete_setup,
});

// How long a VERIFIED reset code stays spendable. Long enough to choose and
// confirm a password, short enough that a leaked/abandoned grant is not a
// standing takeover path.
const RESET_GRANT_TTL_MS = 15 * 60 * 1000;

// ── Credential-failure policy ─────────────────────────────────
// One message and one status code for EVERY failed sign-in, whatever the real
// reason — unknown identifier, wrong password, locked, deactivated, deleted.
//
// Any variation is a username-enumeration oracle: this endpoint used to append
// "N attempt(s) remaining before the account is locked" only for identifiers
// that existed, and to answer 429 instead of 401 once an account was locked.
// Either difference lets an attacker run a wordlist, one guess per name, and
// keep the hits — a confirmed list of admin accounts to spray or phish. The
// countdown also disclosed the lockout threshold.
//
// forgotPassword() already follows this policy; login() now matches it.
// The real reason is still logged server-side, it just never reaches the client.
const INVALID_CREDENTIALS = "Invalid credentials";

// Compared against when the identifier does not exist, so that path pays the
// same bcrypt cost as a real one. Without it the response body can be identical
// and the endpoint still enumerates accounts: a miss returns at DB speed while a
// hit spends ~100ms hashing. The plaintext is a random 32-byte value that was
// discarded at generation time — nothing can match this hash. Cost factor 10
// matches the stored hashes (bcrypt.hash(password, 10) in administratorController).
const DUMMY_PASSWORD_HASH =
  "$2b$10$5PYEi7TsV/RjRjNphCApvuHfVtHzJ2q0JtNeMFmv9AtMzkSBylstC";

// ── Helper: generate JWT ──────────────────────────────────────
const generateToken = ({ id, role_name, status }) =>
  jwt.sign(
    { id, role: role_name, status },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );

// ── Helper: get latest valid verification record ──────────────
const getLatestVerification = async (email, type) => {
  return await EmailVerification.findOne({
    where: {
      email,
      type,
      is_used: false,
      session_invalidated: false,
      expires_at: { [Op.gt]: new Date() },
    },
    order: [["created_at", "DESC"]],
  });
};

// ── POST /api/auth/resend-code ────────────────────────────────
const resendCode = async (req, res) => {
  try {
    const { email, type } = req.body;

    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({ message: emailError });
    }
    if (type !== "password_reset") {
      return res.status(400).json({ message: "Invalid verification type" });
    }
    const normalizedEmail = normalizeEmail(email);

    const user = await Administrator.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(200).json({ message: "If that email exists, a code has been sent" });
    }

    // Check 1-minute cooldown
    const recent = await EmailVerification.findOne({
      where: {
        email: normalizedEmail,
        type,
        last_sent_at: { [Op.gt]: new Date(Date.now() - 60 * 1000) },
      },
      order: [["created_at", "DESC"]],
    });
    if (recent) {
      return res.status(429).json({
        message: "Please wait 1 minute before requesting a new code",
      });
    }

    // Invalidate previous codes
    await EmailVerification.update(
      { session_invalidated: true },
      { where: { email: normalizedEmail, type, is_used: false } },
    );

    // Send fresh code — valid for 5 minutes
    const code = generateCode();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    await EmailVerification.create({
      administrator_id: user.id,
      email: normalizedEmail,
      code,
      type,
      expires_at: expires,
      attempt_count: 0,
      session_invalidated: false,
      last_sent_at: new Date(),
    });

    res.status(200).json({ message: "New verification code sent" });

    sendVerificationCode(normalizedEmail, code, type).catch((err) =>
      console.error("Failed to resend code to", normalizedEmail, err)
    );
  } catch (err) {
    console.error("Resend code error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// NOTE: Public self-registration (register / verify-email / set-password) has
// been removed. Administrator accounts are created only by the super
// administrator via the Manage Administrators module.

// ── POST /api/auth/login ──────────────────────────────────────
// Accepts email OR username via identifier field
const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (
      typeof identifier !== "string" ||
      !identifier.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res
        .status(400)
        .json({ message: "Email/username and password are required" });
    }
    const normalizedIdentifier = identifier.includes("@")
      ? normalizeEmail(identifier)
      : identifier.trim();

    // bcrypt ignores bytes after its 72-byte input boundary. Reject oversized
    // login inputs so truncated candidates can never authenticate.
    if (!isPasswordWithinBcryptLimit(password)) {
      return res.status(401).json({ message: INVALID_CREDENTIALS });
    }

    const user = await Administrator.findOne({
      where: {
        [Op.or]: [{ email: normalizedIdentifier }, { username: normalizedIdentifier }],
      },
    });

    // ── Login lockout (scope §13) ──────────────────────────────
    // 5 consecutive failures → temporary lock; cooldown grows by 5 min each
    // additional 5-failure cycle. A successful login resets everything.
    const LOCK_THRESHOLD = 5;      // failures per lock cycle
    const LOCK_STEP_MIN = 5;       // minutes added per lock cycle
    const now = new Date();

    // Already locked? Reject before checking the password, and without counting
    // the attempt — otherwise hammering a locked account would keep extending
    // its own lock.
    if (user && user.lockout_until && now < new Date(user.lockout_until)) {
      console.warn(`Login blocked: account "${user.username}" is locked out`);
      return res.status(401).json({ message: INVALID_CREDENTIALS });
    }

    // Deliberately NOT short-circuited when `user` is null — the dummy hash
    // keeps the unknown-identifier path at the same cost. See
    // DUMMY_PASSWORD_HASH above.
    const isMatch = await bcrypt.compare(
      password,
      user ? user.password : DUMMY_PASSWORD_HASH,
    );

    if (!user || !isMatch) {
      // Nothing to count for an identifier that does not exist.
      if (user) {
        const attempts = (user.failed_login_attempts || 0) + 1;

        // Every LOCK_THRESHOLD consecutive failures triggers a lock with an
        // incrementing cooldown.
        if (attempts % LOCK_THRESHOLD === 0) {
          const lockCount = (user.lockout_count || 0) + 1;
          const cooldownMin = LOCK_STEP_MIN * lockCount;
          const until = new Date(now.getTime() + cooldownMin * 60000);
          await user.update({
            failed_login_attempts: attempts,
            lockout_count: lockCount,
            lockout_until: until,
          });
          console.warn(
            `Account "${user.username}" locked for ${cooldownMin} minute(s) after ${attempts} failed attempts`,
          );
        } else {
          await user.update({ failed_login_attempts: attempts });
        }
      }

      return res.status(401).json({ message: INVALID_CREDENTIALS });
    }

    // Correct password, but the account may not be usable. Same generic
    // response — the reason must not distinguish a real account from a miss.
    if (user.status === "deactivated" || user.status === "deleted") {
      console.warn(
        `Login blocked: account "${user.username}" has status "${user.status}"`,
      );
      return res.status(401).json({ message: INVALID_CREDENTIALS });
    }

    // Successful auth — fully reset the lockout state.
    if (user.failed_login_attempts || user.lockout_until || user.lockout_count) {
      await user.update({
        failed_login_attempts: 0,
        lockout_until: null,
        lockout_count: 0,
      });
    }

    const roleName = ROLE_MAP[user.role_id];

    // An unmapped role_id means corrupt data. Fail loudly rather than silently
    // downgrading the account to a role that cannot access anything.
    if (!roleName) {
      console.error(
        `Login blocked: unmapped role_id ${user.role_id} for "${user.username}"`,
      );
      return res.status(403).json({
        message: "Account role is invalid. Contact your administrator.",
      });
    }

    const token = generateToken({
      id: user.id,
      role_name: roleName,
      status: user.status,
    });

    // Audit sign-ins for admin and super-admin accounts.
    if (roleName === "admin" || roleName === "super_admin") {
      await logActivity({
        administrator_id: user.id,
        action: "signed_in",
        target_type: "administrator",
        target_id: user.id,
        details: `${user.username} signed in`,
      });
    }

    return res.status(200).json({
      message: "Login successful",
      token,
      administrator: toAdministratorDTO(user, roleName),
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/auth/forgot-password ───────────────────────────
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({ message: emailError });
    }
    const normalizedEmail = normalizeEmail(email);

    const user = await Administrator.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      // Don't reveal if email exists
      return res
        .status(200)
        .json({ message: "If that email exists, a code has been sent" });
    }

    // Check 1-minute resend cooldown
    const recent = await EmailVerification.findOne({
      where: {
        email: normalizedEmail,
        type: "password_reset",
        last_sent_at: { [Op.gt]: new Date(Date.now() - 60 * 1000) },
      },
      order: [["created_at", "DESC"]],
    });
    if (recent) {
      return res.status(429).json({
        message: "Please wait 1 minute before requesting a new code",
      });
    }

    // Invalidate previous reset codes
    await EmailVerification.update(
      { session_invalidated: true },
      { where: { email: normalizedEmail, type: "password_reset", is_used: false } },
    );

    // Send fresh code — valid for 5 minutes
    const code = generateCode();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    await EmailVerification.create({
      administrator_id: user.id,
      email: normalizedEmail,
      code,
      type: "password_reset",
      expires_at: expires,
      attempt_count: 0,
      session_invalidated: false,
      last_sent_at: new Date(),
    });

    res.status(200).json({ message: "If that email exists, a code has been sent" });

    sendVerificationCode(normalizedEmail, code, "password_reset").catch((err) =>
      console.error("Failed to send password reset code to", normalizedEmail, err)
    );
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/auth/verify-reset-code ─────────────────────────
const verifyResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({ message: emailError });
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "Enter a valid 6-digit verification code" });
    }
    const normalizedEmail = normalizeEmail(email);

    const record = await getLatestVerification(normalizedEmail, "password_reset");

    if (!record) {
      return res
        .status(400)
        .json({ message: "Invalid or expired verification code" });
    }

    if (record.code !== code) {
      const newAttemptCount = record.attempt_count + 1;

      if (newAttemptCount >= 5) {
        await record.update({
          attempt_count: newAttemptCount,
          session_invalidated: true,
        });
        return res.status(400).json({
          message:
            "Maximum attempts exceeded. Please request a new verification code.",
          session_invalidated: true,
        });
      }

      await record.update({ attempt_count: newAttemptCount });
      return res.status(400).json({
        message: `Incorrect code. ${5 - newAttemptCount} attempt(s) remaining.`,
        attempts_remaining: 5 - newAttemptCount,
      });
    }

    // Verifying the code opens a fresh, short window in which the new password
    // may be set. Without extending expires_at the grant would inherit the
    // 5-minute deadline of the code itself, counted from when it was SENT — so a
    // user who took a few minutes to choose a password would be rejected at the
    // final step. resetPassword requires this window to still be open, which is
    // what stops a verified row from being replayable forever.
    await record.update({
      is_used: true,
      expires_at: new Date(Date.now() + RESET_GRANT_TTL_MS),
    });

    return res
      .status(200)
      .json({ message: "Code verified. You may now reset your password." });
  } catch (err) {
    console.error("Verify reset code error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/auth/reset-password ────────────────────────────
const resetPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({ message: emailError });
    }
    const normalizedEmail = normalizeEmail(email);

    // Enforce the password rule (scope §13/§21): ≥8 chars, ≥1 letter, ≥1 number.
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    // A verified code is a ONE-TIME, TIME-LIMITED grant.
    //
    // This route is public, so its only gate is this record. Matching on
    // `is_used: true` alone — with no expiry and no consumption — meant that any
    // account which had ever completed one reset stayed permanently resettable
    // by anyone who knew its email address: POST {email, password} and the
    // account was taken over, no code and no login required. The same verified
    // row could also be replayed indefinitely.
    //
    // Three conditions close that: the row must still be within its expiry
    // window, must not already have been consumed (session_invalidated), and is
    // consumed below the moment it is spent.
    const verified = await EmailVerification.findOne({
      where: {
        email: normalizedEmail,
        type: "password_reset",
        is_used: true,
        session_invalidated: false,
        expires_at: { [Op.gt]: new Date() },
      },
      order: [["created_at", "DESC"]],
    });

    if (!verified) {
      return res.status(400).json({
        message:
          "Reset code not verified, already used, or expired. Request a new code.",
      });
    }

    // Consume it BEFORE changing the password, so a failure later cannot leave a
    // spent grant reusable.
    await verified.update({ session_invalidated: true });

    // Load the row rather than bulk-updating by email: the audit entry needs an
    // administrator_id, and the notice needs a username.
    const user = await Administrator.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      // A verified reset record exists but the account is gone. Respond exactly
      // as the success case does — this must not become an enumeration oracle.
      return res.status(200).json({ message: "Password reset successfully" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await user.update({ password: hashedPassword });

    // This path previously left no trace at all — no email and no log — despite
    // being the only account change reachable without being signed in.
    await logActivity({
      administrator_id: user.id,
      action: "password_reset_completed",
      target_type: "administrator",
      target_id: user.id,
      details: "Password reset completed via emailed verification code",
    });

    // Non-fatal: the password is already changed, so a mail outage must not
    // report the reset as failed.
    try {
      await sendPasswordChangedNotice({
        to: user.email,
        adminUsername: user.username,
        actor: "self",
      });
    } catch (err) {
      console.error(
        `Failed to send password-changed notice to ${user.email}:`,
        err.message,
      );
    }

    return res.status(200).json({ message: "Password reset successfully" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/auth/me ──────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const administrator = await Administrator.findOne({
      where: { id: req.user.id },
      attributes: { exclude: ["password"] },
    });

    if (!administrator) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    // The raw row carries role_id only; the DTO maps it to the same role string
    // login() returns, so a session restored via getMe() keeps its role (and
    // isSuper). It also trims the row to the fields the client actually uses.
    return res.status(200).json({
      administrator: toAdministratorDTO(administrator),
    });
  } catch (err) {
    console.error("Get me error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/auth/logout
// JWTs are otherwise valid until their expiry even after the browser deletes
// its local copy. Recording the current token's hash closes that window without
// storing the bearer credential itself or signing every device out at once.
const logout = async (req, res) => {
  try {
    await RevokedAuthToken.findOrCreate({
      where: { token_hash: req.authTokenHash },
      defaults: {
        administrator_id: req.user.id,
        expires_at: new Date(req.user.exp * 1000),
      },
    });

    // Expired entries can no longer match a JWT accepted by jwt.verify(). Keep
    // cleanup non-fatal because the current token has already been revoked.
    RevokedAuthToken.destroy({
      where: { expires_at: { [Op.lte]: new Date() } },
    }).catch((err) => console.error("Revoked-token cleanup error:", err));

    try {
      await logActivity({
        administrator_id: req.user.id,
        action: "signed_out",
        target_type: "administrator",
        target_id: req.user.id,
        details: "Administrator signed out",
      });
    } catch (err) {
      console.error("Sign-out audit error:", err);
    }

    return res.status(200).json({ message: "Signed out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ message: "Unable to sign out securely" });
  }
};

module.exports = {
  verifyResetCode,
  login,
  forgotPassword,
  resetPassword,
  resendCode,
  getMe,
  logout,
};
