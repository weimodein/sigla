const { Op } = require("sequelize");
const { Administrator, EmailVerification } = require("../models/index.js");
const { sendVerificationCode } = require("../utils/mailer.js");
const { logActivity } = require("../utils/activityLogger.js");

const TYPE = "email_change";
const CODE_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const MAX_ATTEMPTS = 5;

const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const getLatestVerification = async (email) =>
  EmailVerification.findOne({
    where: {
      email,
      type: TYPE,
      is_used: false,
      session_invalidated: false,
      expires_at: { [Op.gt]: new Date() },
    },
    order: [["created_at", "DESC"]],
  });

// ── POST /api/administrators/email/request-code ────────────────────────
// Authenticated. Sends a 6-digit code to the NEW email the caller wants to
// add/link, proving they control that address before it's saved.
const requestEmailCode = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    // Basic email shape check (mirrors the model's isEmail validation)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Please enter a valid email address" });
    }

    // Reject if the email is already linked to a different account.
    const existing = await Administrator.findOne({ where: { email } });
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ message: "Email already in use" });
    }
    if (existing && existing.id === req.user.id) {
      return res
        .status(400)
        .json({ message: "This email is already linked to your account" });
    }

    // 1-minute resend cooldown
    const recent = await EmailVerification.findOne({
      where: {
        email,
        type: TYPE,
        last_sent_at: { [Op.gt]: new Date(Date.now() - RESEND_COOLDOWN_MS) },
      },
      order: [["created_at", "DESC"]],
    });
    if (recent) {
      return res
        .status(429)
        .json({ message: "Please wait 1 minute before requesting a new code" });
    }

    // Invalidate previous unused codes for this email
    await EmailVerification.update(
      { session_invalidated: true },
      { where: { email, type: TYPE, is_used: false } },
    );

    const code = generateCode();
    await EmailVerification.create({
      administrator_id: req.user.id,
      email,
      code,
      type: TYPE,
      expires_at: new Date(Date.now() + CODE_TTL_MS),
      attempt_count: 0,
      session_invalidated: false,
      last_sent_at: new Date(),
    });

    res.status(200).json({ message: "Verification code sent to email", email });

    sendVerificationCode(email, code, TYPE).catch((err) =>
      console.error("Failed to send email-change code to", email, err.message),
    );
  } catch (err) {
    console.error("Request email code error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/administrators/email/verify ──────────────────────────────
// Authenticated. Verifies the 6-digit code and links the email to the caller.
const verifyEmailCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ message: "Email and code are required" });
    }

    const record = await getLatestVerification(email);
    if (!record) {
      return res
        .status(400)
        .json({ message: "Invalid or expired verification code" });
    }
    // The code must belong to the caller's own request.
    if (record.administrator_id !== req.user.id) {
      return res.status(403).json({ message: "This code is not for your account" });
    }

    if (record.code !== code) {
      const newAttemptCount = record.attempt_count + 1;
      if (newAttemptCount >= MAX_ATTEMPTS) {
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
        message: `Incorrect code. ${MAX_ATTEMPTS - newAttemptCount} attempt(s) remaining.`,
        attempts_remaining: MAX_ATTEMPTS - newAttemptCount,
      });
    }

    // Correct — re-check uniqueness at commit time, then link the email.
    const taken = await Administrator.findOne({ where: { email } });
    if (taken && taken.id !== req.user.id) {
      return res.status(409).json({ message: "Email already in use" });
    }

    await record.update({ is_used: true });
    await Administrator.update({ email }, { where: { id: req.user.id } });

    await logActivity({
      administrator_id: req.user.id,
      action: "updated_admin",
      target_type: "administrator",
      target_id: req.user.id,
      details: "Linked/updated own email address (verified)",
    });

    return res.status(200).json({ message: "Email verified and linked successfully", email });
  } catch (err) {
    console.error("Verify email code error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = { requestEmailCode, verifyEmailCode };
