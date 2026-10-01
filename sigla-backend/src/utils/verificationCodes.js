const { Op } = require("sequelize");
const { EmailVerification } = require("../models/index.js");

// Shared by password reset (authController) and email change (emailController).
// Both issue and check codes identically; only `type` and who owns the code
// differ. Each flow used to carry its own copy, and the two attempt limits were
// a named constant in one file and a bare 5 in the other.
const CODE_TTL_MS = 5 * 60 * 1000;    // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const MAX_ATTEMPTS = 5;

const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const getLatestVerification = (email, type) =>
  EmailVerification.findOne({
    where: {
      email,
      type,
      is_used: false,
      session_invalidated: false,
      expires_at: { [Op.gt]: new Date() },
    },
    order: [["created_at", "DESC"]],
  });

// { cooldown: true } when a code for this email+type went out within the last
// minute. Otherwise invalidates every earlier unused code and stores a fresh
// one, returning { code } for the caller to send.
const issueVerificationCode = async ({ email, type, administratorId }) => {
  const recent = await EmailVerification.findOne({
    where: {
      email,
      type,
      last_sent_at: { [Op.gt]: new Date(Date.now() - RESEND_COOLDOWN_MS) },
    },
    order: [["created_at", "DESC"]],
  });
  if (recent) return { cooldown: true };

  await EmailVerification.update(
    { session_invalidated: true },
    { where: { email, type, is_used: false } },
  );

  const code = generateCode();
  await EmailVerification.create({
    administrator_id: administratorId,
    email,
    code,
    type,
    expires_at: new Date(Date.now() + CODE_TTL_MS),
    attempt_count: 0,
    session_invalidated: false,
    last_sent_at: new Date(),
  });
  return { code };
};

// Counts one wrong guess against `record` and returns the 400 response body.
// The last allowed guess invalidates the session outright.
const recordWrongAttempt = async (record) => {
  const attempts = record.attempt_count + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await record.update({ attempt_count: attempts, session_invalidated: true });
    return {
      message: "Maximum attempts exceeded. Please request a new verification code.",
      session_invalidated: true,
    };
  }
  await record.update({ attempt_count: attempts });
  return {
    message: `Incorrect code. ${MAX_ATTEMPTS - attempts} attempt(s) remaining.`,
    attempts_remaining: MAX_ATTEMPTS - attempts,
  };
};

module.exports = {
  CODE_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_ATTEMPTS,
  generateCode,
  getLatestVerification,
  issueVerificationCode,
  recordWrongAttempt,
};
