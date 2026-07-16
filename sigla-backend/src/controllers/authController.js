const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const { User, EmailVerification } = require("../models/index.js");
const { sendVerificationCode } = require("../utils/mailer.js");
const { logActivity } = require("../utils/activityLogger.js");
require("dotenv").config();

// ── Helper: generate 6-digit code ────────────────────────────
const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

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
// been removed. Administrator accounts are created only by the master
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

    const user = await User.findOne({
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

    const ROLE_MAP = { 1: "admin", 2: "master_admin", 3: "user" };
    const roleName = ROLE_MAP[user.role_id] ?? "user";

    const token = generateToken({
      id: user.id,
      role_name: roleName,
      status: user.status,
    });

    // Audit sign-ins for admin and master-admin accounts.
    if (roleName === "admin" || roleName === "master_admin") {
      await logActivity({
        user_id: user.id,
        action: "signed_in",
        target_type: "user",
        target_id: user.id,
        details: `${user.username} signed in`,
      });
    }

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
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

    const user = await User.findOne({ where: { email } });
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
      user_id: user.id,
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

    await record.update({ is_used: true });

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
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include a letter and a number",
      });
    }

    const verified = await EmailVerification.findOne({
      where: { email, type: "password_reset", is_used: true },
      order: [["created_at", "DESC"]],
    });

    if (!verified) {
      return res
        .status(400)
        .json({ message: "Reset code not verified. Please verify first." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await User.update({ password: hashedPassword }, { where: { email } });

    return res.status(200).json({ message: "Password reset successfully" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/auth/me ──────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.user.id },
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ user });
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
