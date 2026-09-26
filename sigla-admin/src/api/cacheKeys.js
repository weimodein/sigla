import { invalidate } from "../utils/apiCache.js";

// Cache keys for the shared GET endpoints, in one place so a call site and an
// invalidation cannot drift apart over a typo.
//
// The prefixes matter: invalidate() matches by prefix, and the relationships
// here are cross-entity — deleting a word changes word stats, the word list AND
// each category's word_count — so invalidating a whole prefix is the correct
// coarse behaviour, not a shortcut.
export const CACHE_KEYS = {
  wordStats: "words:stats",
  words: "words:list",          // prefix; per-params entries hang off this
  signers: "words:signers",     // prefix; per-word entries hang off this
  categories: "categories:list",
  models: "models:list",
  modelStats: "models:stats",
  adminStats: "administrators:stats",
  administrators: "administrators:list",
  deactivatedAdministrators: "administrators:deactivated",
  deletedAdministrators: "administrators:deleted",
  activityLogs: "activity:list",
  reportWords: "reports:words",
};

// Everything a write to one entity can affect. Used by the mutation handlers.
export const CACHE_GROUPS = {
  // A word changing moves its stats, the list it appears in, and the word_count
  // shown against its category.
  word: ["words:", "categories:", "activity:", "reports:"],
  category: ["categories:", "words:", "activity:", "reports:"],
  model: ["models:", "activity:", "reports:"],
  administrator: ["administrators:", "activity:", "reports:"],
};

// Wrap a mutation so the caches it affects are dropped once it succeeds.
//
// Applied here in the api layer rather than at the ~19 call sites in the pages:
// a handler added later cannot forget to invalidate, and a failed write leaves
// the cache untouched because the prefixes are only cleared after the promise
// resolves.
export const withInvalidation = (fn, group) => async (...args) => {
  const result = await fn(...args);
  for (const prefix of CACHE_GROUPS[group] || []) invalidate(prefix);
  return result;
};

export default CACHE_KEYS;
