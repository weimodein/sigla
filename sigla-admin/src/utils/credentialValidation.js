export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 50;
const BCRYPT_MAX_BYTES = 72;

export const PASSWORD_HELP =
  `${PASSWORD_MIN}–${PASSWORD_MAX} characters, including a letter and a number. Spaces are allowed only between characters.`;
export const USERNAME_HELP =
  `${USERNAME_MIN}–${USERNAME_MAX} characters with no whitespace.`;

export const hasOuterWhitespace = (value) =>
  typeof value === "string" && (/^\s/u.test(value) || /\s$/u.test(value));

export const validateUsername = (username) => {
  if (typeof username !== "string" || !username.trim()) {
    return "Username is required.";
  }
  if (/\s/u.test(username)) {
    return "Username cannot contain whitespace.";
  }
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Username must be ${USERNAME_MIN} to ${USERNAME_MAX} characters.`;
  }
  return null;
};

export const validatePassword = (password) => {
  if (hasOuterWhitespace(password)) {
    return "Password cannot start or end with whitespace.";
  }
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    return `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters and include a letter and a number.`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} characters.`;
  }
  if (new TextEncoder().encode(password).length > BCRYPT_MAX_BYTES) {
    return "Password is too long when encoded. Use fewer characters.";
  }
  if (!/\p{L}/u.test(password) || !/[0-9]/.test(password)) {
    return `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters and include a letter and a number.`;
  }
  return null;
};

export const validatePasswordConfirmation = (password, confirmation) => {
  if (!confirmation) return "Confirm your password.";
  if (password !== confirmation) return "Passwords do not match.";
  return null;
};
