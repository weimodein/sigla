import { createContext, useContext, useState, useEffect } from "react";
import { login as loginApi, getMe } from "../api/authApi.js";

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
          setUser(data.user);
          storage.set("user", JSON.stringify(data.user));
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

  // ── Login ─────────────────────────────────────────────────
  const login = async (identifier, password) => {
    const data = await loginApi(identifier, password);

    // Only allow admin / super-admin accounts to access the admin platform
    if (data.user.role !== "admin" && data.user.role !== "super_admin") {
      throw new Error("Access denied. Admin accounts only.");
    }

    storage.set("token", data.token);
    storage.set("user", JSON.stringify(data.user));
    setUser(data.user);

    return data;
  };

  // ── Refresh the current user from the server (after profile/email change) ─
  const refreshUser = async () => {
    const data = await getMe();
    setUser(data.user);
    storage.set("user", JSON.stringify(data.user));
    return data.user;
  };

  // ── Logout ────────────────────────────────────────────────
  const logout = () => {
    storage.remove("token");
    storage.remove("user");
    setUser(null);
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
