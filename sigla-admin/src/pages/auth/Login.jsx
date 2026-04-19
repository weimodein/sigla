import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  resendCode,
} from "../../api/authApi.js";
import { Eye, EyeOff, Loader2 } from "lucide-react";

// ── Color palette ──
const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
};

// ── Reusable Floating Input ──
const FloatingInput = ({
  id,
  type,
  value,
  onChange,
  label,
  maxLength,
  inputMode,
  pattern,
  autoComplete,
  icon,
}) => (
  <div style={S.inputGroup}>
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      required
      maxLength={maxLength}
      inputMode={inputMode}
      pattern={pattern}
      autoComplete={autoComplete}
      className="sigla-input"
      style={S.input}
      placeholder=" "
    />
    <label style={S.label}>{label}</label>
    {icon && <span style={S.inputIcon}>{icon}</span>}
    <span className="sigla-underline" style={S.underline} />
  </div>
);

// ── Primary Button ──
const Button = ({ disabled, loading, children }) => {
  const isDisabled = loading || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      style={{
        ...S.btn,
        ...(isDisabled ? { opacity: 0.7, cursor: "not-allowed" } : {}),
      }}
    >
      {loading && (
        <Loader2
          size={16}
          style={{
            display: "inline-block",
            animation: "sigla-spin 0.8s ease-in-out infinite",
          }}
        />
      )}
      {children}
    </button>
  );
};

// ── Password toggle icon component ──
const PasswordToggleIcon = ({ showPass, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    style={S.eyeToggle}
    tabIndex={-1}
    aria-label={showPass ? "Hide password" : "Show password"}
  >
    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
  </button>
);

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const toast = useToast();

  // step: login | forgot | verify | reset
  const [step, setStep] = useState("login");
  const [loading, setLoading] = useState(false);

  // Login fields
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  // Forgot/reset fields
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");

  // Resend cooldown
  const [resendCooldown, setResendCooldown] = useState(0);

  // Inject CSS animations (only once)
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
      .sigla-input:focus ~ .sigla-underline {
        width: 100% !important;
      }
      .sigla-input:focus ~ .sigla-icon {
        color: ${C.primary} !important;
      }
      .sigla-input[type="password"]::-ms-reveal,
      .sigla-input[type="password"]::-ms-clear {
        display: none;
      }
      .sigla-input::-webkit-credentials-auto-fill-button,
      .sigla-input::-webkit-password-toggle {
        display: none;
      }
      @keyframes sigla-spin {
        to { transform: rotate(360deg); }
      }
      @media (max-width: 768px) {
        .sigla-login-container {
          flex-direction: column !important;
          width: 90% !important;
          height: auto !important;
          max-height: none !important;
        }
        .sigla-left-panel {
          width: 100% !important;
          padding: 30px 20px !important;
          flex-shrink: 0 !important;
        }
        .sigla-right-panel {
          width: 100% !important;
          padding: 30px 25px !important;
        }
      }
      @media (max-width: 480px) {
        .sigla-login-container {
          width: 95% !important;
        }
        .sigla-right-panel {
          padding: 25px 20px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const startCooldown = useCallback(() => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // ── Login handlers ──
  const handleIdentifierChange = useCallback(
    (e) => setIdentifier(e.target.value),
    [],
  );
  const handlePasswordChange = useCallback(
    (e) => setPassword(e.target.value),
    [],
  );
  const toggleShowPass = useCallback(() => setShowPass((s) => !s), []);

  const handleLogin = useCallback(
    async (e) => {
      e.preventDefault();
      setLoading(true);
      try {
        await login(identifier, password);
        navigate("/dashboard");
      } catch (err) {
        toast.error(
          err.response?.data?.message || err.message || "Login failed",
        );
      } finally {
        setLoading(false);
      }
    },
    [identifier, password, login, navigate, toast],
  );

  // ── Forgot password handlers ──
  const handleEmailChange = useCallback((e) => setEmail(e.target.value), []);
  const handleForgot = useCallback(
    async (e) => {
      e.preventDefault();
      setLoading(true);
      try {
        await forgotPassword(email);
        toast.success(
          "Verification code sent to your email. Valid for 5 minutes.",
        );
        setStep("verify");
        startCooldown();
      } catch (err) {
        toast.error(err.response?.data?.message || "Failed to send code");
      } finally {
        setLoading(false);
      }
    },
    [email, toast, startCooldown],
  );

  // ── Verify code handlers ──
  const handleCodeChange = useCallback((e) => {
    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
  }, []);
  const handleVerify = useCallback(
    async (e) => {
      e.preventDefault();
      if (code.length !== 6) {
        toast.error("Please enter the 6-digit verification code");
        return;
      }
      setLoading(true);
      try {
        await verifyResetCode(email, code);
        toast.success("Code verified. Please set your new password.");
        setStep("reset");
      } catch (err) {
        toast.error(err.response?.data?.message || "Invalid or expired code");
      } finally {
        setLoading(false);
      }
    },
    [email, code, toast],
  );

  // ── Resend code ──
  const handleResend = useCallback(async () => {
    if (resendCooldown > 0) return;
    try {
      await resendCode(email, "password_reset");
      toast.success("New verification code sent.");
      startCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to resend code");
    }
  }, [email, resendCooldown, toast, startCooldown]);

  // ── Reset password handlers ──
  const handleNewPassChange = useCallback(
    (e) => setNewPass(e.target.value),
    [],
  );
  const handleConfirmChange = useCallback(
    (e) => setConfirm(e.target.value),
    [],
  );
  const handleReset = useCallback(
    async (e) => {
      e.preventDefault();
      if (newPass !== confirm) {
        toast.error("Passwords do not match");
        return;
      }
      if (newPass.length < 6) {
        toast.error("Password must be at least 6 characters");
        return;
      }
      setLoading(true);
      try {
        await resetPassword(email, newPass);
        toast.success("Password reset successfully. You can now log in.");
        setStep("login");
        setCode("");
        setNewPass("");
        setConfirm("");
        setEmail("");
      } catch (err) {
        toast.error(err.response?.data?.message || "Failed to reset password");
      } finally {
        setLoading(false);
      }
    },
    [newPass, confirm, email, toast],
  );

  // ── UI – forms inlined directly ──
  return (
    <div style={S.pageWrapper}>
      <div style={S.background} />
      <div className="sigla-login-container" style={S.loginContainer}>
        {step === "login" && (
          <div className="sigla-left-panel" style={S.leftPanel}>
            <img src="/logo.png" alt="SIGLA Logo" style={S.logo} />
          </div>
        )}

        <div
          className="sigla-right-panel"
          style={
            step === "login"
              ? S.rightPanel
              : { ...S.rightPanel, width: "100%", maxWidth: "440px" }
          }
        >
          {/* LOGIN FORM */}
          {step === "login" && (
            <form onSubmit={handleLogin}>
              <h2 style={S.heading}>Login Portal</h2>
              <div style={S.fields}>
                <FloatingInput
                  key="login-identifier"
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={handleIdentifierChange}
                  label="Username or Email"
                  autoComplete="username"
                />
                <FloatingInput
                  key="login-password"
                  id="password"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={handlePasswordChange}
                  label="Password"
                  autoComplete="current-password"
                  icon={
                    <PasswordToggleIcon
                      showPass={showPass}
                      onToggle={toggleShowPass}
                    />
                  }
                />
              </div>

              <label style={S.showPassLabel}>
                <input
                  type="checkbox"
                  checked={showPass}
                  onChange={toggleShowPass}
                  style={S.checkbox}
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
                  onClick={() => setStep("forgot")}
                  style={S.footerLink}
                >
                  Reset it here
                </button>
              </div>
            </form>
          )}

          {/* FORGOT PASSWORD FORM */}
          {step === "forgot" && (
            <form onSubmit={handleForgot}>
              <h2 style={S.heading}>Forgot Password?</h2>
              <div style={S.fields}>
                <FloatingInput
                  key="forgot-email"
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  label="Email Address"
                />
              </div>

              <Button disabled={loading} loading={loading}>
                {loading ? "Sending..." : "Send Verification Code"}
              </Button>

              <div style={S.footer}>
                <p style={S.footerP}>Remember your password?</p>
                <button
                  type="button"
                  onClick={() => setStep("login")}
                  style={S.footerLink}
                >
                  Back to login
                </button>
              </div>
            </form>
          )}

          {/* VERIFY CODE FORM */}
          {step === "verify" && (
            <form onSubmit={handleVerify}>
              <h2 style={S.heading}>Verify your email</h2>
              <div style={S.fields}>
                <FloatingInput
                  key="verify-code"
                  id="code"
                  type="text"
                  value={code}
                  onChange={handleCodeChange}
                  label="Verification Code"
                  maxLength={6}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                />
              </div>

              <Button disabled={loading || code.length !== 6} loading={loading}>
                {loading ? "Verifying..." : "Verify Code"}
              </Button>

              <div style={S.linkRow}>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown > 0}
                  style={{
                    ...S.link,
                    ...(resendCooldown > 0 ? S.linkDisabled : {}),
                  }}
                >
                  {resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : "Resend code"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("login")}
                  style={S.link}
                >
                  Back to login
                </button>
              </div>
            </form>
          )}

          {/* RESET PASSWORD FORM */}
          {step === "reset" && (
            <form onSubmit={handleReset}>
              <h2 style={S.heading}>Set New Password</h2>
              <div style={S.fields}>
                <FloatingInput
                  key="reset-newpass"
                  id="new-pass"
                  type="password"
                  value={newPass}
                  onChange={handleNewPassChange}
                  label="New Password"
                  autoComplete="new-password"
                />
                <FloatingInput
                  key="reset-confirm"
                  id="confirm-pass"
                  type="password"
                  value={confirm}
                  onChange={handleConfirmChange}
                  label="Confirm Password"
                  autoComplete="new-password"
                />
              </div>

              <Button disabled={loading} loading={loading}>
                {loading ? "Resetting..." : "Reset Password"}
              </Button>

              <div style={S.footer}>
                <p style={S.footerP}>Done resetting?</p>
                <button
                  type="button"
                  onClick={() => setStep("login")}
                  style={S.footerLink}
                >
                  Back to login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Style objects (unchanged from original) ──
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
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: `linear-gradient(135deg, ${C.primary} 0%, ${C.secondary} 60%, ${C.accent} 100%)`,
    filter: "blur(8px)",
    zIndex: -1,
  },
  loginContainer: {
    display: "flex",
    width: "700px",
    maxWidth: "95%",
    maxHeight: "480px",
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
    padding: "50px 45px",
    color: C.text,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: "32px",
    marginBottom: "20px",
  },
  heading: {
    fontSize: "1.75rem",
    fontWeight: 700,
    marginBottom: "30px",
    color: C.text,
  },
  inputGroup: {
    position: "relative",
    width: "100%",
  },
  input: {
    width: "100%",
    padding: "12px 40px 12px 10px",
    border: "none",
    borderBottom: `2px solid #ccc`,
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
    left: 0,
    bottom: 0,
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
  },
  btnDisabled: {
    opacity: 0.7,
    cursor: "not-allowed",
  },
  footer: {
    marginTop: "15px",
    color: C.text,
    fontSize: "0.9rem",
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
  },
  footerP: {
    margin: 0,
    color: C.text,
  },
  footerLink: {
    color: C.primary,
    fontWeight: "bold",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    padding: 0,
    textDecoration: "none",
  },
  linkRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "16px",
  },
  link: {
    background: "none",
    border: "none",
    color: C.primary,
    fontWeight: "bold",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontFamily: "inherit",
    padding: 0,
  },
  linkDisabled: {
    color: "#999",
    cursor: "not-allowed",
    fontWeight: 400,
  },
};

export default Login;
