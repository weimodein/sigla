import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../context/ToastContext.jsx";
import {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  resendCode,
} from "../../api/authApi.js";
import { Eye, EyeOff, Loader2, AlertTriangle } from "lucide-react";
import { validateEmail, isKnownDomain } from "../../utils/emailValidation.js";

// Mirrors validatePassword in sigla-backend/src/utils/validators.js: >=8 chars,
// at least one letter, at least one number. Same rule the other screens use.
const isValidPassword = (pw) =>
  pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);

const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
};

const FloatingInput = ({
  id, type, value, onChange, label,
  maxLength, inputMode, pattern, autoComplete, icon,
}) => (
  <div style={S.inputGroup}>
    <input
      id={id} type={type} value={value} onChange={onChange}
      required maxLength={maxLength} inputMode={inputMode}
      pattern={pattern} autoComplete={autoComplete}
      className="fp-input" style={S.input} placeholder=" "
    />
    <label style={S.label}>{label}</label>
    {icon && <span style={S.inputIcon}>{icon}</span>}
    <span className="fp-underline" style={S.underline} />
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
          style={{ display: "inline-block", animation: "fp-spin 0.8s ease-in-out infinite" }}
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

const ForgotPassword = () => {
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState("forgot");
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  // Set when the address is well formed but its domain is unfamiliar — the user
  // confirms before a code is sent to a possibly mistyped address.
  const [confirmEmail, setConfirmEmail] = useState(false);

  useEffect(() => {
    if (document.getElementById("fp-dynamic-styles")) return;
    const style = document.createElement("style");
    style.id = "fp-dynamic-styles";
    style.textContent = `
      .fp-input:focus {
        border-color: ${C.primary} !important;
        box-shadow: 0 2px 0 ${C.primary};
      }
      .fp-input:focus + label,
      .fp-input:not(:placeholder-shown) + label {
        top: -10px !important;
        font-size: 0.75rem !important;
        font-weight: 500 !important;
        color: ${C.primary} !important;
      }
      .fp-input:focus ~ .fp-underline { width: 100% !important; }
      .fp-input[type="password"]::-ms-reveal,
      .fp-input[type="password"]::-ms-clear { display: none; }
      .fp-input::-webkit-credentials-auto-fill-button,
      .fp-input::-webkit-password-toggle { display: none; }
      @keyframes fp-spin { to { transform: rotate(360deg); } }
      @keyframes fp-fadein {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .fp-form-in { animation: fp-fadein 0.28s ease forwards; }
      @media (max-width: 768px) {
        .fp-container { flex-direction: column-reverse !important; width: 90% !important; max-height: none !important; }
        .fp-left { width: 100% !important; padding: 30px 25px !important; }
        .fp-right { width: 100% !important; padding: 30px 20px !important; min-height: 140px !important; }
      }
      @media (max-width: 480px) {
        .fp-container { width: 95% !important; }
        .fp-left { padding: 25px 20px !important; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Held in a ref so unmount can clear it. This page navigates to /login right
  // after a successful reset — while the 60s cooldown is still running — so
  // without cleanup every successful reset left a 1 Hz timer ticking against an
  // unmounted component for up to a minute.
  const cooldownRef = useRef(null);

  const startCooldown = useCallback(() => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((p) => {
        if (p <= 1) {
          clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
  }, []);

  // Validate the shape, then ask for confirmation when the domain is unfamiliar.
  //
  // The prompt matters MORE here than during onboarding. To avoid revealing
  // which addresses have accounts, the server answers a typo'd address exactly
  // as it answers a real one — 200, same message, no email sent. The user is
  // then dropped on the code screen waiting for mail that will never arrive,
  // with nothing to distinguish "wrong address" from "slow email". A second
  // look before sending is the only thing that catches it.
  const sendResetCode = useCallback(async () => {
    setConfirmEmail(false);
    setLoading(true);
    try {
      await forgotPassword(email);
      toast.success("Verification code sent. Valid for 5 minutes.");
      setStep("verify");
      startCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send code");
    } finally { setLoading(false); }
  }, [email, toast, startCooldown]);

  const handleForgot = useCallback((e) => {
    e.preventDefault();
    const emailError = validateEmail(email);
    if (emailError) {
      toast.error(emailError);
      return;
    }
    if (!isKnownDomain(email)) {
      setConfirmEmail(true);
      return;
    }
    sendResetCode();
  }, [email, toast, sendResetCode]);

  const handleVerify = useCallback(async (e) => {
    e.preventDefault();
    if (code.length !== 6) { toast.error("Please enter the 6-digit code"); return; }
    setLoading(true);
    try {
      await verifyResetCode(email, code);
      toast.success("Code verified. Set your new password.");
      setStep("reset");
    } catch (err) {
      toast.error(err.response?.data?.message || "Invalid or expired code");
    } finally { setLoading(false); }
  }, [email, code, toast]);

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0) return;
    try {
      await resendCode(email, "password_reset");
      toast.success("New code sent.");
      startCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to resend code");
    }
  }, [email, resendCooldown, toast, startCooldown]);

  const handleReset = useCallback(async (e) => {
    e.preventDefault();
    if (newPass !== confirm) { toast.error("Passwords do not match"); return; }
    // Must match validatePassword in sigla-backend/src/utils/validators.js —
    // this used to allow 6 characters, so "abc123" passed here and was rejected
    // by the server after a round-trip.
    if (!isValidPassword(newPass)) {
      toast.error("Password must be at least 8 characters and include a letter and a number");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email, newPass);
      toast.success("Password reset successfully. You can now log in.");
      navigate("/login");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reset password");
    } finally { setLoading(false); }
  }, [newPass, confirm, email, toast, navigate]);

  const passwordsMatch = newPass && confirm && newPass === confirm;
  const passwordsMismatch = newPass && confirm && newPass !== confirm;

  return (
    <div style={S.pageWrapper}>
      <div style={S.background} />
      <div className="fp-container" style={S.container}>

        {/* Left panel — form */}
        <div className="fp-left" style={S.leftPanel}>

          {/* ── FORGOT PASSWORD ── */}
          {step === "forgot" && (
            <form key="forgot" className="fp-form-in" onSubmit={handleForgot}>
              <h2 style={S.heading}>Forgot Password?</h2>
              <p style={S.subtitle}>
                Enter the email address linked to your admin account.
              </p>
              <div style={S.fields}>
                <FloatingInput
                  id="forgot-email" type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  label="Email Address"
                />
              </div>
              <Button disabled={loading} loading={loading}>
                {loading ? "Sending..." : "Send Verification Code"}
              </Button>
              <div style={S.footer}>
                <p style={S.footerP}>Remember your password?</p>
                <button type="button" onClick={() => navigate("/login")} style={S.footerLink}>
                  Back to login
                </button>
              </div>
            </form>
          )}

          {/* ── VERIFY CODE ── */}
          {step === "verify" && (
            <form key="verify" className="fp-form-in" onSubmit={handleVerify}>
              <h2 style={S.heading}>Verify Your Email</h2>
              <p style={S.subtitle}>
                A 6-digit code was sent to{" "}
                <strong style={{ color: C.primary }}>{email}</strong>.
                Enter it below.
              </p>
              <div style={S.fields}>
                <FloatingInput
                  id="code" type="text" value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  label="Verification Code"
                  maxLength={6} inputMode="numeric" pattern="[0-9]{6}"
                />
              </div>
              <Button disabled={loading || code.length !== 6} loading={loading}>
                {loading ? "Verifying..." : "Verify Code"}
              </Button>
              <div style={S.linkRow}>
                <button
                  type="button" onClick={handleResend}
                  disabled={resendCooldown > 0}
                  style={{ ...S.link, ...(resendCooldown > 0 ? S.linkDisabled : {}) }}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                </button>
                <button type="button" onClick={() => navigate("/login")} style={S.link}>
                  Back to login
                </button>
              </div>
            </form>
          )}

          {/* ── RESET PASSWORD ── */}
          {step === "reset" && (
            <form key="reset" className="fp-form-in" onSubmit={handleReset}>
              <h2 style={S.heading}>Set New Password</h2>
              <p style={S.subtitle}>Choose a strong password for your account.</p>
              <div style={S.fields}>
                <FloatingInput
                  id="new-pass"
                  type={showNewPass ? "text" : "password"}
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  label="New Password"
                  autoComplete="new-password"
                  icon={
                    <PasswordToggleIcon
                      showPass={showNewPass}
                      onToggle={() => setShowNewPass(s => !s)}
                    />
                  }
                />
                <div>
                  <FloatingInput
                    id="confirm-pass"
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    label="Confirm Password"
                    autoComplete="new-password"
                    icon={
                      <PasswordToggleIcon
                        showPass={showConfirm}
                        onToggle={() => setShowConfirm(s => !s)}
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
                <button type="button" onClick={() => navigate("/login")} style={S.footerLink}>
                  Back to login
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right panel — logo */}
        <div className="fp-right" style={S.rightPanel}>
          <img src="/logo.png" alt="SIGLA Logo" style={S.logo} />
        </div>
      </div>

      {/* Unfamiliar-domain confirmation. A mistyped address is especially costly
          here: to avoid revealing which addresses have accounts, the server
          answers an unknown address exactly as it answers a real one, so a typo
          silently sends nothing and the next code cannot be requested for a
          minute. Mirrors the same step in Onboarding. */}
      {confirmEmail && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 2000,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, background: "rgba(0,0,0,0.4)",
          }}
          onClick={() => setConfirmEmail(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white", borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
              width: "100%", maxWidth: 420, padding: 24,
            }}
          >
            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <AlertTriangle size={20} style={{ color: "#f59e0b", flexShrink: 0 }} />
              <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: C.text, margin: 0 }}>
                Double-check this email address
              </h3>
            </div>
            <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: "0 0 8px" }}>
              The verification code will be sent to:
            </p>
            <p
              style={{
                fontSize: "0.95rem", fontWeight: 600, color: C.text,
                wordBreak: "break-all", background: "#f9fafb",
                border: "1px solid #e5e7eb", borderRadius: 8,
                padding: "10px 12px", margin: "0 0 12px",
              }}
            >
              {email}
            </p>
            <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: "0 0 20px" }}>
              If this is mistyped you will not receive the code, and a new one
              cannot be sent for 1 minute.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmEmail(false)}
                style={{
                  padding: "8px 18px", borderRadius: 8,
                  border: "1px solid #e5e7eb", background: "white",
                  color: "#374151", fontSize: "0.875rem", fontWeight: 500,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Go back and edit
              </button>
              <button
                onClick={sendResetCode}
                style={{
                  padding: "8px 18px", borderRadius: 8, border: "none",
                  background: C.primary, color: "white",
                  fontSize: "0.875rem", fontWeight: 500,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Send code
              </button>
            </div>
          </div>
        </div>
      )}
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
  container: {
    display: "flex",
    width: "700px",
    maxWidth: "95%",
    height: "480px",
    borderRadius: "15px",
    overflow: "hidden",
    boxShadow: "0 6px 25px rgba(0,0,0,0.3)",
  },
  leftPanel: {
    width: "55%",
    background: "#f0f1f9",
    padding: "44px 48px",
    color: C.text,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    overflowY: "auto",
  },
  rightPanel: {
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
  heading: {
    fontSize: "1.75rem",
    fontWeight: 700,
    marginBottom: "12px",
    marginTop: 0,
    color: C.text,
  },
  subtitle: {
    fontSize: "0.83rem",
    color: "#6b7280",
    marginTop: 0,
    marginBottom: "26px",
    lineHeight: 1.55,
  },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: "32px",
    marginBottom: "22px",
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
    fontSize: "0.85rem",
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
  matchHint: {
    fontSize: "0.78rem",
    marginTop: "6px",
    marginLeft: "4px",
    fontWeight: 500,
  },
};

export default ForgotPassword;
