import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import {
  requestEmailCode,
  verifyEmailCode,
  completeSetup,
} from "../../api/authApi.js";
import { Mail, UserCog, Check } from "lucide-react";

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

  // step: 1 = link email, 2 = set credentials
  const [step, setStep] = useState(1);

  // Email flow
  const [emailPhase, setEmailPhase] = useState("enter"); // "enter" | "verify"
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Credentials flow
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [credLoading, setCredLoading] = useState(false);

  const startCooldown = () => {
    setCooldown(60);
    const iv = setInterval(() => {
      setCooldown((p) => {
        if (p <= 1) {
          clearInterval(iv);
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  };

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

  const handleRequestEmailCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      toast.error("Please enter a valid email address");
      return;
    }
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
      toast.error("Please choose a username");
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
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: C.text, margin: 0 }}>
            Complete Your Account Setup
          </h1>
          <p style={{ fontSize: "0.85rem", color: C.muted, margin: "6px 0 0" }}>
            For security, link an email and set your own credentials before continuing.
          </p>
        </div>

        {/* Step indicator */}
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
                  fontSize: 11,
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
                <p className="text-xs text-gray-400">
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
                <p className="text-xs text-gray-500">
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
                New Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                className={inputCls}
              />
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
              <p className="text-[11px] text-gray-400 mt-1">
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
              {credLoading ? "Finishing..." : "Finish Setup"}
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
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
