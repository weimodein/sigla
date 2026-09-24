import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";

const ToastContext = createContext(null);

const TOAST_TYPES = {
  success: { icon: CheckCircle, label: "Success", duration: 3500 },
  error: { icon: XCircle, label: "Error", duration: 6000 },
  warning: { icon: AlertTriangle, label: "Warning", duration: 5000 },
  info: { icon: Info, label: "Information", duration: 4000 },
};

const MAX_VISIBLE_TOASTS = 4;
const EXIT_FALLBACK_MS = 350;

const normalizeMessage = (message) => {
  if (message instanceof Error) return message.message;
  if (typeof message === "string") return message.trim();
  if (message == null) return "";
  return String(message);
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const nextIdRef = useRef(0);
  const autoDismissTimersRef = useRef(new Map());
  const exitTimersRef = useRef(new Map());

  const clearTimer = useCallback((timerMap, id) => {
    const timer = timerMap.current.get(id);
    if (timer) window.clearTimeout(timer);
    timerMap.current.delete(id);
  }, []);

  const dropToast = useCallback((id) => {
    clearTimer(autoDismissTimersRef, id);
    clearTimer(exitTimersRef, id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, [clearTimer]);

  const dismissToast = useCallback((id) => {
    clearTimer(autoDismissTimersRef, id);
    setToasts((current) => current.map((toast) => (
      toast.id === id && !toast.leaving
        ? { ...toast, leaving: true }
        : toast
    )));

    clearTimer(exitTimersRef, id);
    exitTimersRef.current.set(
      id,
      window.setTimeout(() => dropToast(id), EXIT_FALLBACK_MS),
    );
  }, [clearTimer, dropToast]);

  const scheduleDismiss = useCallback((id, duration) => {
    clearTimer(autoDismissTimersRef, id);
    if (duration <= 0) return;
    autoDismissTimersRef.current.set(
      id,
      window.setTimeout(() => dismissToast(id), duration),
    );
  }, [clearTimer, dismissToast]);

  const addToast = useCallback((message, requestedType = "info", duration) => {
    const text = normalizeMessage(message);
    if (!text) return null;

    const type = TOAST_TYPES[requestedType] ? requestedType : "info";
    const lifetime = duration ?? TOAST_TYPES[type].duration;
    const id = `${Date.now()}-${nextIdRef.current++}`;
    const nextToast = {
      id,
      message: text,
      type,
      duration: lifetime,
      leaving: false,
    };

    // Replace an identical active notification and cap the visible queue. This
    // prevents repeated API failures from flooding the screen.
    setToasts((current) => [
      ...current.filter((toast) => (
        toast.leaving || toast.type !== type || toast.message !== text
      )),
      nextToast,
    ].slice(-MAX_VISIBLE_TOASTS));
    scheduleDismiss(id, lifetime);
    return id;
  }, [scheduleDismiss]);

  const pauseToast = useCallback((id) => {
    clearTimer(autoDismissTimersRef, id);
  }, [clearTimer]);

  const resumeToast = useCallback((toast, element) => {
    if (toast.leaving || toast.duration <= 0) return;
    if (element.matches(":hover") || element.contains(document.activeElement)) {
      return;
    }
    // Restarting the duration after interaction gives the user enough time to
    // finish reading rather than dismissing immediately after pointer exit.
    scheduleDismiss(toast.id, toast.duration);
  }, [scheduleDismiss]);

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));
    [autoDismissTimersRef, exitTimersRef].forEach((timerMap) => {
      timerMap.current.forEach((timer, id) => {
        if (!activeIds.has(id)) {
          window.clearTimeout(timer);
          timerMap.current.delete(id);
        }
      });
    });
  }, [toasts]);

  useEffect(() => () => {
    [autoDismissTimersRef, exitTimersRef].forEach((timerMap) => {
      timerMap.current.forEach((timer) => window.clearTimeout(timer));
      timerMap.current.clear();
    });
  }, []);

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
      <section
        className="toast-viewport"
        aria-label="Notifications"
        aria-relevant="additions"
      >
        {toasts.map((toast) => {
          const config = TOAST_TYPES[toast.type];
          const Icon = config.icon;

          return (
            <article
              key={toast.id}
              data-toast-type={toast.type}
              role={toast.type === "error" ? "alert" : "status"}
              aria-atomic="true"
              className={`toast-card ${
                toast.leaving ? "toast-out" : "animate-slide-in"
              }`}
              onMouseEnter={() => pauseToast(toast.id)}
              onMouseLeave={(event) => resumeToast(toast, event.currentTarget)}
              onFocusCapture={() => pauseToast(toast.id)}
              onBlurCapture={(event) => resumeToast(toast, event.currentTarget)}
              onAnimationEnd={(event) => {
                if (event.animationName === "toast-out") dropToast(toast.id);
              }}
            >
              <span className="toast-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={2.2} />
              </span>
              <div className="toast-content">
                <p className="toast-title">{config.label}</p>
                <p className="toast-message">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="toast-dismiss"
                aria-label={`Dismiss ${config.label.toLowerCase()} notification`}
              >
                <X size={16} />
              </button>
            </article>
          );
        })}
      </section>
    </ToastContext.Provider>
  );
};

// Kept beside the provider to preserve the app-wide import contract.
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};
