import { createContext, useContext, useState, useEffect } from "react";
import { login as loginApi, getMe } from "../api/authApi.js";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── On app load: restore session from sessionStorage ────────
  useEffect(() => {
    const restoreSession = async () => {
      const token = sessionStorage.getItem("token");
      const saved = sessionStorage.getItem("user");

      if (token && saved) {
        try {
          const data = await getMe();
          setUser(data.user);
        } catch (err) {
          sessionStorage.removeItem("token");
          sessionStorage.removeItem("user");
          setUser(null);
        }
      }

      setLoading(false);
    };

    restoreSession();
  }, []);

  // ── Login ─────────────────────────────────────────────────
  const login = async (identifier, password) => {
    const data = await loginApi(identifier, password);

    // Only allow admin to access admin panel
    if (data.user.role === "user") {
      throw new Error("Access denied. Admin accounts only.");
    }

    sessionStorage.setItem("token", data.token);
    sessionStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);

    return data;
  };

  // ── Logout ────────────────────────────────────────────────
  const logout = () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    setUser(null);
  };

  // ── Helpers ───────────────────────────────────────────────
  const isAdmin = user?.role === "admin";
  const isLoggedIn = !!user;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAdmin,
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
