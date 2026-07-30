import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../context/ToastContext.jsx";
import { validateEmail, isKnownDomain } from "../../utils/emailValidation.js";
import {
  Mail,
  Pencil,
  AlertTriangle,
  Lock,
  LogOut,
  Shield,
  ShieldCheck,
  Calendar,
  Hash,
  X,
  Check,
} from "lucide-react";
import {
  verifyResetCode,
  resetPassword,
  resendCode,
  requestEmailCode,
  verifyEmailCode,
} from "../../api/authApi.js";
import api from "../../api/authApi.js";

// Password rule (scope §21): at least 8 chars, one letter, one number.
const isValidPassword = (pw) =>
  pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);

// Mask an email for display, e.g. "jhoren@gmail.com" -> "jh***@gmail.com".
const maskEmail = (email) => {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const masked = local.length <= 2 ? local[0] + "*" : local.slice(0, 2) + "***";
  return `${masked}@${domain}`;
};

// ── Color Palette ──
const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  muted: "#9ca3af",
  border: "#e5e7eb",
};

// ── Avatar initial display ──
const Avatar = ({ name, size = 72 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: `linear-gradient(135deg, ${C.primary}, ${C.secondary})`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontSize: size * 0.36,
      fontWeight: 700,
      flexShrink: 0,
    }}
  >
    {(name?.[0] || "A").toUpperCase()}
  </div>
);

// ── Read-only detail row (icon tile + label + value) ──
const DetailRow = ({ icon: Icon, label, children, last = false }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "14px",
      padding: "14px 0",
      borderBottom: last ? "none" : `1px solid ${C.border}`,
    }}
  >
    <div
      style={{
        width: 36,
        minWidth: 36,
        padding: "8px",
        borderRadius: "8px",
        background: "#f3f4f6",
        color: C.muted,
        display: "flex",
      }}
    >
      <Icon size={16} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <p className="text-xs" style={{ color: C.muted, margin: 0 }}>
        {label}
      </p>
      <div
        className="text-sm font-medium"
        style={{ color: C.text, marginTop: "2px" }}
      >
        {children}
      </div>
    </div>
  </div>
);

// Format a date for display, guarding against a missing/invalid value.
const formatJoinDate = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const AdministratorAccount = () => {
  const { user, logout, refreshUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // ── Profile state (username only — email has its own verified flow) ──
  const [isEditing, setIsEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({ username: "" });
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileForm({ username: user.username || "" });
    }
  }, [user]);

  // ── Email add/change flow (mirrors the password 3-step flow) ──
  const [emailStep, setEmailStep] = useState(null); // null | "enter" | "verify"
  const [emailLoading, setEmailLoading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [emailCooldown, setEmailCooldown] = useState(0);

  // All three timers below are held in refs and cleared on unmount. This page
  // logs the user out 2s after a password change, unmounting itself while a
  // cooldown may still be counting down — previously leaving live timers behind.
  const emailCooldownRef = useRef(null);
  const passCooldownRef = useRef(null);
  const logoutTimerRef = useRef(null);

  useEffect(() => () => {
    if (emailCooldownRef.current) clearInterval(emailCooldownRef.current);
    if (passCooldownRef.current) clearInterval(passCooldownRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
  }, []);

  const startEmailCooldown = () => {
    if (emailCooldownRef.current) clearInterval(emailCooldownRef.current);
    setEmailCooldown(60);
    emailCooldownRef.current = setInterval(() => {
      setEmailCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(emailCooldownRef.current);
          emailCooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Validate the shape, then confirm when the domain is unfamiliar — a typo
  // like "gmail.com" -> "gmaasdasd.com" is syntactically valid and would
  // otherwise send the code to an address the user cannot read.
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
      setEmailStep("verify");
      startEmailCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send verification code");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleResendEmailCode = async () => {
    if (emailCooldown > 0) return;
    try {
      await requestEmailCode(newEmail);
      toast.success("New verification code sent.");
      startEmailCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to resend code");
    }
  };

  const handleVerifyEmailCode = async () => {
    if (emailCode.length !== 6) {
      toast.error("Please enter the 6-digit verification code");
      return;
    }
    setEmailLoading(true);
    try {
      await verifyEmailCode(newEmail, emailCode);
      toast.success("Email verified and linked successfully.");
      await refreshUser();
      setEmailStep(null);
      setNewEmail("");
      setEmailCode("");
    } catch (err) {
      toast.error(err.response?.data?.message || "Invalid or expired code");
    } finally {
      setEmailLoading(false);
    }
  };

  const cancelEmailFlow = () => {
    setEmailStep(null);
    setNewEmail("");
    setEmailCode("");
  };

  // ── Change password state ─────────────────────────────────
  const [passStep, setPassStep] = useState(null);
  const [passLoading, setPassLoading] = useState(false);
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const startCooldown = () => {
    if (passCooldownRef.current) clearInterval(passCooldownRef.current);
    setResendCooldown(60);
    passCooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(passCooldownRef.current);
          passCooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRequestCode = async () => {
    setPassLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: user?.email });
      toast.success(
        `Verification code sent to ${user?.email}. Valid for 5 minutes.`,
      );
      setPassStep("verify");
      startCooldown();
    } catch (err) {
      toast.error(
        err.response?.data?.message || "Failed to send verification code",
      );
    } finally {
      setPassLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      await resendCode(user?.email, "password_reset");
      toast.success("New verification code sent.");
      startCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to resend code");
    }
  };

  const handleVerifyCode = async () => {
    if (code.length !== 6) {
      toast.error("Please enter the 6-digit verification code");
      return;
    }
    setPassLoading(true);
    try {
      await verifyResetCode(user?.email, code);
      toast.success("Code verified. Please set your new password.");
      setPassStep("reset");
    } catch (err) {
      toast.error(err.response?.data?.message || "Invalid or expired code");
    } finally {
      setPassLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPass !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (!isValidPassword(newPass)) {
      toast.error("Password must be at least 8 characters and include a letter and a number");
      return;
    }
    setPassLoading(true);
    try {
      await resetPassword(user?.email, newPass);
      toast.success("Password changed successfully. Please log in again.");
      logoutTimerRef.current = setTimeout(() => {
        logout();
        navigate("/login");
      }, 2000);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to change password");
    } finally {
      setPassLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!profileForm.username.trim()) {
      toast.error("Username cannot be empty");
      return;
    }
    setProfileLoading(true);
    try {
      await api.put(`/administrators/${user.id}`, { username: profileForm.username.trim() });
      toast.success("Profile updated successfully.");
      await refreshUser();
      setIsEditing(false);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update profile");
    } finally {
      setProfileLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setProfileForm({ username: user?.username || "" });
    setIsEditing(false);
  };

  // ── JSX ───────────────────────────────────────────────────
  if (!user) return null;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 700,
            color: C.text,
            margin: 0,
          }}
        >
          Administrator Account
        </h1>
        <p
          style={{
            fontSize: "0.9rem",
            color: "#6b7280",
            margin: "4px 0 0",
          }}
        >
          Manage your account information and password
        </p>
      </div>

      {/* ── Top Section: Profile + Actions (two-column) ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: "24px",
          alignItems: "start",
        }}
      >
        {/* Left: Profile Information + Account Details */}
        <div>
        {!isEditing ? (
          <div className="dash-card">
            <div className="dash-card-header">
              <h3 className="text-base font-semibold text-gray-800">
                Profile Information
              </h3>
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-blue-900 hover:underline"
              >
                <Pencil size={14} />
                Edit
              </button>
            </div>
            <div className="dash-card-body">
              {/* Avatar + Name */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                }}
              >
                <Avatar name={user?.username} />
                <div>
                  <p
                    className="text-base font-semibold"
                    style={{ color: C.text, margin: 0 }}
                  >
                    {user?.username}
                  </p>
                  <p
                    className="text-sm"
                    style={{ color: C.muted, margin: "2px 0 0" }}
                  >
                    {user?.email ? maskEmail(user.email) : "No email linked"}
                  </p>
                  <span
                    className="inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full mt-1"
                    style={{
                      background: `${C.primary}22`,
                      color: C.primary,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {user?.role?.replace("_", " ")}
                  </span>
                </div>
              </div>

            </div>
          </div>
        ) : (
          <div className="dash-card">
            <div className="dash-card-header">
              <h3 className="text-base font-semibold text-gray-800">
                Edit Profile
              </h3>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:underline"
              >
                <X size={14} />
                Cancel
              </button>
            </div>
            <div className="dash-card-body">
              {/* Avatar + Name preview */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  marginBottom: "20px",
                  paddingBottom: "20px",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <Avatar name={user?.username} />
                <div>
                  <p
                    className="text-base font-semibold"
                    style={{ color: C.text, margin: 0 }}
                  >
                    {user?.username}
                  </p>
                  <p
                    className="text-sm"
                    style={{ color: C.muted, margin: "2px 0 0" }}
                  >
                    Updating account details
                  </p>
                </div>
              </div>

              {/* Edit Fields — username only; email is changed via its own verified flow */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={profileForm.username}
                  onChange={(e) =>
                    setProfileForm({
                      ...profileForm,
                      username: e.target.value,
                    })
                  }
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
                <p className="text-xs text-gray-400 mt-2">
                  To change your email address, use the Email section on the right.
                </p>
              </div>

              {/* Save Bar */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "8px",
                  marginTop: "20px",
                  paddingTop: "16px",
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                <button
                  onClick={handleCancelEdit}
                  className="px-4 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
                >
                  Discard Changes
                </button>
                <button
                  onClick={handleUpdateProfile}
                  disabled={profileLoading}
                  className="flex items-center gap-1.5 px-4 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                >
                  <Check size={14} />
                  {profileLoading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Account Details — read-only facts about this account. Sits outside
            the edit/read ternary so it stays visible while editing. */}
        <div className="dash-card">
          <div className="dash-card-header">
            <h3 className="text-base font-semibold text-gray-800">
              Account Details
            </h3>
          </div>
          <div className="dash-card-body" style={{ paddingTop: "4px", paddingBottom: "8px" }}>
            <DetailRow icon={Calendar} label="Member since">
              {formatJoinDate(user?.created_at)}
            </DetailRow>

            <DetailRow icon={ShieldCheck} label="Account status">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: user?.status === "active" ? "#22c55e" : "#ef4444",
                    flexShrink: 0,
                  }}
                />
                <span style={{ textTransform: "capitalize" }}>
                  {user?.status || "—"}
                </span>
              </span>
            </DetailRow>

            <DetailRow icon={Shield} label="Role">
              <span style={{ textTransform: "capitalize" }}>
                {user?.role ? user.role.replace("_", " ") : "—"}
              </span>
            </DetailRow>

            <DetailRow icon={Hash} label="Account ID" last>
              {user?.id != null ? `#${user.id}` : "—"}
            </DetailRow>
          </div>
        </div>
        </div>

        {/* Right: Quick Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Email Card — add/change with 6-digit verification */}
          <div className="dash-card">
            <div className="dash-card-header">
              <h3 className="text-base font-semibold text-gray-800">Email Address</h3>
            </div>
            <div className="dash-card-body">
              {!emailStep ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: `${C.primary}15`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.primary,
                      }}
                    >
                      <Mail size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p className="text-sm font-medium" style={{ color: C.text, margin: 0 }}>
                        {user?.email ? maskEmail(user.email) : "No email linked"}
                      </p>
                      <p className="text-xs" style={{ color: C.muted, margin: "1px 0 0" }}>
                        {user?.email ? "Verified" : "Add an email to enable password recovery"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEmailStep("enter")}
                    className="w-full text-sm font-semibold py-2 rounded-lg transition bg-blue-900 hover:bg-blue-800 text-white"
                  >
                    {user?.email ? "Change Email" : "Add Email Address"}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Step indicator */}
                  <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
                    {["enter", "verify"].map((s, i) => (
                      <div
                        key={s}
                        style={{
                          flex: 1,
                          height: "3px",
                          borderRadius: "2px",
                          background:
                            ["enter", "verify"].indexOf(emailStep) >= i ? C.primary : C.border,
                        }}
                      />
                    ))}
                  </div>

                  {/* Step 1 — enter new email */}
                  {emailStep === "enter" && (
                    <>
                      <p className="text-xs text-gray-500">
                        Enter the email address to link. A 6-digit code will be sent to it.
                      </p>
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                      />
                      <button
                        onClick={handleRequestEmailCode}
                        disabled={emailLoading}
                        className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                      >
                        {emailLoading ? "Sending..." : "Send Verification Code"}
                      </button>
                      <button
                        onClick={cancelEmailFlow}
                        className="w-full text-sm text-gray-500 hover:text-gray-700 transition"
                      >
                        Cancel
                      </button>
                    </>
                  )}

                  {/* Step 2 — verify code */}
                  {emailStep === "verify" && (
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
                        onClick={handleVerifyEmailCode}
                        disabled={emailLoading || emailCode.length !== 6}
                        className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                      >
                        {emailLoading ? "Verifying..." : "Verify & Link Email"}
                      </button>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <button
                          onClick={() => {
                            setEmailStep("enter");
                            setEmailCode("");
                          }}
                          className="text-sm text-gray-500 hover:text-gray-700 transition"
                        >
                          Back
                        </button>
                        <button
                          onClick={handleResendEmailCode}
                          disabled={emailCooldown > 0}
                          className="text-sm text-blue-900 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                        >
                          {emailCooldown > 0 ? `Resend in ${emailCooldown}s` : "Resend code"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Change Password Card */}
          <div className="dash-card">
            <div className="dash-card-header">
              <h3 className="text-base font-semibold text-gray-800">
                Security
              </h3>
            </div>
            <div className="dash-card-body">
              {!passStep ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      marginBottom: "8px",
                    }}
                  >
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: `${C.primary}15`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.primary,
                      }}
                    >
                      <Lock size={16} />
                    </div>
                    <div>
                      <p
                        className="text-sm font-medium"
                        style={{ color: C.text, margin: 0 }}
                      >
                        Password
                      </p>
                      {/* "Last changed: Never" was hardcoded — it read "Never"
                          even immediately after a successful change, which is
                          misleading for a security panel. There is no
                          password_changed_at column to derive a real date from,
                          so state where the history actually lives instead of
                          inventing one. */}
                      <p
                        className="text-xs"
                        style={{ color: C.muted, margin: "1px 0 0" }}
                      >
                        Changes are recorded in the activity logs
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPassStep("request")}
                    className="w-full text-sm font-semibold py-2 rounded-lg transition bg-blue-900 hover:bg-blue-800 text-white"
                  >
                    Change Password
                  </button>
                </div>
              ) : (
                /* ── Password change flow ── */
                <div className="space-y-4">
                  {/* Mini step indicator */}
                  <div
                    style={{ display: "flex", gap: "4px", marginBottom: "8px" }}
                  >
                    {["request", "verify", "reset"].map((s, i) => (
                      <div
                        key={s}
                        style={{
                          flex: 1,
                          height: "3px",
                          borderRadius: "2px",
                          background:
                            ["request", "verify", "reset"].indexOf(passStep) >=
                            i
                              ? C.primary
                              : C.border,
                        }}
                      />
                    ))}
                  </div>

                  {/* Step 1 — Request code */}
                  {passStep === "request" && (
                    <>
                      <p className="text-xs text-gray-500">
                        A 6-digit code will be sent to{" "}
                        <span className="font-medium">{user?.email}</span>.
                      </p>
                      <button
                        onClick={handleRequestCode}
                        disabled={passLoading}
                        className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                      >
                        {passLoading ? "Sending..." : "Send Code"}
                      </button>
                      <button
                        onClick={() => {
                          setPassStep(null);
                          setCode("");
                        }}
                        className="w-full text-sm text-gray-500 hover:text-gray-700 transition"
                      >
                        Cancel
                      </button>
                    </>
                  )}

                  {/* Step 2 — Verify code */}
                  {passStep === "verify" && (
                    <>
                      <p className="text-xs text-gray-500">
                        Check your email and enter the 6-digit code below.
                      </p>
                      <input
                        type="text"
                        value={code}
                        onChange={(e) =>
                          setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        maxLength={6}
                        placeholder="• • • • • •"
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-lg tracking-[0.5em] text-center focus:outline-none focus:ring-2 focus:ring-blue-900"
                      />
                      <button
                        onClick={handleVerifyCode}
                        disabled={passLoading || code.length !== 6}
                        className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                      >
                        {passLoading ? "Verifying..." : "Verify"}
                      </button>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <button
                          onClick={() => {
                            setPassStep("request");
                            setCode("");
                          }}
                          className="text-sm text-gray-500 hover:text-gray-700 transition"
                        >
                          Back
                        </button>
                        <button
                          onClick={handleResend}
                          disabled={resendCooldown > 0}
                          className="text-sm text-blue-900 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                        >
                          {resendCooldown > 0
                            ? `Resend in ${resendCooldown}s`
                            : "Resend code"}
                        </button>
                      </div>
                    </>
                  )}

                  {/* Step 3 — Set new password */}
                  {passStep === "reset" && (
                    <>
                      <div>
                        <input
                          type="password"
                          value={newPass}
                          onChange={(e) => setNewPass(e.target.value)}
                          placeholder="New password"
                          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                        />
                      </div>
                      <div>
                        <input
                          type="password"
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          placeholder="Confirm password"
                          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                        />
                      </div>
                      <button
                        onClick={handleChangePassword}
                        disabled={passLoading}
                        className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                      >
                        {passLoading ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => {
                          setPassStep(null);
                          setCode("");
                          setNewPass("");
                          setConfirm("");
                        }}
                        className="w-full text-sm text-gray-500 hover:text-gray-700 transition"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sign Out Card */}
          <div className="dash-card">
            <div className="dash-card-body">
              <button
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
                className="w-full flex items-center justify-center gap-2 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold py-2.5 rounded-lg transition"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Unfamiliar-domain confirmation — a mistyped address sends the code
          somewhere unreadable, and it cannot be resent for 1 minute. */}
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
              <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: C.text, margin: 0 }}>
                Double-check this email address
              </h3>
            </div>
            <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: "0 0 8px" }}>
              The verification code will be sent to:
            </p>
            <p
              style={{
                fontSize: "0.95rem",
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
            <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: "0 0 20px" }}>
              If this is mistyped you will not receive the code, and a new one
              cannot be sent for 1 minute.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmEmail(false)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: "white",
                  color: "#374151",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Go back and edit
              </button>
              <button
                onClick={sendEmailCode}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: C.primary,
                  color: "white",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
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

export default AdministratorAccount;
