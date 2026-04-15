import { useEffect, useRef, useState, useCallback } from "react";
import { X } from "lucide-react";

const Modal = ({ title, onClose, children, wide = false }) => {
  const overlayRef  = useRef(null);
  const panelRef    = useRef(null);
  const [closing, setClosing] = useState(false);

  // Animate out then call onClose
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
  }, [closing]);

  // When exit animation ends, actually unmount
  const handleAnimationEnd = (e) => {
    if (closing && e.target === panelRef.current) {
      onClose();
    }
  };

  // Escape key
  useEffect(() => {
    const handle = (e) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [handleClose]);

  // Focus trap
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const focusable = overlay.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    first?.focus();

    const handle = (e) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first?.focus(); }
      }
    };
    overlay.addEventListener("keydown", handle);
    return () => overlay.removeEventListener("keydown", handle);
  }, []);

  // Body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 flex items-center justify-center px-4 ${
        closing ? "modal-backdrop-out" : "modal-backdrop-in"
      }`}
      style={{
        zIndex: 1100,
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        ref={panelRef}
        className={`bg-white rounded-2xl w-full ${wide ? "max-w-4xl" : "max-w-md"} ${
          closing ? "modal-panel-out" : "modal-panel-in"
        }`}
        style={{
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08)",
        }}
        onAnimationEnd={handleAnimationEnd}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid #f0f0f0" }}
        >
          <h3 className="text-base font-semibold text-gray-800 tracking-tight">
            {title}
          </h3>
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 transition-colors hover:text-gray-700 hover:bg-gray-100"
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
