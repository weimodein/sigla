// Shared credential validation.
//
// The password rule (scope §13) was previously copy-pasted into each handler,
// which is how createAdministrator ended up without it. Keep the rule here so
// every entry point enforces the same thing and the message never drifts.

// Username column is VARCHAR(50) — cap here so an over-long value returns a
// clean 400 instead of leaking a Postgres "value too long" error as a 500.
const USERNAME_MIN = 3;
const USERNAME_MAX = 50;

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 64;
// bcrypt only considers the first 72 UTF-8 bytes. Rejecting anything longer
// prevents two visually different passwords from authenticating as the same
// credential after silent truncation.
const BCRYPT_MAX_BYTES = 72;
const PASSWORD_MESSAGE =
  `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters and include a letter and a number`;

// Returns an error string, or null when the password is acceptable.
const validatePassword = (password) => {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    return PASSWORD_MESSAGE;
  }
  if (password.length > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} characters`;
  }
  if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_BYTES) {
    return "Password is too long when encoded. Use fewer characters";
  }
  if (!/\p{L}/u.test(password)) return PASSWORD_MESSAGE;
  if (!/[0-9]/.test(password)) return PASSWORD_MESSAGE;
  return null;
};

const isPasswordWithinBcryptLimit = (password) =>
  typeof password === "string" &&
  Buffer.byteLength(password, "utf8") <= BCRYPT_MAX_BYTES;

// Returns { error } on failure, or { value } holding the trimmed username.
// Callers must persist `value`, not the raw input, so stored usernames and
// uniqueness checks both use the trimmed form.
const validateUsername = (username) => {
  if (typeof username !== "string" || !username.trim()) {
    return { error: "Username is required" };
  }
  const value = username.trim();
  if (value.length < USERNAME_MIN) {
    return { error: `Username must be at least ${USERNAME_MIN} characters` };
  }
  if (value.length > USERNAME_MAX) {
    return { error: `Username must be at most ${USERNAME_MAX} characters` };
  }
  return { value };
};

// Email column is VARCHAR(100).
const EMAIL_MAX = 100;

const EMAIL_MESSAGE = "Please enter a valid email address";
const EMAIL_LOCAL_RX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_DOMAIN_LABEL_RX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

const normalizeEmail = (email) => {
  if (typeof email !== "string") return "";
  const value = email.trim();
  const separator = value.lastIndexOf("@");
  if (separator < 0) return value;
  return `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
};

// Returns an error string, or null when the address is well formed.
//
// NOTE: this proves shape only. A syntactically perfect address on a domain
// that does not exist (e.g. a "gmail.com" -> "gmaasdasd.com" typo) cannot be
// caught here — the UI adds a confirmation step for unrecognised domains.
const validateEmail = (email) => {
  if (typeof email !== "string" || !email.trim()) {
    return "Email is required";
  }
  const value = normalizeEmail(email);
  if (value.length > EMAIL_MAX) {
    return `Email must be at most ${EMAIL_MAX} characters`;
  }
  const parts = value.split("@");
  if (parts.length !== 2) return EMAIL_MESSAGE;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !EMAIL_LOCAL_RX.test(local)) {
    return EMAIL_MESSAGE;
  }
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return EMAIL_MESSAGE;
  }
  if (!domain || domain.length > 253 || domain.includes("..")) {
    return EMAIL_MESSAGE;
  }
  const labels = domain.split(".");
  if (labels.length < 2 || !/^[A-Za-z]{2,}$/.test(labels.at(-1))) {
    return EMAIL_MESSAGE;
  }
  if (labels.some((label) => !EMAIL_DOMAIN_LABEL_RX.test(label))) {
    return EMAIL_MESSAGE;
  }
  return null;
};

// Word.label is VARCHAR(100) and Category.name is VARCHAR(50). Without these
// checks an over-long value reached Postgres and came back as a bare 500
// "Server error", which the UI showed as a generic failure with no hint that
// length was the problem — the same reason username and email are capped above.
const WORD_LABEL_MAX = 100;
const CATEGORY_NAME_MAX = 50;

// Returns an error string, or null when the label is acceptable.
const validateWordLabel = (label) => {
  if (typeof label !== "string" || !label.trim()) return "Word label is required";
  if (label.trim().length > WORD_LABEL_MAX) {
    return `Word label must be at most ${WORD_LABEL_MAX} characters`;
  }
  return null;
};

const validateCategoryName = (name) => {
  if (typeof name !== "string" || !name.trim()) return "Category name is required";
  if (name.trim().length > CATEGORY_NAME_MAX) {
    return `Category name must be at most ${CATEGORY_NAME_MAX} characters`;
  }
  return null;
};

module.exports = {
  validatePassword,
  isPasswordWithinBcryptLimit,
  validateUsername,
  validateEmail,
  normalizeEmail,
  validateWordLabel,
  validateCategoryName,
  PASSWORD_MESSAGE,
  PASSWORD_MIN,
  PASSWORD_MAX,
  EMAIL_MESSAGE,
  WORD_LABEL_MAX,
  CATEGORY_NAME_MAX,
};
