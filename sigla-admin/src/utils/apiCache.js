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
// Invalidated requests must not repopulate the cache after a write succeeds.
const generations = new Map();
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
  const generation = generations.get(key) || 0;
  let pending;
  pending = Promise.resolve()
    .then(fetcher)
    .then((value) => {
      if ((generations.get(key) || 0) === generation) {
        store.set(key, { value, at: Date.now() });
        notify(key, value);
      }
      return value;
    })
    .finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
  inFlight.set(key, pending);
  return pending;
};

/**
 * @param key      cache key; include serialised params, since some endpoints are
 *                 called by different pages with incompatible arguments
 * @param fetcher  () => Promise<value>
 * @param options  { ttl, force } — force always requests fresh data while
 *                 keeping the previous value available to render until it lands
 */
export const cachedFetch = (key, fetcher, { ttl = DEFAULT_TTL, force = false } = {}) => {
  if (force) {
    // Preserve the last good value for pages that render it while awaiting a
    // live-state refresh, and notify mounted subscribers when fresh data lands.
    return inFlight.get(key) || run(key, fetcher);
  }

  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    // Refresh behind the paint so a stale value corrects itself in about a
    // second rather than lingering until the next hard reload. Errors are
    // swallowed: the caller already has usable data and a background failure
    // should not surface as a toast.
    if (!inFlight.has(key)) {
      run(key, fetcher).catch(() => {});
    }
    return Promise.resolve(hit.value);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  return run(key, fetcher);
};

// Synchronous reads let a page paint the last successful result before starting
// its refresh. `hasCached` distinguishes a cached null from a true cache miss.
export const getCached = (key) => store.get(key)?.value;
export const hasCached = (key) => store.has(key);

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
  const keys = new Set([...store.keys(), ...inFlight.keys()]);
  for (const key of keys) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) {
      generations.set(key, (generations.get(key) || 0) + 1);
      store.delete(key);
      inFlight.delete(key);
    }
  }
};

// Called on logout and on session expiry. Without this the next admin to sign in
// on the same browser would be served the previous one's data.
export const clearCache = () => {
  for (const key of inFlight.keys()) {
    generations.set(key, (generations.get(key) || 0) + 1);
  }
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
