import { useEffect, useRef } from "react";

/* Escape-closes / Enter-confirms for dialogs.
   AppModal uses this, and so do the few hand-rolled overlays that don't render
   through AppModal — so the keyboard contract is defined once.

   `enabled` lets a caller opt out per-keypress (AppModal passes its topmost-modal
   check, so a stacked confirmation dialog does not also fire the form underneath). */
export const useModalKeys = ({ onEscape, onEnter, enabled }) => {
  // Held in a ref so the listener subscribes once instead of re-binding on every
  // parent re-render. Updated in an effect rather than during render, so render
  // stays side-effect free.
  const ref = useRef({ onEscape, onEnter, enabled });
  useEffect(() => {
    ref.current = { onEscape, onEnter, enabled };
  }, [onEscape, onEnter, enabled]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const { onEscape, onEnter, enabled } = ref.current;
      if (enabled && !enabled()) return;

      if (e.key === "Escape") {
        onEscape?.();
        return;
      }

      if (e.key !== "Enter" || !onEnter) return;
      // Modifier combos are left alone (Shift+Enter, Ctrl+Enter, …).
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      // Enter belongs to the focused control in these cases: a newline in a
      // textarea, the confirm gesture on an open native select, and the browser's
      // own click on a focused button (so Enter on Cancel cancels, not confirms).
      const tag = e.target?.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      e.preventDefault();
      onEnter();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
};

export default useModalKeys;
