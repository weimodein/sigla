import { createContext, useContext, useState, useEffect } from "react";
import {
  login as loginApi,
  logout as logoutApi,
  getMe,
  SESSION_EXPIRED_EVENT,
} from "../api/authApi.js";
import { setAuthMessage } from "../utils/authMessage.js";
import { clearCache } from "../utils/apiCache.js";

const AuthContext = createContext(null);

const storage = {
  get: (key) => localStorage.getItem(key),
  set: (key, val) => localStorage.setItem(key, val),
  remove: (key) => localStorage.removeItem(key),
};

export const AuthProvider = ({ children }) => {
  // Initialise user synchronously from localStorage so ProtectedRoute never
  // flickers to "not logged in" before the async getMe call resolves.
  const [user, setUser] = useState(() => {
    try {
      const saved = storage.get("user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  // ── On app load: verify token is still valid with the server ─
  useEffect(() => {
    const restoreSession = async () => {
      const token = storage.get("token");

      if (token) {
        try {
          const data = await getMe();
          setUser(data.administrator);
          storage.set("user", JSON.stringify(data.administrator));
        } catch {
          storage.remove("token");
          storage.remove("user");
          setUser(null);
        }
      } else {
        setUser(null);
      }

      setLoading(false);
    };

    restoreSession();
  }, []);

  // ── Session expiry ────────────────────────────────────────
  // The axios interceptor clears localStorage on a 401, but that alone leaves
  // this provider's `user` state populated — ProtectedRoute kept rendering and
  // every subsequent request went out with no token, failing indefinitely until
  // the admin manually reloaded. Dropping `user` here makes isLoggedIn false, so
  // ProtectedRoute redirects to /login on the next render.
  useEffect(() => {
    const onExpired = () => {
      storage.remove("token");
      storage.remove("user");
      setUser(null);
      clearCache();
      // Say why. ProtectedRoute redirects to /login on the next render, and
      // without this the admin is dropped there mid-task with no explanation.
      // Parked rather than toasted directly: this provider wraps ToastProvider,
      // so useToast is not reachable from here.
      setAuthMessage("warning", "Your session expired — please sign in again.");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // ── Login ─────────────────────────────────────────────────
  const login = async (identifier, password) => {
    const data = await loginApi(identifier, password);

    // Only allow admin / super-admin accounts to access the admin platform
    if (data.administrator.role !== "admin" && data.administrator.role !== "super_admin") {
      throw new Error("Access denied. Admin accounts only.");
    }

    storage.set("token", data.token);
    storage.set("user", JSON.stringify(data.administrator));
    setUser(data.administrator);

    return data;
  };

  // ── Refresh the current user from the server (after profile/email change) ─
  const refreshUser = async () => {
    const data = await getMe();
    setUser(data.administrator);
    storage.set("user", JSON.stringify(data.administrator));
    return data.administrator;
  };

  // ── Logout ────────────────────────────────────────────────
  const logout = async () => {
    const hasToken = !!storage.get("token");

    try {
      // Revoke the current JWT before removing the only browser copy. If the
      // request cannot reach the server we still clear this device in finally.
      if (hasToken) await logoutApi();
      return true;
    } catch {
      return false;
    } finally {
      storage.remove("token");
      storage.remove("user");
      setUser(null);
      // Otherwise the next admin to sign in on this browser is served the previous
      // one's cached data.
      clearCache();
    }
  };

  // ── Helpers ───────────────────────────────────────────────
  const isSuper = user?.role === "super_admin";
  const isAdmin = user?.role === "admin" || isSuper;
  const isLoggedIn = !!user;
  // New admins must complete first-login setup before using the platform.
  const needsSetup = !!user?.must_complete_setup;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refreshUser,
        isAdmin,
        isSuper,
        isLoggedIn,
        needsSetup,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export default AuthContext;
