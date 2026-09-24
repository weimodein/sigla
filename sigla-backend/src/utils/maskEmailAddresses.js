// Keep email addresses useful enough to identify while hiding the full local
// part. This matches the masking used elsewhere in the administrator web app.
const maskEmail = (email) => {
  const atIndex = email.lastIndexOf("@");
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const maskedLocal =
    local.length <= 2 ? `${local.charAt(0)}*` : `${local.slice(0, 2)}***`;

  return `${maskedLocal}@${domain}`;
};

// Activity details are historical free text, so mask every address at response
// time. This also protects records created before masking was introduced while
// retaining the original value in the audit database.
const maskEmailAddresses = (value) => {
  if (typeof value !== "string") return value;

  return value.replace(
    /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi,
    maskEmail,
  );
};

module.exports = { maskEmailAddresses };
