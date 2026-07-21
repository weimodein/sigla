import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../context/ToastContext.jsx";
import {
  User,
  Mail,
  Pencil,
  Lock,
  LogOut,
  Shield,
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

// ── Profile field (read-only row) ──
const ProfileField = ({ icon: Icon, label, value }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "14px",
      padding: "14px 0",
      borderBottom: `1px solid ${C.border}`,
    }}
  >
    <div
      style={{
        width: 36,
        padding: "8px",
        borderRadius: "8px",
        background: "#f3f4f6",
        color: C.muted,
        display: "flex",
        minWidth: 36,
      }}
    >
      <Icon size={16} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <p className="text-xs" style={{ color: C.muted }}>
        {label}
      </p>
      <p className="text-sm font-medium" style={{ color: C.text }}>
        {value}
      </p>
    </div>
  </div>
);

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
  const [emailCode, setEmailCode] = useState("");
  const [emailCooldown, setEmailCooldown] = useState(0);

  const startEmailCooldown = () => {
    setEmailCooldown(60);
    const interval = setInterval(() => {
      setEmailCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRequestEmailCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      toast.error("Please enter a valid email address");
      return;
    }
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
      setTimeout(() => {
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
        {/* Left: Profile Information */}
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
                  marginBottom: "40px",
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

              {/* Detail Rows */}
              <div className="grid grid-cols-2 gap-x-6">
                <ProfileField
                  icon={User}
                  label="Username"
                  value={user?.username}
                />
                <ProfileField
                  icon={Mail}
                  label="Email"
                  value={user?.email ? maskEmail(user.email) : "No email linked"}
                />
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
                      <p
                        className="text-xs"
                        style={{ color: C.muted, margin: "1px 0 0" }}
                      >
                        Last changed: Never
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
    </div>
  );
};

export default AdministratorAccount;
