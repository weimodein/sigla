import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: "bg-green-50 border-green-200 text-green-800",
  error: "bg-red-50 border-red-200 text-red-800",
  warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
};

const ICON_COLORS = {
  success: "text-green-500",
  error: "text-red-500",
  warning: "text-yellow-500",
  info: "text-blue-500",
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  // Both removal paths mark the toast `leaving` rather than dropping it, so the
  // exit animation can play; the node really unmounts on animationend. Toasts
  // used to slide in and then vanish in a single frame, and the ones below would
  // teleport upward to fill the gap.
  const dismissToast = useCallback((id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
  }, []);

  // Called from onAnimationEnd. Also the safety net if the animation never fires
  // (a background tab, for instance) — see the timeout in addToast.
  const dropToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, leaving: false }]);
    if (duration > 0) {
      setTimeout(() => {
        dismissToast(id);
        // animationend does not fire in a backgrounded tab, which would strand
        // the toast on screen forever. Drop it unconditionally once the exit has
        // had time to play; dropToast is a no-op if it already unmounted.
        setTimeout(() => dropToast(id), 400);
      }, duration);
    }
  }, [dismissToast, dropToast]);

  const removeToast = useCallback((id) => dismissToast(id), [dismissToast]);

  const success = useCallback((msg, dur) => addToast(msg, "success", dur), [addToast]);
  const error = useCallback((err, dur) => addToast(err, "error", dur), [addToast]);
  const warning = useCallback((msg, dur) => addToast(msg, "warning", dur), [addToast]);
  const info = useCallback((msg, dur) => addToast(msg, "info", dur), [addToast]);

  // Memoised, and this matters beyond render cost. The provider re-renders every
  // time a toast is added OR auto-dismissed, and a fresh object literal here gave
  // `toast` a new identity on each of those renders. Components listing `toast`
  // in a dependency array — Dashboard and ActivityLogs both do — therefore
  // refetched their entire dataset twice per toast: once when it appeared, once
  // when it expired. The callbacks below are already stable via useCallback, so
  // this value now never changes identity.
  const value = useMemo(
    () => ({ success, error, warning, info }),
    [success, error, warning, info],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-2 w-80 max-h-screen overflow-y-auto">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type];
          return (
            <div
              key={toast.id}
              className={`border rounded-lg px-4 py-3 shadow-lg flex items-start gap-3 ${
                toast.leaving ? "toast-out" : "animate-slide-in"
              } ${COLORS[toast.type]}`}
              onAnimationEnd={(e) => {
                if (e.animationName === "toast-out") dropToast(toast.id);
              }}
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${ICON_COLORS[toast.type]}`} />
              <p className="text-sm leading-snug flex-1">{toast.message}</p>
              <button
                onClick={() => removeToast(toast.id)}
                className="interactive shrink-0 opacity-50 hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};
