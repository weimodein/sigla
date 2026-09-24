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

// Who made the change. Deliberately role-only — never a username: these notices
// land in an inbox that may itself be compromised, and "the super administrator"
// is all the recipient needs to know whether to be alarmed.
const actorPhrase = (actor) =>
  actor === "self" ? "You updated" : "The super administrator updated";

// Closing line: a self-service change the recipient did not make is the signal
// that their session or inbox is compromised.
const actorFooter = (actor) =>
  actor === "self"
    ? "If this wasn't you, contact the super administrator immediately."
    : "You do not need to do anything. If you did not expect this change, contact the super administrator immediately.";

// Tells an administrator their username and/or email was changed.
//
// `changes` is a list of { field, from, to }. When the email address itself
// changed this is sent to BOTH the old and the new address: the old address is
// the only way the affected person finds out about a change they did not make.
const sendAccountChangeNotice = async ({
  to,
  adminUsername,
  changes = [],
  actor = "super_admin",
}) => {
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
        <p>${actorPhrase(actor)} your SIGLA administrator account:</p>
        <table style="margin: 24px 0; font-size: 14px; border-collapse: collapse;">
          ${rows}
        </table>
        <p>${actorFooter(actor)}</p>
      `),
  });
};

// Tells an administrator their password was changed — by them, through the
// forgot-password flow or their own account settings.
//
// Carries no password and no code. Distinct from sendTemporaryPasswordNotice
// below, whose wording is specific to a super-administrator hand-over.
const sendPasswordChangedNotice = async ({ to, adminUsername, actor = "self" }) => {
  if (!to) return;

  const opening =
    actor === "self"
      ? "Your SIGLA administrator password was just changed."
      : "The super administrator changed the password on your SIGLA administrator account.";

  await client.transactionalEmails.sendTransacEmail({
    sender: FROM(),
    to: [{ email: to }],
    subject: "SIGLA — Your Password Was Changed",
    htmlContent: noticeShell(`
        <p>Hello ${escapeHtml(adminUsername)},</p>
        <p>${opening}</p>
        <p>If you made this change, no action is needed. If you did not, your
        account may be compromised — contact the super administrator immediately.</p>
      `),
  });
};

// Tells an administrator their account was suspended, restored, or removed.
// One function for all three so the wording stays consistent.
const sendAccountStatusNotice = async ({ to, adminUsername, status }) => {
  if (!to) return;

  const copy = {
    deactivated: {
      subject: "SIGLA — Your Account Was Deactivated",
      body: `<p>The super administrator deactivated your SIGLA administrator
        account. You will not be able to sign in until it is reactivated.</p>`,
    },
    active: {
      subject: "SIGLA — Your Account Was Reactivated",
      body: `<p>The super administrator reactivated your SIGLA administrator
        account. You can sign in again with your existing credentials.</p>`,
    },
    deleted: {
      subject: "SIGLA — Your Account Was Removed",
      body: `<p>The super administrator removed your SIGLA administrator
        account. You will no longer be able to sign in.</p>`,
    },
  }[status];

  // An unrecognised status is a programming error, not something to guess at.
  if (!copy) return;

  await client.transactionalEmails.sendTransacEmail({
    sender: FROM(),
    to: [{ email: to }],
    subject: copy.subject,
    htmlContent: noticeShell(`
        <p>Hello ${escapeHtml(adminUsername)},</p>
        ${copy.body}
        <p>If you have questions about this change, contact the super
        administrator.</p>
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
  sendPasswordChangedNotice,
  sendAccountStatusNotice,
  sendTemporaryPasswordNotice,
};
