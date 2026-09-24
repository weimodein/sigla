// Email entry validation, mirroring sigla-backend/src/utils/validators.js.
//
// Two layers, because they solve different problems:
//
//   validateEmail()  — shape only. Rejects malformed input (user@x..com, a@b.c).
//   isKnownDomain()  — a *hint*, not a rule. A syntactically perfect address on
//                      a domain that does not exist (a "gmail.com" ->
//                      "gmaasdasd.com" typo) passes every regex, so the UI asks
//                      the user to confirm before sending to an unfamiliar
//                      domain. It must never block: university and company
//                      addresses are legitimate and will not be on this list.

const EMAIL_MAX = 100;
const EMAIL_MESSAGE = "Please enter a valid email address";
const EMAIL_LOCAL_RX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_DOMAIN_LABEL_RX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export const normalizeEmail = (email) => {
  if (typeof email !== "string") return "";
  const value = email.trim();
  const separator = value.lastIndexOf("@");
  if (separator < 0) return value;
  return `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
};

// Returns an error string, or null when the address is well formed.
export const validateEmail = (email) => {
  if (typeof email !== "string" || !email.trim()) return "Email is required";
  const value = normalizeEmail(email);
  if (value.length > EMAIL_MAX) return `Email must be at most ${EMAIL_MAX} characters`;
  const parts = value.split("@");
  if (parts.length !== 2) return EMAIL_MESSAGE;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !EMAIL_LOCAL_RX.test(local)) return EMAIL_MESSAGE;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return EMAIL_MESSAGE;
  }
  if (!domain || domain.length > 253 || domain.includes("..")) return EMAIL_MESSAGE;
  const labels = domain.split(".");
  if (labels.length < 2 || !/^[A-Za-z]{2,}$/.test(labels.at(-1))) {
    return EMAIL_MESSAGE;
  }
  if (labels.some((label) => !EMAIL_DOMAIN_LABEL_RX.test(label))) {
    return EMAIL_MESSAGE;
  }
  return null;
};

const KNOWN_PROVIDERS = [
  "gmail.com",
  "yahoo.com",
  "yahoo.com.ph",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
];

// Institutional suffixes are trusted without listing every school.
const KNOWN_SUFFIXES = [".edu", ".edu.ph", ".gov.ph", ".ac.uk"];

// True when the domain is recognisable, so the confirmation step can be skipped.
export const isKnownDomain = (email) => {
  const domain = String(email).trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  if (KNOWN_PROVIDERS.includes(domain)) return true;
  return KNOWN_SUFFIXES.some((s) => domain.endsWith(s));
};
