const { Administrator } = require("../models/index.js");
const {
  sendVerificationCode,
  sendAccountChangeNotice,
} = require("../utils/mailer.js");
const { logActivity } = require("../utils/activityLogger.js");
const { validateEmail, normalizeEmail } = require("../utils/validators.js");

const {
  getLatestVerification,
  issueVerificationCode,
  recordWrongAttempt,
} = require("../utils/verificationCodes.js");

const TYPE = "email_change";
// ── POST /api/administrators/email/request-code ────────────────────────
// Authenticated. Sends a 6-digit code to the NEW email the caller wants to
// add/link, proving they control that address before it's saved.
const requestEmailCode = async (req, res) => {
  try {
    const { email } = req.body;

    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({ message: emailError });
    }
    const normalizedEmail = normalizeEmail(email);

    // Reject if the email is already linked to a different account.
    const existing = await Administrator.findOne({
      where: { email: normalizedEmail },
    });
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ message: "Email already in use" });
    }
    if (existing && existing.id === req.user.id) {
      return res
        .status(400)
        .json({ message: "This email is already linked to your account" });
    }

    const issued = await issueVerificationCode({
      email: normalizedEmail,
      type: TYPE,
      administratorId: req.user.id,
    });
    if (issued.cooldown) {
      return res.status(429).json({
        message: "Please wait 1 minute before requesting a new code",
      });
    }
    const { code } = issued;

    res.status(200).json({
      message: "Verification code sent to email",
      email: normalizedEmail,
    });

    sendVerificationCode(normalizedEmail, code, TYPE).catch((err) =>
      console.error("Failed to send email-change code to", normalizedEmail, err.message),
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

    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({ message: emailError });
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "Enter a valid 6-digit verification code" });
    }
    const normalizedEmail = normalizeEmail(email);

    const record = await getLatestVerification(normalizedEmail, TYPE);
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
      return res.status(400).json(await recordWrongAttempt(record));
    }

    // Correct — re-check uniqueness at commit time, then link the email.
    const taken = await Administrator.findOne({
      where: { email: normalizedEmail },
    });
    if (taken && taken.id !== req.user.id) {
      return res.status(409).json({ message: "Email already in use" });
    }

    // Read the current address BEFORE the update below overwrites it — once
    // written, the old address is unrecoverable and can no longer be warned.
    const account = await Administrator.findByPk(req.user.id, {
      attributes: ["id", "username", "email"],
    });
    const previousEmail = account ? account.email : null;

    await record.update({ is_used: true });
    await Administrator.update(
      { email: normalizedEmail },
      { where: { id: req.user.id } },
    );

    await logActivity({
      administrator_id: req.user.id,
      action: "updated_admin",
      target_type: "administrator",
      target_id: req.user.id,
      details: previousEmail
        ? `Changed own email address (verified): "${previousEmail}" → "${normalizedEmail}"`
        : `Linked own email address (verified): "${normalizedEmail}"`,
    });

    // Tell BOTH addresses. Without the notice to the old one, someone who
    // reaches a signed-in session can move the address off the real owner
    // silently — the classic account-takeover path. A first-time link has no
    // old address, so only the new one is notified.
    //
    // Non-fatal: the address is already changed, so a mail outage must not
    // report the verification as failed.
    let notified = true;
    const targets = [...new Set([previousEmail, normalizedEmail].filter(Boolean))];
    for (const to of targets) {
      try {
        await sendAccountChangeNotice({
          to,
          adminUsername: account ? account.username : "administrator",
          changes: [{ field: "email", from: previousEmail, to: normalizedEmail }],
          actor: "self",
        });
      } catch (err) {
        notified = false;
        console.error(`Failed to send email-change notice to ${to}:`, err.message);
      }
    }

    return res.status(200).json({
      message: "Email verified and linked successfully",
      email: normalizedEmail,
      notified,
    });
  } catch (err) {
    console.error("Verify email code error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = { requestEmailCode, verifyEmailCode };
