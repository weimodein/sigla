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
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const EMAIL_MESSAGE = "Please enter a valid email address";

// Returns an error string, or null when the address is well formed.
export const validateEmail = (email) => {
  if (typeof email !== "string" || !email.trim()) return "Email is required";
  const value = email.trim();
  if (value.length > EMAIL_MAX) return `Email must be at most ${EMAIL_MAX} characters`;
  if (!EMAIL_RX.test(value)) return EMAIL_MESSAGE;
  if (value.includes("..")) return EMAIL_MESSAGE;
  if (/^\.|\.$|\.@|@\./.test(value)) return EMAIL_MESSAGE;
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
