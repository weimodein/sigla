const { BrevoClient } = require("@getbrevo/brevo");
require("dotenv").config();

const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

const BRAND = {
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
  background: "#f3f4f6",
  surface: "#ffffff",
  border: "#e5e7eb",
  text: "#1f2937",
  muted: "#6b7280",
};

const FROM = () => ({
  name: process.env.MAIL_FROM_NAME || "SIGLA",
  email: process.env.MAIL_FROM_EMAIL || "noreply@sigla.app",
});

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

const emailShell = ({ preheader, eyebrow, title, bodyHtml }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:${BRAND.background}; color:${BRAND.text};">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all;">
      ${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; background-color:${BRAND.background};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; max-width:600px;">
            <tr>
              <td style="height:6px; border-radius:14px 14px 0 0; background:${BRAND.primary}; background-image:linear-gradient(90deg, ${BRAND.primary}, ${BRAND.secondary} 60%, ${BRAND.accent}); font-size:0; line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:24px 36px; background:${BRAND.primary}; background-image:linear-gradient(135deg, ${BRAND.primary}, ${BRAND.secondary} 65%, ${BRAND.accent});">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="44" height="44" align="center" valign="middle" style="width:44px; height:44px; border:1px solid rgba(255,255,255,.35); border-radius:12px; background-color:rgba(255,255,255,.12); color:#ffffff; font-family:Arial,sans-serif; font-size:22px; font-weight:800;">S</td>
                    <td style="padding-left:14px; color:#ffffff; font-family:Arial,'Helvetica Neue',sans-serif;">
                      <div style="font-size:21px; line-height:26px; font-weight:800; letter-spacing:2px;">SIGLA</div>
                      <div style="font-size:12px; line-height:18px; color:#dbeafe;">Sign Language Translator Application</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:36px; border:1px solid ${BRAND.border}; border-top:0; background-color:${BRAND.surface}; font-family:Arial,'Helvetica Neue',sans-serif;">
                <div style="margin:0 0 8px; color:${BRAND.secondary}; font-size:12px; line-height:18px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase;">${escapeHtml(eyebrow)}</div>
                <h1 style="margin:0 0 22px; color:${BRAND.text}; font-size:26px; line-height:34px; font-weight:700; letter-spacing:-.3px;">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:22px 24px; border-radius:0 0 14px 14px; color:${BRAND.muted}; font-family:Arial,'Helvetica Neue',sans-serif; font-size:12px; line-height:18px;">
                This is an automated security message from SIGLA.<br />Please do not reply to this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const paragraph = (content, extraStyle = "") =>
  `<p style="margin:0 0 16px; color:${BRAND.text}; font-family:Arial,'Helvetica Neue',sans-serif; font-size:15px; line-height:24px; ${extraStyle}">${content}</p>`;

const securityNote = (content) => `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; margin-top:24px;">
    <tr>
      <td style="padding:14px 16px; border-left:4px solid ${BRAND.accent}; border-radius:8px; background-color:#eff6ff; color:#374151; font-family:Arial,'Helvetica Neue',sans-serif; font-size:13px; line-height:20px;">
        ${content}
      </td>
    </tr>
  </table>`;

const sendVerificationCode = async (email, code, type) => {
  const isPasswordReset = type === "password_reset";
  const subject = isPasswordReset
    ? "SIGLA | Password reset code"
    : "SIGLA | Email verification code";
  const title = isPasswordReset ? "Reset your password" : "Verify your email";
  const action =
    type === "registration"
      ? "complete your registration"
      : type === "email_change"
        ? "verify your email address"
        : "reset your password";
  const safeCode = escapeHtml(code);

  await client.transactionalEmails.sendTransacEmail({
    sender: FROM(),
    to: [{ email }],
    subject,
    htmlContent: emailShell({
      preheader: `Your SIGLA verification code is ${code}. It expires in 5 minutes.`,
      eyebrow: "Account security",
      title,
      bodyHtml: `
        ${paragraph("Hello,")}
        ${paragraph(`Use the code below to ${action}.`)}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; margin:26px 0;">
          <tr>
            <td align="center" style="padding:22px 12px; border:1px solid #bfdbfe; border-radius:12px; background-color:#eff6ff;">
              <div style="color:${BRAND.primary}; font-family:'Courier New',monospace; font-size:36px; line-height:44px; font-weight:700; letter-spacing:8px; white-space:nowrap;">${safeCode}</div>
              <div style="margin-top:7px; color:${BRAND.muted}; font-family:Arial,'Helvetica Neue',sans-serif; font-size:12px; line-height:18px;">Expires in 5 minutes</div>
            </td>
          </tr>
        </table>
        ${securityNote("If you did not request this code, you can safely ignore this email. Never share this code with anyone.")}
      `,
    }),
    textContent: `SIGLA ${title}\n\nYour verification code is: ${code}\n\nUse it to ${action}. This code expires in 5 minutes. Never share this code with anyone. If you did not request it, you can ignore this email.`,
  });
};

// Notification emails are intentionally non-blocking at their call sites: an
// email outage must never roll back an account change that was already saved.

// Who made the change. Deliberately role-only, never a username, because these
// notices may land in an inbox that has itself been compromised.
const actorPhrase = (actor) =>
  actor === "self" ? "You updated" : "The super administrator updated";

const actorFooter = (actor) =>
  actor === "self"
    ? "If this wasn't you, contact the super administrator immediately."
    : "No action is needed. If you did not expect this change, contact the super administrator immediately.";

const sendNotice = ({ to, subject, preheader, eyebrow, title, bodyHtml, textContent }) =>
  client.transactionalEmails.sendTransacEmail({
    sender: FROM(),
    to: [{ email: to }],
    subject,
    htmlContent: emailShell({ preheader, eyebrow, title, bodyHtml }),
    textContent,
  });

// Sent to both old and new addresses when the email address itself changes.
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
          <td style="padding:13px 14px; border-bottom:1px solid ${BRAND.border}; color:${BRAND.muted}; font-family:Arial,'Helvetica Neue',sans-serif; font-size:13px; font-weight:700; text-transform:capitalize;">${escapeHtml(field)}</td>
          <td style="padding:13px 14px; border-bottom:1px solid ${BRAND.border}; color:${BRAND.muted}; font-family:Arial,'Helvetica Neue',sans-serif; font-size:13px; word-break:break-word;">${escapeHtml(from) || "(not set)"}</td>
          <td style="padding:13px 6px; border-bottom:1px solid ${BRAND.border}; color:${BRAND.muted}; font-family:Arial,sans-serif; font-size:13px;">&rarr;</td>
          <td style="padding:13px 14px; border-bottom:1px solid ${BRAND.border}; color:${BRAND.primary}; font-family:Arial,'Helvetica Neue',sans-serif; font-size:13px; font-weight:700; word-break:break-word;">${escapeHtml(next) || "(not set)"}</td>
        </tr>`,
    )
    .join("");
  const textChanges = changes
    .map(({ field, from, to: next }) => `${field}: ${from || "(not set)"} -> ${next || "(not set)"}`)
    .join("\n");

  await sendNotice({
    to,
    subject: "SIGLA | Account details updated",
    preheader: "Details on your SIGLA administrator account were updated.",
    eyebrow: "Account update",
    title: "Your account details changed",
    bodyHtml: `
      ${paragraph(`Hello ${escapeHtml(adminUsername)},`)}
      ${paragraph(`${actorPhrase(actor)} your SIGLA administrator account:`)}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; margin:22px 0; border:1px solid ${BRAND.border}; border-radius:10px; border-collapse:separate; border-spacing:0; overflow:hidden; background-color:#f9fafb;">
        ${rows}
      </table>
      ${securityNote(actorFooter(actor))}
    `,
    textContent: `Hello ${adminUsername},\n\n${actorPhrase(actor)} your SIGLA administrator account:\n${textChanges}\n\n${actorFooter(actor)}`,
  });
};

const sendPasswordChangedNotice = async ({ to, adminUsername, actor = "self" }) => {
  if (!to) return;

  const opening =
    actor === "self"
      ? "Your SIGLA administrator password was just changed."
      : "The super administrator changed the password on your SIGLA administrator account.";
  const warning =
    "If you made this change, no action is needed. If you did not, your account may be compromised. Contact the super administrator immediately.";

  await sendNotice({
    to,
    subject: "SIGLA | Password changed",
    preheader: "The password for your SIGLA administrator account was changed.",
    eyebrow: "Security alert",
    title: "Your password was changed",
    bodyHtml: `
      ${paragraph(`Hello ${escapeHtml(adminUsername)},`)}
      ${paragraph(opening)}
      ${securityNote(warning)}
    `,
    textContent: `Hello ${adminUsername},\n\n${opening}\n\n${warning}`,
  });
};

const sendAccountStatusNotice = async ({ to, adminUsername, status }) => {
  if (!to) return;

  const copy = {
    deactivated: {
      subject: "SIGLA | Account deactivated",
      title: "Your account was deactivated",
      summary:
        "The super administrator deactivated your SIGLA administrator account. You will not be able to sign in until it is reactivated.",
    },
    active: {
      subject: "SIGLA | Account reactivated",
      title: "Your account is active again",
      summary:
        "The super administrator reactivated your SIGLA administrator account. You can sign in again with your existing credentials.",
    },
    deleted: {
      subject: "SIGLA | Account removed",
      title: "Your account was removed",
      summary:
        "The super administrator removed your SIGLA administrator account. You will no longer be able to sign in.",
    },
  }[status];

  if (!copy) return;

  const help = "If you have questions about this change, contact the super administrator.";

  await sendNotice({
    to,
    subject: copy.subject,
    preheader: copy.summary,
    eyebrow: "Account status",
    title: copy.title,
    bodyHtml: `
      ${paragraph(`Hello ${escapeHtml(adminUsername)},`)}
      ${paragraph(copy.summary)}
      ${securityNote(help)}
    `,
    textContent: `Hello ${adminUsername},\n\n${copy.summary}\n\n${help}`,
  });
};

// The temporary password is handed over out-of-band and is never emailed.
const sendTemporaryPasswordNotice = async ({ to, adminUsername }) => {
  if (!to) return;

  const summary =
    "The super administrator reset the password on your SIGLA administrator account. Your previous password no longer works.";
  const instructions =
    "The super administrator will give you a temporary password directly. When you sign in with it, you will be asked to choose your own username and password before continuing.";
  const warning = "If you did not expect this reset, contact the super administrator immediately.";

  await sendNotice({
    to,
    subject: "SIGLA | Password reset by administrator",
    preheader: "Your SIGLA administrator password was reset.",
    eyebrow: "Security alert",
    title: "Your password was reset",
    bodyHtml: `
      ${paragraph(`Hello ${escapeHtml(adminUsername)},`)}
      ${paragraph(summary)}
      ${paragraph(instructions)}
      ${securityNote(`<strong style="color:${BRAND.primary};">For your security:</strong> The temporary password is not included in this email. ${warning}`)}
    `,
    textContent: `Hello ${adminUsername},\n\n${summary}\n\n${instructions} The temporary password is not included in this email.\n\n${warning}`,
  });
};

module.exports = {
  sendVerificationCode,
  sendAccountChangeNotice,
  sendPasswordChangedNotice,
  sendAccountStatusNotice,
  sendTemporaryPasswordNotice,
};
