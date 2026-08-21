import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { setAuthMessage, takeAuthMessage } from "../../utils/authMessage.js";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";

const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
};

const FloatingInput = ({
  id, type, value, onChange, label, autoComplete, icon, delay,
}) => (
  <div
    className="auth-field-in"
    style={{ ...S.inputGroup, "--stagger-delay": delay }}
  >
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

const Button = ({ disabled, loading, succeeded, children }) => {
  const isDisabled = loading || succeeded || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      style={{
        ...S.btn,
        // Hold on a check so a successful sign-in is acknowledged before the card
        // leaves, rather than the page simply vanishing. Keeps the brand blue from
        // S.btn; opacity/cursor are reset because the button is disabled during
        // the hold and would otherwise dim mid-acknowledgement.
        ...(succeeded ? { opacity: 1, cursor: "default" } : {}),
        ...(isDisabled && !succeeded ? { opacity: 0.7, cursor: "not-allowed" } : {}),
      }}
    >
      {succeeded ? (
        <Check size={16} style={{ display: "inline-block" }} />
      ) : (
        loading && <Loader2 size={16} className="animate-spin" style={{ display: "inline-block" }} />
      )}
      {succeeded ? "Signed in" : children}
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
  // Separate from `loading` on purpose — see handleLogin.
  const [succeeded, setSucceeded] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [denied, setDenied] = useState(false);
  // Cleared on unmount so a navigation mid-sequence cannot fire setState on a
  // dead component.
  const timersRef = useRef([]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // Why the admin is back at this screen — parked by whoever navigated here
  // (a deliberate sign-out, or the session-expiry handler in AuthContext).
  // Read-once, so returning to /login later does not replay it.
  useEffect(() => {
    const message = takeAuthMessage();
    if (message) toast[message.type]?.(message.text);
    // toast is memoised in ToastContext; listing it would still re-run this on
    // any provider re-render and could replay a message collected elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    `;
    document.head.appendChild(style);
  }, []);

  const handleLogin = useCallback(async (e) => {
    e.preventDefault();
    if (loading || succeeded) return;
    setLoading(true);
    try {
      const data = await login(identifier, password);
      const admin = data?.administrator;

      // NOTE: `loading` is deliberately NOT reset here, and there is no finally
      // block. This used to reset in `finally`, which runs on the success path
      // too — it would clear the success state before it could be seen.
      setSucceeded(true);

      // The welcome belongs on the page being navigated TO; this component
      // unmounts before a toast fired here could render.
      // Administrator has no name fields — username is the only human label.
      setAuthMessage(
        "success",
        admin?.username ? `Welcome back, ${admin.username}` : "Welcome back",
      );

      // Hold on the check, then let the card leave before the route changes.
      timersRef.current.push(
        setTimeout(() => setExiting(true), 400),
        setTimeout(() => {
          navigate(admin?.must_complete_setup ? "/onboarding" : "/dashboard");
        }, 620),
      );
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Login failed");
      setDenied(true);
      setLoading(false);
    }
  }, [identifier, password, login, navigate, toast, loading, succeeded]);

  return (
    <div className="auth-page-wrapper" style={S.pageWrapper}>
      <div style={S.background} />
      {/* Entrance on mount, exit once the sign-in is acknowledged. */}
      <div
        className={`sigla-login-container ${exiting ? "auth-card-out" : "auth-card-in"}`}
        style={S.loginContainer}
      >
        {/* Rejection cue. A separate element on purpose: a second `animation`
            shorthand on the card would replace its entrance/exit animation
            rather than stack with it. Class is dropped on animationend so a
            repeat failure replays it — a class left applied will not re-trigger. */}
        <div
          className={`auth-deny-overlay ${denied ? "is-denied" : ""}`}
          onAnimationEnd={() => setDenied(false)}
        />

        {/* Left panel */}
        <div className="sigla-left-panel" style={S.leftPanel}>
          {/* Sized in index.css: bleeds past the panel on desktop, fits whole
              inside a compact band once the panels stack. */}
          <img src="/logo.png" alt="SIGLA Logo" />
        </div>

        {/* Right panel */}
        <div className="sigla-right-panel" style={S.rightPanel}>
          <form onSubmit={handleLogin}>
            <h2 className="auth-field-in" style={{ ...S.heading, "--stagger-delay": "120ms" }}>
              Login Portal
            </h2>

            <div style={S.fields}>
              <FloatingInput
                id="identifier" type="text" value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                label="Username or Email" autoComplete="username"
                delay="180ms"
              />
              <FloatingInput
                id="password" type={showPass ? "text" : "password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                label="Password" autoComplete="current-password"
                icon={<PasswordToggleIcon showPass={showPass} onToggle={() => setShowPass(s => !s)} />}
                delay="240ms"
              />
            </div>

            <label
              className="auth-field-in"
              style={{ ...S.showPassLabel, "--stagger-delay": "300ms" }}
            >
              <input
                type="checkbox" checked={showPass}
                onChange={() => setShowPass(s => !s)} style={S.checkbox}
              />
              Show Password
            </label>

            <div className="auth-field-in" style={{ "--stagger-delay": "300ms" }}>
              <Button disabled={loading} loading={loading} succeeded={succeeded}>
                {loading ? "Logging in..." : "Login"}
              </Button>
            </div>

            <div className="auth-field-in" style={{ ...S.footer, "--stagger-delay": "380ms" }}>
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

// Layout — sizing, flex, padding — lives in index.css under `.auth-page-wrapper`,
// `.sigla-login-container`, `.sigla-left-panel` and `.sigla-right-panel`, because
// an inline style cannot carry a media query AND beats any stylesheet rule that
// tries to override it. What stays here is colour and typography only.
const S = {
  pageWrapper: {
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
    // Anchors the .auth-deny-overlay child, which positions off this box.
    position: "relative",
    borderRadius: "15px",
    overflow: "hidden",
    boxShadow: "0 6px 25px rgba(0,0,0,0.3)",
  },
  leftPanel: {
    background: C.primary,
  },
  rightPanel: {
    background: "#f0f1f9",
    color: C.text,
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
