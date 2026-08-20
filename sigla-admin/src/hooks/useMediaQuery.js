import { useSyncExternalStore, useCallback } from "react";

// The app had no JS-side breakpoint primitive at all. The shell (Layout/Sidebar)
// is styled with inline style objects, which cannot carry a media query, so the
// mobile/desktop split has to be decided in JS rather than CSS.
// useSyncExternalStore rather than useState + useEffect: matchMedia IS an
// external store, and this is what the API is for. It reads the current value
// during render (so the very first paint is already correct — a `false` default
// would flash the desktop shell for one frame on a phone, sliding the sidebar
// out on load) and it cannot miss a change that lands between render and
// subscribe, which the effect-based version had to paper over with an extra
// setState on mount.
export const useMediaQuery = (query) => {
  const subscribe = useCallback(
    (onStoreChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
};

// 1023.98px, not 1024px, so this is the exact complement of Tailwind's
// `lg:` (min-width: 1024px). At exactly 1024 the CSS says desktop, and this must
// agree — a plain `max-width: 1024px` would report mobile at that width and the
// two halves of the shell would disagree by one pixel.
export const MOBILE_QUERY = "(max-width: 1023.98px)";

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
