const CODE_LENGTH = 6;

export const createEmptyVerificationCode = () => Array(CODE_LENGTH).fill("");

export const isVerificationCodeComplete = (value) =>
  value.length === CODE_LENGTH && value.every(Boolean);
