import { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import Button from "../../components/Button.jsx";
import { useModalKeys } from "../../components/useModalKeys.js";
import {
  requestEmailCode,
  verifyEmailCode,
  completeSetup,
} from "../../api/authApi.js";
import { Mail, UserCog, Check, AlertTriangle } from "lucide-react";
import { validateEmail, isKnownDomain } from "../../utils/emailValidation.js";

const C = {
  text: "#1f2937",
  primary: "#1e3a8a",
  muted: "#9ca3af",
  border: "#e5e7eb",
};

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
  const [emailCode, setEmailCode] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // Set when the address is well formed but its domain is unfamiliar — the user
  // confirms before a code is sent to a possibly mistyped address.
  const [confirmEmail, setConfirmEmail] = useState(false);
  // Lets the keyboard hook above the early returns reach sendEmailCode, which is
  // declared further down the body.
  const sendEmailCodeRef = useRef(null);

  // Credentials flow. Username is seeded from the account: an administrator
  // who is only here because their password was reset should not have to
  // invent a new name. Changing it stays optional.
  const [username, setUsername] = useState(user?.username || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [credLoading, setCredLoading] = useState(false);

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

  useEffect(() => () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
  }, []);

  // Hand-rolled overlay, not an AppModal — wire the keyboard contract explicitly.
  // Must sit above the early returns below to keep hook order stable; sendEmailCode
  // is declared later in the body, so it is reached through a lazy call that only
  // ever runs from a keypress.
  useModalKeys({
    onEscape: () => setConfirmEmail(false),
    onEnter: () => sendEmailCodeRef.current?.(),
    enabled: () => confirmEmail,
  });

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
    const emailError = validateEmail(newEmail);
    if (emailError) {
      toast.error(emailError);
      return;
    }
    if (!isKnownDomain(newEmail)) {
      setConfirmEmail(true);
      return;
    }
    sendEmailCode();
  };

  const sendEmailCode = async () => {
    setConfirmEmail(false);
    setEmailLoading(true);
    try {
      await requestEmailCode(newEmail);
      toast.success(`Verification code sent to ${newEmail}. Valid for 5 minutes.`);
      setEmailPhase("verify");
      startCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send verification code");
    } finally {
      setEmailLoading(false);
    }
  };
  sendEmailCodeRef.current = sendEmailCode;

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

  const handleVerifyEmail = async () => {
    if (emailCode.length !== 6) {
      toast.error("Please enter the 6-digit verification code");
      return;
    }
    setEmailLoading(true);
    try {
      await verifyEmailCode(newEmail, emailCode);
      await refreshUser();
      toast.success("Email linked. Now update your credentials.");
      setStep(2);
    } catch (err) {
      toast.error(err.response?.data?.message || "Invalid or expired code");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleCompleteSetup = async () => {
    if (!username.trim()) {
      toast.error("Username cannot be empty");
      return;
    }
    if (!isValidPassword(password)) {
      toast.error("Password must be at least 8 characters and include a letter and a number");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
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

  const inputCls =
    "w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
          padding: 32,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img
            src="/logo_without_text_official.png"
            alt="SIGLA"
            style={{ width: 56, height: 56, objectFit: "contain", margin: "0 auto 8px" }}
          />
          <h1 className="page-title">
            {emailStepNeeded ? "Complete Your Account Setup" : "Set a New Password"}
          </h1>
          <p className="page-subtitle" style={{ marginTop: 6 }}>
            {emailStepNeeded
              ? "For security, link an email and set your own credentials before continuing."
              : "Your password was reset. Choose a new one to continue."}
          </p>
        </div>

        {/* Step indicator — only meaningful when there is more than one step.
            An account that already has an email never sees the email step, so
            showing a "Link Email" pill it cannot act on would just confuse. */}
        {emailStepNeeded && (
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            {[1, 2].map((s) => (
              <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: step >= s ? C.primary : C.border,
                  }}
                />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: step >= s ? C.primary : C.muted,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  {s === 1 ? <Mail size={12} /> : <UserCog size={12} />}
                  {s === 1 ? "Link Email" : "Set Credentials"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Step 1 — Email */}
        {step === 1 && (
          <div className="space-y-3">
            {emailPhase === "enter" ? (
              <>
                <label className="block text-xs font-medium text-gray-600">
                  Email Address
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputCls}
                />
                <p className="small-text text-gray-400">
                  A 6-digit verification code will be sent to this address.
                </p>
                <button
                  onClick={handleRequestEmailCode}
                  disabled={emailLoading}
                  className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
                >
                  {emailLoading ? "Sending..." : "Send Verification Code"}
                </button>
              </>
            ) : (
              <>
                <p className="small-text text-gray-500">
                  Enter the 6-digit code sent to{" "}
                  <span className="font-medium">{newEmail}</span>.
                </p>
                <input
                  type="text"
                  value={emailCode}
                  onChange={(e) =>
                    setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  maxLength={6}
                  placeholder="• • • • • •"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-lg tracking-[0.5em] text-center focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
                <button
                  onClick={handleVerifyEmail}
                  disabled={emailLoading || emailCode.length !== 6}
                  className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
                >
                  {emailLoading ? "Verifying..." : "Verify & Continue"}
                </button>
                <div className="flex justify-between">
                  <button
                    onClick={() => {
                      setEmailPhase("enter");
                      setEmailCode("");
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Change email
                  </button>
                  <button
                    onClick={handleResend}
                    disabled={cooldown > 0}
                    className="text-sm text-blue-900 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 2 — Credentials */}
        {step === 2 && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {emailStepNeeded ? "New Username" : "Username"}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                className={inputCls}
              />
              {!emailStepNeeded && (
                <p className="text-[13px] text-gray-400 mt-1">
                  Keep this as it is unless you want to change it.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                className={inputCls}
              />
              <p className="text-[13px] text-gray-400 mt-1">
                At least 8 characters, including a letter and a number.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm password"
                className={inputCls}
              />
            </div>
            <button
              onClick={handleCompleteSetup}
              disabled={credLoading}
              className="w-full flex items-center justify-center gap-1.5 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
            >
              <Check size={15} />
              {credLoading
                ? "Finishing..."
                : emailStepNeeded
                  ? "Finish Setup"
                  : "Save New Password"}
            </button>
          </div>
        )}

        {/* Sign out escape hatch */}
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Unfamiliar-domain confirmation — the code can only be sent once per
          minute, so a mistyped address is costly to recover from. */}
      {confirmEmail && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: "rgba(0,0,0,0.4)",
          }}
          onClick={() => setConfirmEmail(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
              width: "100%",
              maxWidth: 420,
              padding: 24,
            }}
          >
            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <AlertTriangle size={20} style={{ color: "#f59e0b", flexShrink: 0 }} />
              <h3 className="section-title">
                Double-check this email address
              </h3>
            </div>
            <p style={{ fontSize: "var(--type-body)", color: "#6b7280", margin: "0 0 8px" }}>
              The verification code will be sent to:
            </p>
            <p
              style={{
                fontSize: "var(--type-body)",
                fontWeight: 600,
                color: C.text,
                wordBreak: "break-all",
                background: "#f9fafb",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "10px 12px",
                margin: "0 0 12px",
              }}
            >
              {newEmail}
            </p>
            <p style={{ fontSize: "var(--type-meta)", color: "#6b7280", margin: "0 0 20px" }}>
              If this is mistyped you will not receive the code, and a new one
              cannot be sent for 1 minute.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setConfirmEmail(false)}>
                Go back and edit
              </Button>
              <Button onClick={sendEmailCode}>Send code</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Onboarding;
