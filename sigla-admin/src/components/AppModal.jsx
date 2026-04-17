import { useEffect, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const AppModal = ({ title, onClose, children, wide = false }) => {
  const panelRef   = useRef(null);
  const closingRef = useRef(false);
  const triggerRef = useRef(document.activeElement);
  const titleId    = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);

  const startClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    panelRef.current?.classList.replace("modal-panel-in", "modal-panel-out");
    panelRef.current?.closest("[data-modal-backdrop]")
      ?.classList.replace("modal-backdrop-in", "modal-backdrop-out");
  };

  // Scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Focus first element on open; restore on close
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelectorAll(FOCUSABLE)[0];
    first?.focus();
    return () => { triggerRef.current?.focus?.(); };
  }, []);

  // Keyboard: Escape closes; Tab traps focus inside
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") { startClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      data-modal-backdrop=""
      className="modal-backdrop-in fixed inset-0 flex items-center justify-center px-4 py-6 overflow-y-auto"
      style={{
        zIndex: 1100,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId.current}
      onClick={(e) => { if (e.target === e.currentTarget) startClose(); }}
    >
      <div
        ref={panelRef}
        className={`modal-panel-in bg-white rounded-2xl w-full my-auto ${wide ? "max-w-4xl" : "max-w-lg"}`}
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08)" }}
        onAnimationEnd={(e) => {
          if (closingRef.current && e.target === panelRef.current) onClose();
        }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid #f0f0f0" }}
        >
          <h3
            id={titleId.current}
            className="text-base font-semibold text-gray-800 tracking-tight"
          >
            {title}
          </h3>
          <button
            onClick={startClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
};

export default AppModal;
