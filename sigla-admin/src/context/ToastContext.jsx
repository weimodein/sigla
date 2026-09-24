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
  // exit animation can play; the node really unmounts on animationend.
  const dismissToast = useCallback((id) => {
    setToasts((prev) =>
      prev.map((toast) => (
        toast.id === id ? { ...toast, leaving: true } : toast
      )),
    );
  }, []);

  const dropToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, leaving: false }]);
    if (duration > 0) {
      setTimeout(() => {
        dismissToast(id);
        // Animation events may not fire while the tab is in the background.
        setTimeout(() => dropToast(id), 400);
      }, duration);
    }
  }, [dismissToast, dropToast]);

  const removeToast = useCallback((id) => dismissToast(id), [dismissToast]);

  const success = useCallback(
    (message, duration) => addToast(message, "success", duration),
    [addToast],
  );
  const error = useCallback(
    (message, duration) => addToast(message, "error", duration),
    [addToast],
  );
  const warning = useCallback(
    (message, duration) => addToast(message, "warning", duration),
    [addToast],
  );
  const info = useCallback(
    (message, duration) => addToast(message, "info", duration),
    [addToast],
  );

  const value = useMemo(
    () => ({ success, error, warning, info }),
    [success, error, warning, info],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed top-4 left-4 right-4 w-auto sm:left-auto sm:w-80 space-y-2 max-h-screen overflow-y-auto"
        style={{ zIndex: 2100 }}
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type];
          return (
            <div
              key={toast.id}
              className={`border rounded-lg px-4 py-3 shadow-lg flex items-start gap-3 ${
                toast.leaving ? "toast-out" : "animate-slide-in"
              } ${COLORS[toast.type]}`}
              onAnimationEnd={(event) => {
                if (event.animationName === "toast-out") dropToast(toast.id);
              }}
            >
              <Icon
                size={18}
                className={`mt-0.5 shrink-0 ${ICON_COLORS[toast.type]}`}
              />
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
