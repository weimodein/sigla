// A one-shot message handed across a route change.
//
// Signing out, being signed out by an expired token, and signing in all end with
// a navigation, which unmounts the component that knows what happened. The page
// the admin lands on has to say it instead, so the message is parked here and
// collected on the next mount.
//
// Module scope rather than sessionStorage: the message should not outlive the
// tab. Persisting it meant "You've been signed out" could reappear days later on
// an unrelated visit.
//
// It also has to work from outside React — AuthProvider wraps ToastProvider in
// App.jsx, so the session-expiry handler in AuthContext sits above the toast
// context and cannot call useToast at all.

let pending = null;

// type is a ToastContext variant: "success" | "error" | "warning" | "info".
export const setAuthMessage = (type, text) => {
  pending = { type, text };
};

// Read-once. Returns null when nothing is waiting, so a later visit to /login
// does not replay a stale message.
export const takeAuthMessage = () => {
  const message = pending;
  pending = null;
  return message;
};
