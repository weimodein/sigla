export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
const BCRYPT_MAX_BYTES = 72;

export const PASSWORD_HELP =
  `${PASSWORD_MIN}–${PASSWORD_MAX} characters, including a letter and a number.`;

export const validatePassword = (password) => {
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
