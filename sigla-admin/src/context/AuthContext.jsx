import { createContext, useContext, useState, useEffect } from "react";
import { login as loginApi, getMe } from "../api/authApi.js";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── On app load: restore session from localStorage ────────
  useEffect(() => {
    const restoreSession = async () => {
      const token = localStorage.getItem("token");
      const saved = localStorage.getItem("user");

      if (token && saved) {
        try {
          // Verify token is still valid by calling /auth/me
          const data = await getMe();
          setUser(data.user);
        } catch (err) {
          // Token expired or invalid — clear storage
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          setUser(null);
        }
      }

      setLoading(false);
    };

    restoreSession();
  }, []);

  // ── Login ─────────────────────────────────────────────────
  const login = async (username, password) => {
    const data = await loginApi(username, password);

    // Only allow admin and super_admin to access admin panel
    if (data.user.role === "user") {
      throw new Error("Access denied. Admin accounts only.");
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);

    return data;
  };

  // ── Logout ────────────────────────────────────────────────
  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  // ── Helpers ───────────────────────────────────────────────
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const isSuperAdmin = user?.role === "super_admin";
  const isLoggedIn = !!user;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAdmin,
        isSuperAdmin,
        isLoggedIn,
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
