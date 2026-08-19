// A small stale-while-revalidate cache for GET endpoints.
//
// WHY
// ---
// Every page refetches everything on mount, and App.jsx builds <Layout> inside
// each <Route> element rather than as a parent layout route — so navigating
// unmounts the whole subtree and the next page re-runs its full mount fetch.
// Five endpoints are called by 2-4 pages each, two of them expensive server-side
// (getWordStats runs 7 aggregates; getCategories is an N+1). Dashboard → Dataset
// → Dashboard re-ran all of it, and two concurrent identical calls produced two
// HTTP requests because nothing deduplicated them.
//
// Module scope on purpose: Layout remounts on navigation, so a cache held in
// React state below it would be destroyed by the very thing it exists to fix.
//
// Behaviour on read:
//   fresh hit  → return cached value AND refresh in the background
//   stale/miss → fetch, store, return
//   in-flight  → hand back the existing promise (this is the dedup)
//
// Writes must invalidate. See invalidate() — callers wire it into their mutation
// handlers, and correctness depends on that rather than on a short TTL.

const DEFAULT_TTL = 30_000;

// key -> { value, at }
const store = new Map();
// key -> Promise, so concurrent callers share one request
const inFlight = new Map();
// key -> Set<callback>, notified when a background refresh brings new data
const listeners = new Map();

const notify = (key, value) => {
  const subs = listeners.get(key);
  if (!subs) return;
  for (const cb of subs) {
    try {
      cb(value);
    } catch {
      // A broken subscriber must not take down the refresh for the others.
    }
  }
};

const run = (key, fetcher) => {
  const pending = fetcher()
    .then((value) => {
      store.set(key, { value, at: Date.now() });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, pending);
  return pending;
};

/**
 * @param key      cache key; include serialised params, since some endpoints are
 *                 called by different pages with incompatible arguments
 * @param fetcher  () => Promise<value>
 * @param options  { ttl, force } — force bypasses the cache entirely, for the
 *                 live-state reads that must never be served stale
 */
export const cachedFetch = (key, fetcher, { ttl = DEFAULT_TTL, force = false } = {}) => {
  if (force) {
    invalidate(key);
    return run(key, fetcher);
  }

  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    // Refresh behind the paint so a stale value corrects itself in about a
    // second rather than lingering until the next hard reload. Errors are
    // swallowed: the caller already has usable data and a background failure
    // should not surface as a toast.
    if (!inFlight.has(key)) {
      run(key, fetcher)
        .then((value) => notify(key, value))
        .catch(() => {});
    }
    return Promise.resolve(hit.value);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  return run(key, fetcher);
};

// Subscribe to background refreshes for a key. Returns an unsubscribe function.
export const subscribe = (key, cb) => {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(cb);
  return () => {
    const subs = listeners.get(key);
    if (!subs) return;
    subs.delete(cb);
    if (subs.size === 0) listeners.delete(key);
  };
};

// Drop one key, or every key starting with the given prefix. Prefix matching is
// what makes coarse invalidation practical: the relationships here are
// cross-entity, so deleting a word has to clear word stats, category word_counts
// and the word list together.
export const invalidate = (keyOrPrefix) => {
  for (const key of [...store.keys()]) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) store.delete(key);
  }
  for (const key of [...inFlight.keys()]) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) inFlight.delete(key);
  }
};

// Called on logout and on session expiry. Without this the next admin to sign in
// on the same browser would be served the previous one's data.
export const clearCache = () => {
  store.clear();
  inFlight.clear();
};

// Stable key for a params object — property order must not produce a new entry.
export const cacheKey = (name, params) => {
  if (!params || Object.keys(params).length === 0) return name;
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `${name}?${sorted}`;
};
