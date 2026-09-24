import { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import Button from "../../components/Button.jsx";
import AppModal from "../../components/AppModal.jsx";
import {
  requestEmailCode,
  verifyEmailCode,
  completeSetup,
} from "../../api/authApi.js";
import { AlertTriangle, LogOut } from "lucide-react";
import { validateEmail, isKnownDomain } from "../../utils/emailValidation.js";

const isValidPassword = (pw) =>
  pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);

const Onboarding = () => {
  const { user, needsSetup, loading, logout, refreshUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // must_complete_setup is set both for a brand-new account and for an account
  // whose password the super administrator just reset. Only the first has an
  // email still to link — asking an administrator to re-verify an address they
  // already hold is pointless friction, so skip straight to credentials when
  // one is present.
  //
  // step: 1 = link email, 2 = set credentials
  const [step, setStep] = useState(() => (user?.email ? 2 : 1));

  // Whether the email step is part of THIS session's flow. Frozen once, so
  // linking an email at step 1 does not retroactively hide the step indicator.
  const [emailStepNeeded, setEmailStepNeeded] = useState(() => !user?.email);

  // user is hydrated synchronously from localStorage, so the initialisers above
  // normally see the right value. On a hard refresh that cached copy can be
  // stale, and getMe() resolves afterwards — sync once when it does, but only
  // ever forward (skipping a step that turns out to be done), never backward.
  const syncedFromServer = useRef(false);
  useEffect(() => {
    if (syncedFromServer.current || loading || !user) return;
    syncedFromServer.current = true;
    if (user.email) {
      setEmailStepNeeded(false);
      setStep((s) => (s === 1 ? 2 : s));
    }
  }, [loading, user]);

  // Email flow
  const [emailPhase, setEmailPhase] = useState("enter"); // "enter" | "verify"
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState(() => Array(6).fill(""));
  const [emailLoading, setEmailLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [emailError, setEmailError] = useState("");
  const [codeError, setCodeError] = useState("");
  // Set when the address is well formed but its domain is unfamiliar — the user
  // confirms before a code is sent to a possibly mistyped address.
  const [confirmEmail, setConfirmEmail] = useState(false);

  // Credentials flow. Username is seeded from the account: an administrator
  // who is only here because their password was reset should not have to
  // invent a new name. Changing it stays optional.
  const [username, setUsername] = useState(user?.username || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [credentialErrors, setCredentialErrors] = useState({});
  const [credLoading, setCredLoading] = useState(false);
  const otpRefs = useRef([]);

  // Ref + unmount cleanup: completing setup navigates away while the cooldown may
  // still be running, which otherwise leaves a 1 Hz timer on an unmounted page.
  const cooldownRef = useRef(null);

  const startCooldown = () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldown(60);
    cooldownRef.current = setInterval(() => {
      setCooldown((p) => {
        if (p <= 1) {
          clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  };

  useEffect(
    () => () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-900" />
      </div>
    );
  }
  // Not logged in → login; already set up → dashboard.
  if (!user) return <Navigate to="/login" replace />;
  if (!needsSetup) return <Navigate to="/dashboard" replace />;

  // Step 1: validate the shape, then ask for confirmation when the domain is
  // unfamiliar. A typo like "gmail.com" -> "gmaasdasd.com" is syntactically
  // valid, so only a second look catches it.
  const handleRequestEmailCode = () => {
    setEmailError("");
    const validationError = validateEmail(newEmail);
    if (validationError) {
      setEmailError(validationError);
      return;
    }
    if (!isKnownDomain(newEmail)) {
      setConfirmEmail(true);
      return;
    }
    sendEmailCode();
  };

  const sendEmailCode = async () => {
    if (emailLoading) return;
    setConfirmEmail(false);
    setEmailLoading(true);
    try {
      await requestEmailCode(newEmail);
      toast.success(
        `Verification code sent to ${newEmail}. Valid for 5 minutes.`,
      );
      setEmailPhase("verify");
      setCodeError("");
      startCooldown();
    } catch (err) {
      toast.error(
        err.response?.data?.message || "Failed to send verification code",
      );
    } finally {
      setEmailLoading(false);
    }
  };
  const handleResend = async () => {
    if (cooldown > 0) return;
    try {
      await requestEmailCode(newEmail);
      toast.success("New verification code sent.");
      startCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to resend code");
    }
  };

  const updateOtp = (index, rawValue) => {
    setCodeError("");
    const digits = rawValue.replace(/\D/g, "");
    if (!digits) {
      setEmailCode((current) =>
        current.map((digit, i) => (i === index ? "" : digit)),
      );
      return;
    }

    setEmailCode((current) => {
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
    if (event.key === "Backspace" && !emailCode[index] && index > 0) {
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
    const digits = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!digits) return;
    event.preventDefault();
    setCodeError("");
    setEmailCode(Array.from({ length: 6 }, (_, index) => digits[index] || ""));
    otpRefs.current[Math.min(digits.length, 5)]?.focus();
  };

  const handleVerifyEmail = async () => {
    setCodeError("");
    if (emailCode.some((digit) => !digit)) {
      setCodeError("Enter the complete 6-digit verification code.");
      return;
    }
    setEmailLoading(true);
    try {
      await verifyEmailCode(newEmail, emailCode.join(""));
      await refreshUser();
      toast.success("Email linked. Now update your credentials.");
      setStep(2);
    } catch (err) {
      setCodeError(
        err.response?.data?.message || "The code is invalid or has expired.",
      );
    } finally {
      setEmailLoading(false);
    }
  };

  const handleCompleteSetup = async () => {
    const errors = {};
    if (!username.trim()) {
      errors.username = "Enter a username.";
    }
    if (!isValidPassword(password)) {
      errors.password =
        "Use at least 8 characters, including a letter and a number.";
    }
    if (!confirmPassword) {
      errors.confirmPassword = "Confirm your password.";
    } else if (password !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }
    setCredentialErrors(errors);
    if (Object.keys(errors).length) {
      return;
    }
    setCredLoading(true);
    try {
      await completeSetup({ username: username.trim(), password });
      await refreshUser();
      toast.success("Setup complete. Welcome!");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to complete setup");
    } finally {
      setCredLoading(false);
    }
  };

  const inputCls = "onboarding-input";
  const screen =
    step === 1
      ? emailPhase === "enter"
        ? {
            eyebrow: "Step 1 of 2",
            title: "Add your email address",
            description:
              "We’ll use this address for account recovery and important security notices.",
          }
        : {
            eyebrow: "Step 1 of 2",
            title: "Check your email",
            description: `Enter the six-digit code we sent to ${newEmail}.`,
          }
      : {
          eyebrow: emailStepNeeded ? "Step 2 of 2" : "Account security",
          title: emailStepNeeded
            ? "Create your sign-in details"
            : "Create a new password",
          description: emailStepNeeded
            ? "Choose the username and password you’ll use to access SIGLA."
            : "Choose a secure password to regain access to your account.",
        };

  return (
    <main className="onboarding-page">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        {/* Header */}
        <header className="onboarding-header">
          <p className="onboarding-step-label">{screen.eyebrow}</p>
          <h1
            id="onboarding-title"
            className={`page-title ${screen.title === "Create a new password" ? "onboarding-title-one-line" : ""}`}
          >
            {screen.title}
          </h1>
          <p className="page-subtitle">{screen.description}</p>
        </header>

        {/* Step 1 — Email */}
        {step === 1 && (
          <form
            className="onboarding-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (emailPhase === "enter") handleRequestEmailCode();
              else handleVerifyEmail();
            }}
          >
            {emailPhase === "enter" ? (
              <>
                <label className="onboarding-label" htmlFor="onboarding-email">
                  Email address
                </label>
                <input
                  id="onboarding-email"
                  name="email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value);
                    setEmailError("");
                  }}
                  autoComplete="email"
                  spellCheck="false"
                  enterKeyHint="send"
                  className={inputCls}
                  aria-invalid={emailError ? "true" : undefined}
                  aria-describedby={
                    emailError ? "onboarding-email-error" : undefined
                  }
                  autoFocus
                  required
                />
                {emailError && (
                  <p
                    id="onboarding-email-error"
                    className="onboarding-error"
                    role="alert"
                  >
                    {emailError}
                  </p>
                )}
                <Button
                  type="submit"
                  className="onboarding-submit"
                  loading={emailLoading}
                  aria-keyshortcuts="Enter"
                >
                  Send verification code
                </Button>
              </>
            ) : (
              <>
                <fieldset
                  className="onboarding-otp-fieldset"
                  aria-describedby={
                    codeError
                      ? "onboarding-code-hint onboarding-code-error"
                      : "onboarding-code-hint"
                  }
                >
                  <legend>Verification code</legend>
                  <p id="onboarding-code-hint" className="onboarding-help">
                    The code expires after 5 minutes.
                  </p>
                  <div className="onboarding-otp" onPaste={handleOtpPaste}>
                    {emailCode.map((digit, index) => (
                      <input
                        key={index}
                        ref={(node) => {
                          otpRefs.current[index] = node;
                        }}
                        type="text"
                        value={digit}
                        onChange={(event) =>
                          updateOtp(index, event.target.value)
                        }
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
                  <p
                    id="onboarding-code-error"
                    className="onboarding-error"
                    role="alert"
                  >
                    {codeError}
                  </p>
                )}
                <Button
                  type="submit"
                  className="onboarding-submit"
                  loading={emailLoading}
                  aria-keyshortcuts="Enter"
                >
                  Verify and continue
                </Button>
                <div className="onboarding-form-links">
                  <button
                    type="button"
                    onClick={() => {
                      setEmailPhase("enter");
                      setEmailCode(Array(6).fill(""));
                      setCodeError("");
                    }}
                  >
                    Change email
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={cooldown > 0}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </>
            )}
          </form>
        )}

        {/* Step 2 — Credentials */}
        {step === 2 && (
          <form
            className="onboarding-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleCompleteSetup();
            }}
          >
            <div className="onboarding-field">
              <label htmlFor="onboarding-username">
                {emailStepNeeded ? "Create a username" : "Username"}
              </label>
              <input
                id="onboarding-username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setCredentialErrors((current) => ({
                    ...current,
                    username: "",
                  }));
                }}
                autoComplete="username"
                className={inputCls}
                aria-invalid={credentialErrors.username ? "true" : undefined}
                aria-describedby={
                  credentialErrors.username
                    ? "onboarding-username-error"
                    : undefined
                }
                required
              />
              {credentialErrors.username && (
                <p
                  id="onboarding-username-error"
                  className="onboarding-error"
                  role="alert"
                >
                  {credentialErrors.username}
                </p>
              )}
              {!emailStepNeeded && (
                <p className="onboarding-help">
                  Keep this as it is unless you want to change it.
                </p>
              )}
            </div>
            <div className="onboarding-field">
              <label htmlFor="onboarding-password">Create a password</label>
              <input
                id="onboarding-password"
                name="new-password"
                type={showPasswords ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setCredentialErrors((current) => ({
                    ...current,
                    password: "",
                    confirmPassword: "",
                  }));
                }}
                autoComplete="new-password"
                className={inputCls}
                aria-invalid={credentialErrors.password ? "true" : undefined}
                aria-describedby={
                  credentialErrors.password
                    ? "onboarding-password-hint onboarding-password-error"
                    : "onboarding-password-hint"
                }
                required
              />
              <p id="onboarding-password-hint" className="onboarding-help">
                At least 8 characters, including a letter and a number.
              </p>
              {credentialErrors.password && (
                <p
                  id="onboarding-password-error"
                  className="onboarding-error"
                  role="alert"
                >
                  {credentialErrors.password}
                </p>
              )}
            </div>
            <div className="onboarding-field">
              <label htmlFor="onboarding-confirm-password">
                Confirm password
              </label>
              <input
                id="onboarding-confirm-password"
                name="confirm-password"
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setCredentialErrors((current) => ({
                    ...current,
                    confirmPassword: "",
                  }));
                }}
                autoComplete="new-password"
                className={inputCls}
                aria-invalid={
                  credentialErrors.confirmPassword ? "true" : undefined
                }
                aria-describedby={
                  credentialErrors.confirmPassword
                    ? "onboarding-confirm-password-error"
                    : undefined
                }
                required
              />
              {credentialErrors.confirmPassword && (
                <p
                  id="onboarding-confirm-password-error"
                  className="onboarding-error"
                  role="alert"
                >
                  {credentialErrors.confirmPassword}
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
            <Button
              type="submit"
              className="onboarding-submit"
              loading={credLoading}
              aria-keyshortcuts="Enter"
            >
              {emailStepNeeded ? "Finish setup" : "Save new password"}
            </Button>
          </form>
        )}

        {/* Sign out escape hatch */}
        <footer className="onboarding-footer">
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </footer>
      </section>

      {confirmEmail && (
        <AppModal
          title="Double-check this email address"
          onClose={() => setConfirmEmail(false)}
          onEnter={sendEmailCode}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmEmail(false)}
              >
                Go back and edit
              </Button>
              <Button onClick={sendEmailCode} loading={emailLoading}>
                Send code
              </Button>
            </>
          }
        >
          <div className="onboarding-confirmation">
            <span aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
            <div>
              <p>The verification code will be sent to:</p>
              <strong>{newEmail}</strong>
              <small>
                Check for spelling errors. You’ll need to wait one minute before
                requesting another code.
              </small>
            </div>
          </div>
        </AppModal>
      )}
    </main>
  );
};

export default Onboarding;
