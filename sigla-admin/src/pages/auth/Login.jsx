import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { Eye, EyeOff, Loader2 } from "lucide-react";

const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
};

const FloatingInput = ({
  id, type, value, onChange, label, autoComplete, icon,
}) => (
  <div style={S.inputGroup}>
    <input
      id={id} type={type} value={value} onChange={onChange}
      required autoComplete={autoComplete}
      className="sigla-input" style={S.input} placeholder=" "
    />
    <label style={S.label}>{label}</label>
    {icon && <span style={S.inputIcon}>{icon}</span>}
    <span className="sigla-underline" style={S.underline} />
  </div>
);

const Button = ({ disabled, loading, children }) => {
  const isDisabled = loading || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      style={{ ...S.btn, ...(isDisabled ? { opacity: 0.7, cursor: "not-allowed" } : {}) }}
    >
      {loading && (
        <Loader2
          size={16}
          style={{ display: "inline-block", animation: "sigla-spin 0.8s ease-in-out infinite" }}
        />
      )}
      {children}
    </button>
  );
};

const PasswordToggleIcon = ({ showPass, onToggle }) => (
  <button
    type="button" onClick={onToggle} style={S.eyeToggle}
    tabIndex={-1} aria-label={showPass ? "Hide password" : "Show password"}
  >
    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
  </button>
);

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (document.getElementById("login-dynamic-styles")) return;
    const style = document.createElement("style");
    style.id = "login-dynamic-styles";
    style.textContent = `
      .sigla-input:focus {
        border-color: ${C.primary} !important;
        box-shadow: 0 2px 0 ${C.primary};
      }
      .sigla-input:focus + label,
      .sigla-input:not(:placeholder-shown) + label {
        top: -10px !important;
        font-size: 0.75rem !important;
        font-weight: 500 !important;
        color: ${C.primary} !important;
      }
      .sigla-input:focus ~ .sigla-underline { width: 100% !important; }
      .sigla-input[type="password"]::-ms-reveal,
      .sigla-input[type="password"]::-ms-clear { display: none; }
      .sigla-input::-webkit-credentials-auto-fill-button,
      .sigla-input::-webkit-password-toggle { display: none; }
      @keyframes sigla-spin { to { transform: rotate(360deg); } }
      @media (max-width: 768px) {
        .sigla-login-container { flex-direction: column !important; width: 90% !important; max-height: none !important; }
        .sigla-left-panel { width: 100% !important; padding: 30px 20px !important; min-height: 140px !important; }
        .sigla-right-panel { width: 100% !important; padding: 30px 25px !important; }
      }
      @media (max-width: 480px) {
        .sigla-login-container { width: 95% !important; }
        .sigla-right-panel { padding: 25px 20px !important; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const handleLogin = useCallback(async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(identifier, password);
      navigate("/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Login failed");
    } finally { setLoading(false); }
  }, [identifier, password, login, navigate, toast]);

  return (
    <div style={S.pageWrapper}>
      <div style={S.background} />
      <div className="sigla-login-container" style={S.loginContainer}>

        {/* Left panel */}
        <div className="sigla-left-panel" style={S.leftPanel}>
          <img src="/logo.png" alt="SIGLA Logo" style={S.logo} />
        </div>

        {/* Right panel */}
        <div className="sigla-right-panel" style={S.rightPanel}>
          <form onSubmit={handleLogin}>
            <h2 style={S.heading}>Login Portal</h2>

            <div style={S.fields}>
              <FloatingInput
                id="identifier" type="text" value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                label="Username or Email" autoComplete="username"
              />
              <FloatingInput
                id="password" type={showPass ? "text" : "password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                label="Password" autoComplete="current-password"
                icon={<PasswordToggleIcon showPass={showPass} onToggle={() => setShowPass(s => !s)} />}
              />
            </div>

            <label style={S.showPassLabel}>
              <input
                type="checkbox" checked={showPass}
                onChange={() => setShowPass(s => !s)} style={S.checkbox}
              />
              Show Password
            </label>

            <Button disabled={loading} loading={loading}>
              {loading ? "Logging in..." : "Login"}
            </Button>

            <div style={S.footer}>
              <p style={S.footerP}>Forgot your password?</p>
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                style={S.footerLink}
              >
                Reset it here
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const S = {
  pageWrapper: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    padding: "20px 0",
    position: "relative",
    backgroundColor: C.background,
  },
  background: {
    position: "fixed",
    top: 0, left: 0, width: "100%", height: "100%",
    background: `linear-gradient(135deg, ${C.primary} 0%, ${C.secondary} 60%, ${C.accent} 100%)`,
    filter: "blur(8px)",
    zIndex: -1,
  },
  loginContainer: {
    display: "flex",
    width: "700px",
    maxWidth: "95%",
    height: "480px",
    borderRadius: "15px",
    overflow: "hidden",
    boxShadow: "0 6px 25px rgba(0,0,0,0.3)",
  },
  leftPanel: {
    background: C.primary,
    width: "45%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "30px",
    flexShrink: 0,
  },
  logo: {
    width: "120%",
    maxWidth: "1200px",
    height: "auto",
  },
  rightPanel: {
    width: "55%",
    background: "#f0f1f9",
    padding: "42px 45px",
    color: C.text,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    overflowY: "auto",
  },
  heading: {
    fontSize: "1.75rem",
    fontWeight: 700,
    marginBottom: "30px",
    marginTop: 0,
    color: C.text,
  },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: "32px",
    marginBottom: "20px",
  },
  inputGroup: { position: "relative", width: "100%" },
  input: {
    width: "100%",
    padding: "12px 40px 12px 10px",
    border: "none",
    borderBottom: "2px solid #ccc",
    background: "transparent",
    fontSize: "0.9rem",
    color: C.text,
    outline: "none",
    transition: "border-color 0.3s ease, box-shadow 0.3s ease",
    fontFamily: "inherit",
    borderRadius: 0,
    WebkitAppearance: "none",
  },
  label: {
    position: "absolute",
    left: "10px",
    top: "12px",
    color: "#888",
    fontSize: "0.9rem",
    pointerEvents: "none",
    transition: "0.3s ease",
  },
  underline: {
    position: "absolute",
    left: 0, bottom: 0,
    height: "2px",
    width: "0%",
    background: C.primary,
    transition: "width 0.3s ease",
  },
  inputIcon: {
    position: "absolute",
    right: "10px",
    top: "14px",
    color: "#999",
    transition: "color 0.3s ease",
    display: "flex",
    alignItems: "center",
  },
  eyeToggle: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#999",
    display: "flex",
    alignItems: "center",
    padding: 0,
  },
  showPassLabel: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    fontSize: "0.85rem",
    marginTop: "16px",
    marginBottom: "20px",
    color: C.text,
    cursor: "pointer",
  },
  checkbox: {
    marginRight: "6px",
    accentColor: C.primary,
    cursor: "pointer",
  },
  btn: {
    width: "100%",
    background: C.primary,
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "25px",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "0.3s",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
  },
  footer: {
    marginTop: "16px",
    color: C.text,
    fontSize: "0.9rem",
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
  },
  footerP: { margin: 0, color: C.text },
  footerLink: {
    color: C.primary,
    fontWeight: "bold",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    padding: 0,
  },
};

export default Login;
