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

// ── Notification emails ───────────────────────────────────────
//
// Unlike sendVerificationCode above, these carry no code and require no action
// — they exist so an administrator always learns when the super administrator
// changed their account. Callers MUST catch failures: a mail outage must never
// roll back a change that was already saved.

const FROM = () => ({
  name: process.env.MAIL_FROM_NAME || "SIGLA",
  email: process.env.MAIL_FROM_EMAIL || "noreply@sigla.app",
});

// Shared card shell so every notice matches the verification email above.
const noticeShell = (bodyHtml) => `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 32px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #1A237E; text-align: center;">SIGLA</h2>
        ${bodyHtml}
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">
          SIGLA — Sign Language Translator Application
        </p>
      </div>
    `;

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// Tells an administrator their username and/or email was changed for them.
//
// `changes` is a list of { field, from, to }. When the email address itself
// changed this is sent to BOTH the old and the new address: the old address is
// the only way the affected person finds out about a change they did not make.
const sendAccountChangeNotice = async ({ to, adminUsername, changes = [] }) => {
  if (!to || changes.length === 0) return;

  const rows = changes
    .map(
      ({ field, from, to: next }) => `
          <tr>
            <td style="padding: 6px 12px 6px 0; color: #555; text-transform: capitalize;">${escapeHtml(field)}</td>
            <td style="padding: 6px 0; color: #999; text-decoration: line-through;">${escapeHtml(from) || "(not set)"}</td>
            <td style="padding: 6px 12px; color: #999;">&rarr;</td>
            <td style="padding: 6px 0; color: #1A237E; font-weight: bold;">${escapeHtml(next) || "(not set)"}</td>
          </tr>`,
    )
    .join("");

  await client.transactionalEmails.sendTransacEmail({
    sender: FROM(),
    to: [{ email: to }],
    subject: "SIGLA — Your Account Details Were Updated",
    htmlContent: noticeShell(`
        <p>Hello ${escapeHtml(adminUsername)},</p>
        <p>The super administrator updated your SIGLA administrator account:</p>
        <table style="margin: 24px 0; font-size: 14px; border-collapse: collapse;">
          ${rows}
        </table>
        <p>You do not need to do anything. If you did not expect this change,
        contact the super administrator immediately.</p>
      `),
  });
};

// Tells an administrator their password was reset for them.
//
// Deliberately does NOT contain the temporary password: it is handed over
// out-of-band, and email is exactly the channel that may be compromised in the
// situation where a reset was needed.
const sendTemporaryPasswordNotice = async ({ to, adminUsername }) => {
  if (!to) return;

  await client.transactionalEmails.sendTransacEmail({
    sender: FROM(),
    to: [{ email: to }],
    subject: "SIGLA — Your Password Was Reset",
    htmlContent: noticeShell(`
        <p>Hello ${escapeHtml(adminUsername)},</p>
        <p>The super administrator reset the password on your SIGLA
        administrator account. Your previous password no longer works.</p>
        <p>The super administrator will give you a temporary password directly.
        It is not included in this email. When you sign in with it, you will be
        asked to choose your own username and password before you can continue.</p>
        <p>If you did not expect this, contact the super administrator immediately.</p>
      `),
  });
};

module.exports = {
  sendVerificationCode,
  sendAccountChangeNotice,
  sendTemporaryPasswordNotice,
};
