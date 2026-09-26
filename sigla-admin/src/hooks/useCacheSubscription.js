import { useEffect, useRef } from "react";
import { subscribe } from "../utils/apiCache.js";

// Lets a mounted page apply the quiet background refresh from cachedFetch.
export const useCacheSubscription = (key, onUpdate) => {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!key) return undefined;
    return subscribe(key, (value) => onUpdateRef.current(value));
  }, [key]);
};
