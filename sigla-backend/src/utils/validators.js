// Shared credential validation.
//
// The password rule (scope §13) was previously copy-pasted into each handler,
// which is how createAdministrator ended up without it. Keep the rule here so
// every entry point enforces the same thing and the message never drifts.

// Username column is VARCHAR(50) — cap here so an over-long value returns a
// clean 400 instead of leaking a Postgres "value too long" error as a 500.
const USERNAME_MIN = 3;
const USERNAME_MAX = 50;

const PASSWORD_MESSAGE =
  "Password must be at least 8 characters and include a letter and a number";

// Returns an error string, or null when the password is acceptable.
const validatePassword = (password) => {
  if (typeof password !== "string" || password.length < 8) return PASSWORD_MESSAGE;
  if (!/[A-Za-z]/.test(password)) return PASSWORD_MESSAGE;
  if (!/[0-9]/.test(password)) return PASSWORD_MESSAGE;
  return null;
};

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

// Requires a TLD of at least two letters, so "a@b.c" and "user@domain" fail.
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

const EMAIL_MESSAGE = "Please enter a valid email address";

// Returns an error string, or null when the address is well formed.
//
// NOTE: this proves shape only. A syntactically perfect address on a domain
// that does not exist (e.g. a "gmail.com" -> "gmaasdasd.com" typo) cannot be
// caught here — the UI adds a confirmation step for unrecognised domains.
const validateEmail = (email) => {
  if (typeof email !== "string" || !email.trim()) {
    return "Email is required";
  }
  const value = email.trim();
  if (value.length > EMAIL_MAX) {
    return `Email must be at most ${EMAIL_MAX} characters`;
  }
  if (!EMAIL_RX.test(value)) return EMAIL_MESSAGE;
  // Consecutive dots, or a dot adjacent to the "@" or the ends.
  if (value.includes("..")) return EMAIL_MESSAGE;
  if (/^\.|\.$|\.@|@\./.test(value)) return EMAIL_MESSAGE;
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
  validateUsername,
  validateEmail,
  validateWordLabel,
  validateCategoryName,
  PASSWORD_MESSAGE,
  EMAIL_MESSAGE,
  WORD_LABEL_MAX,
  CATEGORY_NAME_MAX,
};
