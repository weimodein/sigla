import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  resendCode,
} from "../../api/authApi.js";
import { Eye, EyeOff, Loader2, Check } from "lucide-react";

// ── Color palette ──
const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
};

// ── Step config ──
const STEPS = ["Email", "Verify", "New Password"];
const STEP_INDEX = { forgot: 0, verify: 1, reset: 2 };

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

// ── Password toggle icon ──
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

// ── Step progress bar ──
const StepBar = ({ currentStep }) => {
  const idx = STEP_INDEX[currentStep] ?? 0;
  return (
    <div style={S.stepBar}>
      {STEPS.map((label, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={label} style={S.stepItem}>
            <div
              style={{
                ...S.stepCircle,
                background: done ? C.primary : active ? C.primary : "#e5e7eb",
                color: done || active ? "#fff" : "#9ca3af",
                border: active ? `2px solid ${C.primary}` : "2px solid transparent",
              }}
            >
              {done ? <Check size={12} strokeWidth={3} /> : i + 1}
            </div>
            <span
              style={{
                ...S.stepLabel,
                color: active ? C.primary : done ? "#374151" : "#9ca3af",
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  ...S.stepLine,
                  background: done ? C.primary : "#e5e7eb",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── OTP digit boxes ──
const OtpInput = ({ value, onChange }) => {
  const inputsRef = useRef([]);
  const digits = value.split("");

  const handleKey = (e, i) => {
    if (e.key === "Backspace") {
      if (digits[i]) {
        const next = [...digits];
        next[i] = "";
        onChange(next.join(""));
      } else if (i > 0) {
        inputsRef.current[i - 1]?.focus();
        const next = [...digits];
        next[i - 1] = "";
        onChange(next.join(""));
      }
      return;
    }
    if (e.key === "ArrowLeft" && i > 0) {
      inputsRef.current[i - 1]?.focus();
      return;
    }
    if (e.key === "ArrowRight" && i < 5) {
      inputsRef.current[i + 1]?.focus();
    }
  };

  const handleChange = (e, i) => {
    const val = e.target.value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = val;
    onChange(next.join("").slice(0, 6));
    if (val && i < 5) inputsRef.current[i + 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, 5);
    inputsRef.current[focusIdx]?.focus();
  };

  return (
    <div style={S.otpRow}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (inputsRef.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i] || ""}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKey(e, i)}
          onPaste={handlePaste}
          style={{
            ...S.otpBox,
            borderColor: digits[i] ? C.primary : "#d1d5db",
            boxShadow: digits[i] ? `0 0 0 2px ${C.primary}22` : "none",
          }}
          autoComplete="off"
        />
      ))}
    </div>
  );
};

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
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

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
  const handleIdentifierChange = useCallback((e) => setIdentifier(e.target.value), []);
  const handlePasswordChange = useCallback((e) => setPassword(e.target.value), []);
  const toggleShowPass = useCallback(() => setShowPass((s) => !s), []);

  const handleLogin = useCallback(
    async (e) => {
      e.preventDefault();
      setLoading(true);
      try {
        await login(identifier, password);
        navigate("/dashboard");
      } catch (err) {
        toast.error(err.response?.data?.message || err.message || "Login failed");
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
        toast.success("Verification code sent to your email. Valid for 5 minutes.");
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
  const handleNewPassChange = useCallback((e) => setNewPass(e.target.value), []);
  const handleConfirmChange = useCallback((e) => setConfirm(e.target.value), []);
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

  // ── Password match state ──
  const passwordsMatch = newPass && confirm && newPass === confirm;
  const passwordsMismatch = newPass && confirm && newPass !== confirm;

  // ── UI ──
  return (
    <div style={S.pageWrapper}>
      <div style={S.background} />
      <div className="sigla-login-container" style={S.loginContainer}>

        {/* Logo panel — left on login, right on reset flow */}
        {step === "login" && (
          <div className="sigla-left-panel" style={S.leftPanel}>
            <img src="/logo.png" alt="SIGLA Logo" style={S.logo} />
          </div>
        )}

        {/* Form panel */}
        <div className="sigla-right-panel" style={S.rightPanel}>

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
                  icon={<PasswordToggleIcon showPass={showPass} onToggle={toggleShowPass} />}
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
                <button type="button" onClick={() => setStep("forgot")} style={S.footerLink}>
                  Reset it here
                </button>
              </div>
            </form>
          )}

          {/* FORGOT PASSWORD FORM */}
          {step === "forgot" && (
            <form onSubmit={handleForgot}>
              <StepBar currentStep="forgot" />
              <h2 style={S.heading}>Forgot Password?</h2>
              <p style={S.subtitle}>Enter the email address linked to your admin account.</p>
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
                <button type="button" onClick={() => setStep("login")} style={S.footerLink}>
                  Back to login
                </button>
              </div>
            </form>
          )}

          {/* VERIFY CODE FORM */}
          {step === "verify" && (
            <form onSubmit={handleVerify}>
              <StepBar currentStep="verify" />
              <h2 style={S.heading}>Verify Your Email</h2>
              <p style={S.subtitle}>
                A 6-digit code was sent to <strong>{email}</strong>. Enter it below.
              </p>

              <OtpInput value={code} onChange={setCode} />

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
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                </button>
                <button type="button" onClick={() => setStep("login")} style={S.link}>
                  Back to login
                </button>
              </div>
            </form>
          )}

          {/* RESET PASSWORD FORM */}
          {step === "reset" && (
            <form onSubmit={handleReset}>
              <StepBar currentStep="reset" />
              <h2 style={S.heading}>Set New Password</h2>
              <p style={S.subtitle}>Choose a strong password for your account.</p>
              <div style={S.fields}>
                <FloatingInput
                  key="reset-newpass"
                  id="new-pass"
                  type={showNewPass ? "text" : "password"}
                  value={newPass}
                  onChange={handleNewPassChange}
                  label="New Password"
                  autoComplete="new-password"
                  icon={
                    <PasswordToggleIcon
                      showPass={showNewPass}
                      onToggle={() => setShowNewPass((s) => !s)}
                    />
                  }
                />
                <div>
                  <FloatingInput
                    key="reset-confirm"
                    id="confirm-pass"
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={handleConfirmChange}
                    label="Confirm Password"
                    autoComplete="new-password"
                    icon={
                      <PasswordToggleIcon
                        showPass={showConfirm}
                        onToggle={() => setShowConfirm((s) => !s)}
                      />
                    }
                  />
                  {passwordsMatch && (
                    <p style={{ ...S.matchHint, color: "#16a34a" }}>✓ Passwords match</p>
                  )}
                  {passwordsMismatch && (
                    <p style={{ ...S.matchHint, color: "#dc2626" }}>✗ Passwords do not match</p>
                  )}
                </div>
              </div>

              <Button disabled={loading || !passwordsMatch} loading={loading}>
                {loading ? "Resetting..." : "Reset Password"}
              </Button>

              <div style={S.footer}>
                <p style={S.footerP}>Done resetting?</p>
                <button type="button" onClick={() => setStep("login")} style={S.footerLink}>
                  Back to login
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Logo panel — right side on reset flow */}
        {step !== "login" && (
          <div className="sigla-left-panel" style={S.leftPanel}>
            <img src="/logo.png" alt="SIGLA Logo" style={S.logo} />
          </div>
        )}
      </div>
    </div>
  );
};

// ── Style objects ──
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
    flexShrink: 0,
    background: "#f0f1f9",
    padding: "40px 45px",
    color: C.text,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    overflowY: "auto",
  },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: "28px",
    marginBottom: "24px",
  },
  heading: {
    fontSize: "1.5rem",
    fontWeight: 700,
    marginBottom: "6px",
    marginTop: "8px",
    color: C.text,
  },
  subtitle: {
    fontSize: "0.82rem",
    color: "#6b7280",
    marginBottom: "20px",
    marginTop: 0,
    lineHeight: 1.5,
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
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
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
  // Step bar
  stepBar: {
    display: "flex",
    alignItems: "center",
    marginBottom: "16px",
    gap: 0,
  },
  stepItem: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  },
  stepCircle: {
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: 700,
    flexShrink: 0,
    transition: "background 0.3s",
  },
  stepLabel: {
    fontSize: "11px",
    whiteSpace: "nowrap",
    transition: "color 0.3s",
  },
  stepLine: {
    height: "2px",
    width: "20px",
    marginLeft: "6px",
    transition: "background 0.3s",
    flexShrink: 0,
  },
  // OTP boxes
  otpRow: {
    display: "flex",
    gap: "10px",
    justifyContent: "center",
    marginBottom: "24px",
  },
  otpBox: {
    width: "44px",
    height: "52px",
    textAlign: "center",
    fontSize: "1.4rem",
    fontWeight: 700,
    border: "2px solid #d1d5db",
    borderRadius: "10px",
    background: "#fff",
    color: C.text,
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
    fontFamily: "inherit",
  },
  // Password match hint
  matchHint: {
    fontSize: "0.78rem",
    marginTop: "6px",
    marginLeft: "4px",
    fontWeight: 500,
  },
};

export default Login;
