const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const { Administrator, EmailVerification } = require("../models/index.js");
const {
  sendVerificationCode,
  sendPasswordChangedNotice,
} = require("../utils/mailer.js");
const { logActivity } = require("../utils/activityLogger.js");
const { validatePassword } = require("../utils/validators.js");
require("dotenv").config();

// ── Helper: generate 6-digit code ────────────────────────────
const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// 0 = super administrator, 1 = administrator. These are the only valid roles;
// the administrators table is exclusive to admin accounts. Shared by login()
// and getMe() so both return the same role string for a given role_id.
const ROLE_MAP = { 0: "super_admin", 1: "admin" };

// How long a VERIFIED reset code stays spendable. Long enough to choose and
// confirm a password, short enough that a leaked/abandoned grant is not a
// standing takeover path.
const RESET_GRANT_TTL_MS = 15 * 60 * 1000;

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

    if (!email || !type) {
      return res.status(400).json({ message: "Email and type are required" });
    }

    // Check 1-minute cooldown
    const recent = await EmailVerification.findOne({
      where: {
        email,
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
      { where: { email, type, is_used: false } },
    );

    // Send fresh code — valid for 5 minutes
    const code = generateCode();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    await EmailVerification.create({
      email,
      code,
      type,
      expires_at: expires,
      attempt_count: 0,
      session_invalidated: false,
      last_sent_at: new Date(),
    });

    res.status(200).json({ message: "New verification code sent" });

    sendVerificationCode(email, code, type).catch((err) =>
      console.error("Failed to resend code to", email, err)
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

    if (!identifier || !password) {
      return res
        .status(400)
        .json({ message: "Email/username and password are required" });
    }

    const user = await Administrator.findOne({
      where: {
        [Op.or]: [{ email: identifier }, { username: identifier }],
      },
    });

    // Generic response for unknown accounts — no tracking possible, and avoids
    // revealing whether an identifier exists.
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ── Login lockout (scope §13) ──────────────────────────────
    // 5 consecutive failures → temporary lock; cooldown grows by 5 min each
    // additional 5-failure cycle. A successful login resets everything.
    const LOCK_THRESHOLD = 5;      // failures per lock cycle
    const LOCK_STEP_MIN = 5;       // minutes added per lock cycle
    const now = new Date();

    // Already locked? Block before checking the password.
    if (user.lockout_until && now < new Date(user.lockout_until)) {
      const minsLeft = Math.ceil((new Date(user.lockout_until) - now) / 60000);
      return res.status(429).json({
        message: `Account temporarily locked due to multiple failed login attempts. Try again in ${minsLeft} minute(s).`,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
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
        return res.status(429).json({
          message: `Account temporarily locked after ${LOCK_THRESHOLD} failed attempts. Try again in ${cooldownMin} minute(s).`,
        });
      }

      await user.update({ failed_login_attempts: attempts });
      const remaining = LOCK_THRESHOLD - (attempts % LOCK_THRESHOLD);
      return res.status(401).json({
        message: `Invalid credentials. ${remaining} attempt(s) remaining before the account is locked.`,
      });
    }

    if (user.status === "deactivated") {
      return res.status(403).json({ message: "Account has been deactivated" });
    }
    if (user.status === "deleted") {
      return res.status(403).json({ message: "Account no longer exists" });
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
      administrator: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: roleName,
        created_at: user.created_at,
        must_complete_setup: user.must_complete_setup,
      },
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

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await Administrator.findOne({ where: { email } });
    if (!user) {
      // Don't reveal if email exists
      return res
        .status(200)
        .json({ message: "If that email exists, a code has been sent" });
    }

    // Check 1-minute resend cooldown
    const recent = await EmailVerification.findOne({
      where: {
        email,
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
      { where: { email, type: "password_reset", is_used: false } },
    );

    // Send fresh code — valid for 5 minutes
    const code = generateCode();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    await EmailVerification.create({
      administrator_id: user.id,
      email,
      code,
      type: "password_reset",
      expires_at: expires,
      attempt_count: 0,
      session_invalidated: false,
      last_sent_at: new Date(),
    });

    res.status(200).json({ message: "If that email exists, a code has been sent" });

    sendVerificationCode(email, code, "password_reset").catch((err) =>
      console.error("Failed to send password reset code to", email, err)
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

    if (!email || !code) {
      return res.status(400).json({ message: "Email and code are required" });
    }

    const record = await getLatestVerification(email, "password_reset");

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

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

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
        email,
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
    const user = await Administrator.findOne({ where: { email } });
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

    // The raw row carries role_id only. Map it to the same role string login()
    // returns, so a session restored via getMe() keeps its role (and isSuper).
    return res.status(200).json({
      administrator: {
        ...administrator.toJSON(),
        role: ROLE_MAP[administrator.role_id],
      },
    });
  } catch (err) {
    console.error("Get me error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  verifyResetCode,
  login,
  forgotPassword,
  resetPassword,
  resendCode,
  getMe,
};
