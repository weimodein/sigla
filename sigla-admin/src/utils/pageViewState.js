import { useCallback, useRef, useState } from "react";

// Page controls survive route unmounts without keeping hidden pages mounted.
// This stays in memory for the signed-in session and is cleared with the API
// cache when the administrator signs out or the session expires.
const pageViewState = new Map();

export const usePageViewState = (key, initialValue) => {
  const [value, setValue] = useState(() =>
    pageViewState.has(key) ? pageViewState.get(key) : initialValue,
  );
  const valueRef = useRef(value);
  valueRef.current = value;

  const setPersistedValue = useCallback((nextValue) => {
    const next =
      typeof nextValue === "function" ? nextValue(valueRef.current) : nextValue;
    valueRef.current = next;
    pageViewState.set(key, next);
    setValue(next);
  }, [key]);

  return [value, setPersistedValue];
};

export const clearPageViewState = () => pageViewState.clear();
