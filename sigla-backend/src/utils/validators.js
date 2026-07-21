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

module.exports = { validatePassword, validateUsername, PASSWORD_MESSAGE };
