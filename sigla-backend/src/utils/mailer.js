const { BrevoClient } = require("@getbrevo/brevo");
require("dotenv").config();

const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

const sendVerificationCode = async (email, code, type) => {
  const subject =
    type === "registration" || type === "email_change"
      ? "SIGLA — Email Verification Code"
      : "SIGLA — Password Reset Code";

  const action =
    type === "registration"
      ? "complete your registration"
      : type === "email_change"
        ? "verify your email address"
        : "reset your password";

  await client.transactionalEmails.sendTransacEmail({
    sender: {
      name: process.env.MAIL_FROM_NAME || "SIGLA",
      email: process.env.MAIL_FROM_EMAIL || "noreply@sigla.app",
    },
    to: [{ email }],
    subject,
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 32px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #1A237E; text-align: center;">SIGLA</h2>
        <p>Hello,</p>
        <p>Use the verification code below to ${action}:</p>
        <div style="text-align: center; margin: 32px 0;">
          <span style="font-size: 40px; font-weight: bold; letter-spacing: 12px; color: #1A237E;">
            ${code}
          </span>
        </div>
        <p>This code expires in <strong>5 minutes</strong>.</p>
        <p>If you did not request this, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">
          SIGLA — Sign Language Translator Application
        </p>
      </div>
    `,
  });
};

module.exports = { sendVerificationCode };
