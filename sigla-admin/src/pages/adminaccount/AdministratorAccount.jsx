import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../context/ToastContext.jsx";
import Button from "../../components/Button.jsx";
import { useModalKeys } from "../../components/useModalKeys.js";
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

// ── Avatar initial display ──
const Avatar = ({ name, size = 72 }) => (
  <div
    className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-900 to-blue-700 font-bold text-white"
    style={{
      width: size,
      height: size,
      fontSize: size * 0.36,
    }}
  >
    {(name?.[0] || "A").toUpperCase()}
  </div>
);

const AccountFact = ({ icon, label, children }) => (
  <div className="flex min-w-0 items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/80 p-4">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-400 shadow-sm">
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-xs text-gray-400">{label}</p>
      <div className="mt-0.5 truncate text-sm font-semibold text-gray-800">
        {children}
      </div>
    </div>
  </div>
);

const StepIndicator = ({ steps, current }) => {
  const currentIndex = steps.findIndex((step) => step.key === current);
  return (
    <div className="flex gap-2" aria-label="Progress">
      {steps.map((step, index) => (
        <div
          key={step.key}
          className={`flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium ${
            index <= currentIndex
              ? "bg-blue-50 text-blue-900"
              : "bg-gray-50 text-gray-400"
          }`}
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
              index <= currentIndex
                ? "bg-blue-900 text-white"
                : "bg-gray-200 text-gray-500"
            }`}
          >
            {index + 1}
          </span>
          <span className="hidden truncate sm:block">{step.label}</span>
        </div>
      ))}
    </div>
  );
};

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

  // Hand-rolled overlay, not an AppModal — wire the keyboard contract explicitly.
  useModalKeys({
    onEscape: () => setConfirmEmail(false),
    onEnter: sendEmailCode,
    enabled: () => confirmEmail,
  });

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

  const cancelPasswordFlow = () => {
    setPassStep(null);
    setCode("");
    setNewPass("");
    setConfirm("");
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">
            Administrator Account
          </h1>
          <p className="page-subtitle">
            Profile, contact information, and account security
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>

      <section className="dash-card !mb-0">
        <div className="dash-card-body">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar name={user.username} size={64} />
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold text-gray-900">
                  {user.username}
                </h2>
                <p className="mt-0.5 truncate text-sm text-gray-500">
                  {user.email ? maskEmail(user.email) : "No email linked"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-900">
                    {user.role?.replace("_", " ") || "Administrator"}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${
                      user.status === "active"
                        ? "bg-emerald-50 text-emerald-700"
                        : user.status
                          ? "bg-red-50 text-red-700"
                          : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {user.status || "Unknown status"}
                  </span>
                </div>
              </div>
            </div>
            {!isEditing ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-semibold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-900"
              >
                <Pencil size={15} />
                Edit username
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-50"
              >
                <X size={15} />
                Cancel editing
              </button>
            )}
          </div>

          {isEditing && (
            <form
              className="mt-5 border-t border-gray-100 pt-5"
              onSubmit={(event) => {
                event.preventDefault();
                handleUpdateProfile();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div>
                  <label htmlFor="account-username" className="mb-1.5 block text-xs font-semibold text-gray-600">
                    Username
                  </label>
                  <input
                    id="account-username"
                    type="text"
                    autoComplete="username"
                    value={profileForm.username}
                    onChange={(event) =>
                      setProfileForm({ ...profileForm, username: event.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm focus:border-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900/15"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
                  >
                    Discard
                  </button>
                  <button
                    type="submit"
                    disabled={profileLoading}
                    className="flex items-center gap-2 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
                  >
                    <Check size={15} />
                    {profileLoading ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
        <section className="dash-card !mb-0 h-full">
          <div className="dash-card-header">
            <h3 className="section-title">Account details</h3>
            <p className="section-subtitle">Read-only account information</p>
          </div>
          <div className="dash-card-body grid gap-3 sm:grid-cols-2">
            <AccountFact icon={<Calendar size={16} />} label="Member since">
              {formatJoinDate(user.created_at)}
            </AccountFact>
            <AccountFact icon={<ShieldCheck size={16} />} label="Account status">
              <span className="inline-flex items-center gap-2 capitalize">
                <span
                  className={`h-2 w-2 rounded-full ${
                    user.status === "active"
                      ? "bg-emerald-500"
                      : user.status
                        ? "bg-red-500"
                        : "bg-gray-300"
                  }`}
                />
                {user.status || "Unknown"}
              </span>
            </AccountFact>
            <AccountFact icon={<Shield size={16} />} label="Role">
              <span className="capitalize">{user.role?.replace("_", " ") || "—"}</span>
            </AccountFact>
            <AccountFact icon={<Hash size={16} />} label="Account ID">
              {user.id != null ? `#${user.id}` : "—"}
            </AccountFact>
          </div>
        </section>

        <section className="dash-card !mb-0 h-full">
          <div className="dash-card-header">
            <h3 className="section-title">Security & access</h3>
            <p className="section-subtitle">Verified contact and password controls</p>
          </div>
          <div className="divide-y divide-gray-100">
            <div className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-900">
                    <Mail size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-gray-800">Email address</h4>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        user.email
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}>
                        {user.email ? "Verified" : "Not linked"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {user.email ? maskEmail(user.email) : "Required for password recovery"}
                    </p>
                  </div>
                </div>
                {!emailStep && (
                  <button
                    type="button"
                    onClick={() => {
                      cancelPasswordFlow();
                      setEmailStep("enter");
                    }}
                    className="shrink-0 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-semibold text-blue-900 transition hover:border-blue-200 hover:bg-blue-50"
                  >
                    {user.email ? "Change email" : "Add email"}
                  </button>
                )}
              </div>

              {emailStep && (
                <div className="mt-5 space-y-4 rounded-xl border border-gray-100 bg-gray-50/70 p-4">
                  <StepIndicator
                    steps={[
                      { key: "enter", label: "New email" },
                      { key: "verify", label: "Verify" },
                    ]}
                    current={emailStep}
                  />

                  {emailStep === "enter" && (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleRequestEmailCode();
                      }}
                    >
                      <div>
                        <label htmlFor="new-email" className="mb-1.5 block text-xs font-semibold text-gray-600">
                          New email address
                        </label>
                        <input
                          id="new-email"
                          type="email"
                          autoComplete="email"
                          value={newEmail}
                          onChange={(event) => setNewEmail(event.target.value)}
                          placeholder="you@example.com"
                          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm focus:border-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900/15"
                        />
                        <p className="mt-1.5 text-xs text-gray-400">
                          We will send a six-digit verification code to this address.
                        </p>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelEmailFlow}
                          className="rounded-lg px-3.5 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={emailLoading}
                          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
                        >
                          {emailLoading ? "Sending..." : "Send code"}
                        </button>
                      </div>
                    </form>
                  )}

                  {emailStep === "verify" && (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleVerifyEmailCode();
                      }}
                    >
                      <div>
                        <label htmlFor="email-code" className="mb-1.5 block text-xs font-semibold text-gray-600">
                          Verification code
                        </label>
                        <input
                          id="email-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={emailCode}
                          onChange={(event) =>
                            setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                          }
                          maxLength={6}
                          placeholder="000000"
                          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-center text-lg tracking-[0.45em] focus:border-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900/15"
                        />
                        <p className="mt-1.5 break-all text-xs text-gray-400">
                          Sent to {newEmail}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEmailStep("enter");
                              setEmailCode("");
                            }}
                            className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            onClick={handleResendEmailCode}
                            disabled={emailCooldown > 0}
                            className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-900 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-gray-400"
                          >
                            {emailCooldown > 0 ? `Resend in ${emailCooldown}s` : "Resend"}
                          </button>
                        </div>
                        <button
                          type="submit"
                          disabled={emailLoading || emailCode.length !== 6}
                          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
                        >
                          {emailLoading ? "Verifying..." : "Verify email"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>

            <div className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-900">
                    <Lock size={18} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-gray-800">Password</h4>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Changes are recorded in the activity logs
                    </p>
                  </div>
                </div>
                {!passStep && (
                  <button
                    type="button"
                    onClick={() => {
                      cancelEmailFlow();
                      setPassStep("request");
                    }}
                    disabled={!user.email}
                    title={!user.email ? "Link an email address first" : undefined}
                    className="shrink-0 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-semibold text-blue-900 transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Change password
                  </button>
                )}
              </div>

              {!user.email && !passStep && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Add and verify an email address before changing your password.
                </p>
              )}

              {passStep && (
                <div className="mt-5 space-y-4 rounded-xl border border-gray-100 bg-gray-50/70 p-4">
                  <StepIndicator
                    steps={[
                      { key: "request", label: "Send code" },
                      { key: "verify", label: "Verify" },
                      { key: "reset", label: "New password" },
                    ]}
                    current={passStep}
                  />

                  {passStep === "request" && (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleRequestCode();
                      }}
                    >
                      <p className="text-xs text-gray-500">
                        Send a six-digit verification code to {maskEmail(user.email)}.
                      </p>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelPasswordFlow}
                          className="rounded-lg px-3.5 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={passLoading}
                          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
                        >
                          {passLoading ? "Sending..." : "Send code"}
                        </button>
                      </div>
                    </form>
                  )}

                  {passStep === "verify" && (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleVerifyCode();
                      }}
                    >
                      <div>
                        <label htmlFor="password-code" className="mb-1.5 block text-xs font-semibold text-gray-600">
                          Verification code
                        </label>
                        <input
                          id="password-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={code}
                          onChange={(event) =>
                            setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                          }
                          maxLength={6}
                          placeholder="000000"
                          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-center text-lg tracking-[0.45em] focus:border-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900/15"
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPassStep("request");
                              setCode("");
                            }}
                            className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            onClick={handleResend}
                            disabled={resendCooldown > 0}
                            className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-900 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-gray-400"
                          >
                            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend"}
                          </button>
                        </div>
                        <button
                          type="submit"
                          disabled={passLoading || code.length !== 6}
                          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
                        >
                          {passLoading ? "Verifying..." : "Verify code"}
                        </button>
                      </div>
                    </form>
                  )}

                  {passStep === "reset" && (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleChangePassword();
                      }}
                    >
                      <div>
                        <label htmlFor="new-password" className="mb-1.5 block text-xs font-semibold text-gray-600">
                          New password
                        </label>
                        <input
                          id="new-password"
                          type="password"
                          autoComplete="new-password"
                          value={newPass}
                          onChange={(event) => setNewPass(event.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm focus:border-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900/15"
                        />
                      </div>
                      <div>
                        <label htmlFor="confirm-password" className="mb-1.5 block text-xs font-semibold text-gray-600">
                          Confirm new password
                        </label>
                        <input
                          id="confirm-password"
                          type="password"
                          autoComplete="new-password"
                          value={confirm}
                          onChange={(event) => setConfirm(event.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm focus:border-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900/15"
                        />
                        <p className="mt-1.5 text-xs text-gray-400">
                          Use at least 8 characters with one letter and one number.
                        </p>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelPasswordFlow}
                          className="rounded-lg px-3.5 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={passLoading}
                          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
                        >
                          {passLoading ? "Saving..." : "Update password"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Unfamiliar-domain confirmation — a mistyped address sends the code
          somewhere unreadable, and it cannot be resent for 1 minute. */}
      {confirmEmail && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConfirmEmail(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-email-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3 id="confirm-email-title" className="text-base font-bold text-gray-900">
                  Double-check the email
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  The verification code will be sent to this address.
                </p>
              </div>
            </div>
            <p className="break-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800">
              {newEmail}
            </p>
            <p className="mt-3 text-xs leading-5 text-gray-500">
              If this is mistyped you will not receive the code, and a new one
              cannot be sent for 1 minute.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmEmail(false)}>
                Edit email
              </Button>
              <Button onClick={sendEmailCode}>Send code</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdministratorAccount;
