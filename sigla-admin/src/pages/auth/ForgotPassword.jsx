import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  forgotPassword,
  resendCode,
  resetPassword,
  verifyResetCode,
} from "../../api/authApi.js";
import AppModal from "../../components/AppModal.jsx";
import Button from "../../components/Button.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { isKnownDomain, validateEmail } from "../../utils/emailValidation.js";

const isValidPassword = (password) =>
  password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);

const STEP_COPY = {
  forgot: {
    eyebrow: "Password recovery · Step 1 of 3",
    title: "Reset your password",
    description: "Enter the email address linked to your administrator account.",
  },
  verify: {
    eyebrow: "Password recovery · Step 2 of 3",
    title: "Check your email",
    description: "Enter the six-digit verification code. It expires after 5 minutes.",
  },
  reset: {
    eyebrow: "Password recovery · Step 3 of 3",
    title: "Create a new password",
    description: "Choose a secure password to regain access to your account.",
  },
};

const ForgotPassword = () => {
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState("forgot");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(() => Array(6).fill(""));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [passwordErrors, setPasswordErrors] = useState({});
  const cooldownRef = useRef(null);
  const otpRefs = useRef([]);

  const screen = STEP_COPY[step];

  const startCooldown = useCallback(() => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((current) => {
        if (current <= 1) {
          clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
  }, []);

  const sendResetCode = useCallback(async () => {
    const normalizedEmail = email.trim();
    setConfirmEmail(false);
    setLoading(true);
    setEmailError("");
    try {
      await forgotPassword(normalizedEmail);
      setEmail(normalizedEmail);
      setStep("verify");
      startCooldown();
      toast.success("Verification code sent. Valid for 5 minutes.");
    } catch (error) {
      setEmailError(error.response?.data?.message || "Failed to send verification code.");
    } finally {
      setLoading(false);
    }
  }, [email, startCooldown, toast]);

  const handleForgot = (event) => {
    event.preventDefault();
    const validationError = validateEmail(email);
    if (validationError) {
      setEmailError(validationError);
      return;
    }
    if (!isKnownDomain(email)) {
      setConfirmEmail(true);
      return;
    }
    sendResetCode();
  };

  const updateOtp = (index, rawValue) => {
    setCodeError("");
    const digits = rawValue.replace(/\D/g, "");
    if (!digits) {
      setCode((current) => current.map((digit, i) => (i === index ? "" : digit)));
      return;
    }

    setCode((current) => {
      const next = [...current];
      digits
        .slice(0, 6 - index)
        .split("")
        .forEach((digit, offset) => {
          next[index + offset] = digit;
        });
      return next;
    });
    otpRefs.current[Math.min(index + digits.length, 5)]?.focus();
  };

  const handleOtpKeyDown = (index, event) => {
    if (event.key === "Backspace" && !code[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      otpRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < 5) {
      event.preventDefault();
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (event) => {
    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!digits) return;
    event.preventDefault();
    setCodeError("");
    setCode(Array.from({ length: 6 }, (_, index) => digits[index] || ""));
    otpRefs.current[Math.min(digits.length, 5)]?.focus();
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    if (code.some((digit) => !digit)) {
      setCodeError("Enter the complete 6-digit verification code.");
      return;
    }

    setLoading(true);
    setCodeError("");
    try {
      await verifyResetCode(email, code.join(""));
      setStep("reset");
      toast.success("Code verified. Create your new password.");
    } catch (error) {
      setCodeError(error.response?.data?.message || "The code is invalid or has expired.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || loading) return;
    setLoading(true);
    setCodeError("");
    try {
      await resendCode(email, "password_reset");
      startCooldown();
      toast.success("A new verification code was sent.");
    } catch (error) {
      setCodeError(error.response?.data?.message || "Failed to resend the code.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    const errors = {};
    if (!isValidPassword(newPassword)) {
      errors.newPassword = "Use at least 8 characters, including a letter and a number.";
    }
    if (!confirmPassword) {
      errors.confirmPassword = "Confirm your new password.";
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }
    if (Object.keys(errors).length > 0) {
      setPasswordErrors(errors);
      return;
    }

    setLoading(true);
    setPasswordErrors({});
    try {
      await resetPassword(email, newPassword);
      toast.success("Password reset successfully. You can now log in.");
      navigate("/login");
    } catch (error) {
      setPasswordErrors({ form: error.response?.data?.message || "Failed to reset password." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="onboarding-page password-recovery-page">
      <section className="onboarding-card" aria-labelledby="password-recovery-title">
        <header className="onboarding-header">
          <p className="onboarding-step-label">{screen.eyebrow}</p>
          <h1
            id="password-recovery-title"
            className={`page-title ${step === "reset" ? "onboarding-title-one-line" : ""}`}
          >
            {screen.title}
          </h1>
          <p className="page-subtitle">{screen.description}</p>
        </header>

        {step === "forgot" && (
          <form className="onboarding-form" onSubmit={handleForgot} noValidate>
            <div className="onboarding-field">
              <label htmlFor="forgot-email">Email address</label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError("");
                }}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck="false"
                className="onboarding-input"
                aria-invalid={emailError ? "true" : undefined}
                aria-describedby={emailError ? "forgot-email-error" : undefined}
                autoFocus
                required
              />
              {emailError && (
                <p id="forgot-email-error" className="onboarding-error" role="alert">
                  {emailError}
                </p>
              )}
            </div>
            <Button type="submit" className="onboarding-submit" loading={loading}>
              Send verification code
            </Button>
            <div className="password-recovery-back">
              <span>Remember your password?</span>
              <button type="button" onClick={() => navigate("/login")}>Back to login</button>
            </div>
          </form>
        )}

        {step === "verify" && (
          <form className="onboarding-form" onSubmit={handleVerify} noValidate>
            <div className="password-recovery-destination">
              <span>Code sent to</span>
              <strong>{email}</strong>
            </div>
            <fieldset
              className="onboarding-otp-fieldset"
              aria-describedby={
                codeError
                  ? "reset-code-help reset-code-error"
                  : "reset-code-help"
              }
            >
              <legend>Verification code</legend>
              <p id="reset-code-help" className="onboarding-help">
                Enter all 6 digits from the email.
              </p>
              <div className="onboarding-otp" onPaste={handleOtpPaste}>
                {code.map((digit, index) => (
                  <input
                    key={index}
                    ref={(node) => {
                      otpRefs.current[index] = node;
                    }}
                    type="text"
                    value={digit}
                    onChange={(event) => updateOtp(index, event.target.value)}
                    onKeyDown={(event) => handleOtpKeyDown(index, event)}
                    inputMode="numeric"
                    pattern="[0-9]"
                    maxLength={index === 0 ? 6 : 1}
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    aria-invalid={codeError ? "true" : undefined}
                    aria-label={`Verification code digit ${index + 1}`}
                    autoFocus={index === 0}
                  />
                ))}
              </div>
            </fieldset>
            {codeError && (
              <p id="reset-code-error" className="onboarding-error" role="alert">
                {codeError}
              </p>
            )}
            <Button type="submit" className="onboarding-submit" loading={loading}>
              Verify and continue
            </Button>
            <div className="onboarding-form-links">
              <button
                type="button"
                onClick={() => {
                  setStep("forgot");
                  setCode(Array(6).fill(""));
                  setCodeError("");
                }}
              >
                Change email
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || loading}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}

        {step === "reset" && (
          <form className="onboarding-form" onSubmit={handleReset} noValidate>
            {passwordErrors.form && (
              <p className="password-recovery-form-error" role="alert">
                {passwordErrors.form}
              </p>
            )}
            <div className="onboarding-field">
              <label htmlFor="new-password">Create a password</label>
              <input
                id="new-password"
                name="new-password"
                type={showPasswords ? "text" : "password"}
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  setPasswordErrors((current) => ({
                    ...current,
                    newPassword: "",
                    confirmPassword: "",
                    form: "",
                  }));
                }}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck="false"
                className="onboarding-input"
                aria-invalid={passwordErrors.newPassword ? "true" : undefined}
                aria-describedby={
                  passwordErrors.newPassword
                    ? "new-password-help new-password-error"
                    : "new-password-help"
                }
                autoFocus
                required
              />
              <p id="new-password-help" className="onboarding-help">
                At least 8 characters, including a letter and a number.
              </p>
              {passwordErrors.newPassword && (
                <p id="new-password-error" className="onboarding-error" role="alert">
                  {passwordErrors.newPassword}
                </p>
              )}
            </div>
            <div className="onboarding-field">
              <label htmlFor="confirm-new-password">Confirm password</label>
              <input
                id="confirm-new-password"
                name="confirm-password"
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setPasswordErrors((current) => ({
                    ...current,
                    confirmPassword: "",
                    form: "",
                  }));
                }}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck="false"
                className="onboarding-input"
                aria-invalid={passwordErrors.confirmPassword ? "true" : undefined}
                aria-describedby={
                  passwordErrors.confirmPassword ? "confirm-new-password-error" : undefined
                }
                required
              />
              {passwordErrors.confirmPassword && (
                <p id="confirm-new-password-error" className="onboarding-error" role="alert">
                  {passwordErrors.confirmPassword}
                </p>
              )}
            </div>
            <label className="onboarding-show-passwords">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(event) => setShowPasswords(event.target.checked)}
              />
              Show passwords
            </label>
            <Button type="submit" className="onboarding-submit" loading={loading}>
              Save new password
            </Button>
            <div className="password-recovery-back">
              <button type="button" onClick={() => navigate("/login")}>Back to login</button>
            </div>
          </form>
        )}
      </section>

      {confirmEmail && (
        <AppModal
          title="Double-check this email address"
          onClose={() => setConfirmEmail(false)}
          onEnter={sendResetCode}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmEmail(false)}>
                Go back and edit
              </Button>
              <Button onClick={sendResetCode} loading={loading}>
                Send code
              </Button>
            </>
          }
        >
          <div className="onboarding-confirmation">
            <span aria-hidden="true"><AlertTriangle size={18} /></span>
            <div>
              <p>The verification code will be sent to:</p>
              <strong>{email}</strong>
              <small>Check for spelling errors before continuing.</small>
            </div>
          </div>
        </AppModal>
      )}
    </main>
  );
};

export default ForgotPassword;
