import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Calendar, Check, Hash, Lock, LogOut, Mail, Pencil, Shield, ShieldCheck,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import AppModal from "../../components/AppModal.jsx";
import Button from "../../components/Button.jsx";
import VerificationCodeInput from "../../components/VerificationCodeInput.jsx";
import {
  createEmptyVerificationCode,
  isVerificationCodeComplete,
} from "../../utils/verificationCode.js";
import { validateEmail, isKnownDomain, normalizeEmail } from "../../utils/emailValidation.js";
import { setAuthMessage } from "../../utils/authMessage.js";
import {
  PASSWORD_HELP, PASSWORD_MAX, USERNAME_HELP, validatePassword,
  validatePasswordConfirmation, validateUsername,
} from "../../utils/credentialValidation.js";
import {
  verifyResetCode, resetPassword, resendCode, requestEmailCode, verifyEmailCode,
} from "../../api/authApi.js";
import api from "../../api/authApi.js";

const maskEmail = (email) => {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const masked = local.length <= 2 ? `${local[0]}*` : `${local.slice(0, 2)}***`;
  return `${masked}@${domain}`;
};

const Avatar = ({ name, size = 72 }) => (
  <div
    className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-900 to-blue-700 font-bold text-white"
    style={{ width: size, height: size, fontSize: size * 0.36 }}
    aria-hidden="true"
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
      <div className="mt-0.5 min-w-0 break-words text-sm font-semibold text-gray-800">{children}</div>
    </div>
  </div>
);

const StepIndicator = ({ steps, current }) => {
  const currentIndex = steps.findIndex((step) => step.key === current);
  return (
    <ol className="flex gap-2" aria-label="Progress">
      {steps.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <li
            key={step.key}
            aria-current={isCurrent ? "step" : undefined}
            className={`flex flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-[13px] font-medium ${
              isCurrent
                ? "border-blue-200 bg-blue-50 text-blue-900"
                : isComplete
                  ? "border-transparent bg-gray-50 text-gray-600"
                  : "border-transparent bg-gray-50 text-gray-400"
            }`}
          >
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] ${
              isCurrent
                ? "bg-blue-900 text-white"
                : isComplete
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-200 text-gray-500"
            }`}>
              {isComplete ? <Check size={12} strokeWidth={3} /> : index + 1}
            </span>
            <span className="hidden truncate sm:block">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
};

const ModalNotice = ({ icon, title, children }) => (
  <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/80 p-4">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-900 shadow-sm">
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-sm font-semibold text-gray-800">{title}</p>
      <div className="mt-0.5 text-xs leading-5 text-gray-500">{children}</div>
    </div>
  </div>
);

const formatJoinDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
};

const AdministratorAccount = () => {
  const { user, logout, refreshUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({ username: "" });
  const [profileLoading, setProfileLoading] = useState(false);
  const [emailStep, setEmailStep] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [emailCode, setEmailCode] = useState(createEmptyVerificationCode);
  const [emailCodeError, setEmailCodeError] = useState("");
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [passStep, setPassStep] = useState(null);
  const [passLoading, setPassLoading] = useState(false);
  const [code, setCode] = useState(createEmptyVerificationCode);
  const [passwordCodeError, setPasswordCodeError] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const emailCooldownRef = useRef(null);
  const passCooldownRef = useRef(null);
  const logoutTimerRef = useRef(null);
  const emailFlowActiveRef = useRef(false);
  const passwordFlowActiveRef = useRef(false);

  useEffect(() => {
    if (user) setProfileForm({ username: user.username || "" });
  }, [user]);

  useEffect(() => () => {
    if (emailCooldownRef.current) clearInterval(emailCooldownRef.current);
    if (passCooldownRef.current) clearInterval(passCooldownRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
  }, []);

  const startCooldown = (timerRef, setter) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setter(60);
    timerRef.current = setInterval(() => {
      setter((previous) => {
        if (previous <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
  };

  const openEmailFlow = () => {
    passwordFlowActiveRef.current = false;
    emailFlowActiveRef.current = true;
    setPassStep(null);
    setEmailStep("enter");
  };

  const cancelEmailFlow = () => {
    emailFlowActiveRef.current = false;
    setEmailStep(null);
    setConfirmEmail(false);
    setNewEmail("");
    setEmailCode(createEmptyVerificationCode());
    setEmailCodeError("");
    setEmailCooldown(0);
    if (emailCooldownRef.current) clearInterval(emailCooldownRef.current);
    emailCooldownRef.current = null;
  };

  const sendEmailCode = async () => {
    const normalizedEmail = normalizeEmail(newEmail);
    setConfirmEmail(false);
    setEmailLoading(true);
    try {
      await requestEmailCode(normalizedEmail);
      if (!emailFlowActiveRef.current) return;
      setNewEmail(normalizedEmail);
      toast.success(`Verification code sent to ${normalizedEmail}. Valid for 5 minutes.`);
      setEmailStep("verify");
      setEmailCodeError("");
      startCooldown(emailCooldownRef, setEmailCooldown);
    } catch (error) {
      if (emailFlowActiveRef.current) {
        toast.error(error.response?.data?.message || "Failed to send verification code");
      }
    } finally {
      setEmailLoading(false);
    }
  };

  const handleRequestEmailCode = () => {
    const emailError = validateEmail(newEmail);
    if (emailError) return toast.error(emailError);
    if (!isKnownDomain(newEmail)) return setConfirmEmail(true);
    sendEmailCode();
  };

  const handleResendEmailCode = async () => {
    if (emailCooldown > 0) return;
    try {
      await requestEmailCode(newEmail);
      if (!emailFlowActiveRef.current) return;
      toast.success("New verification code sent.");
      setEmailCodeError("");
      startCooldown(emailCooldownRef, setEmailCooldown);
    } catch (error) {
      if (emailFlowActiveRef.current) {
        toast.error(error.response?.data?.message || "Failed to resend code");
      }
    }
  };

  const handleVerifyEmailCode = async () => {
    if (!isVerificationCodeComplete(emailCode)) {
      setEmailCodeError("Enter the complete 6-digit verification code.");
      return;
    }
    setEmailCodeError("");
    setEmailLoading(true);
    try {
      await verifyEmailCode(newEmail, emailCode.join(""));
      if (!emailFlowActiveRef.current) return;
      toast.success("Email verified and linked successfully.");
      await refreshUser();
      cancelEmailFlow();
    } catch (error) {
      if (emailFlowActiveRef.current) {
        setEmailCodeError(error.response?.data?.message || "Invalid or expired code.");
      }
    } finally {
      setEmailLoading(false);
    }
  };

  const openPasswordFlow = () => {
    emailFlowActiveRef.current = false;
    passwordFlowActiveRef.current = true;
    setEmailStep(null);
    setPassStep("request");
  };

  const cancelPasswordFlow = () => {
    passwordFlowActiveRef.current = false;
    setPassStep(null);
    setCode(createEmptyVerificationCode());
    setPasswordCodeError("");
    setNewPass("");
    setConfirm("");
    setShowPasswords(false);
    setResendCooldown(0);
    if (passCooldownRef.current) clearInterval(passCooldownRef.current);
    passCooldownRef.current = null;
  };

  const handleRequestCode = async () => {
    setPassLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: user?.email });
      if (!passwordFlowActiveRef.current) return;
      toast.success(`Verification code sent to ${user?.email}. Valid for 5 minutes.`);
      setPassStep("verify");
      setPasswordCodeError("");
      startCooldown(passCooldownRef, setResendCooldown);
    } catch (error) {
      if (passwordFlowActiveRef.current) {
        toast.error(error.response?.data?.message || "Failed to send verification code");
      }
    } finally {
      setPassLoading(false);
    }
  };

  const handleResendPasswordCode = async () => {
    if (resendCooldown > 0) return;
    try {
      await resendCode(user?.email, "password_reset");
      if (!passwordFlowActiveRef.current) return;
      toast.success("New verification code sent.");
      setPasswordCodeError("");
      startCooldown(passCooldownRef, setResendCooldown);
    } catch (error) {
      if (passwordFlowActiveRef.current) {
        toast.error(error.response?.data?.message || "Failed to resend code");
      }
    }
  };

  const handleVerifyPasswordCode = async () => {
    if (!isVerificationCodeComplete(code)) {
      setPasswordCodeError("Enter the complete 6-digit verification code.");
      return;
    }
    setPasswordCodeError("");
    setPassLoading(true);
    try {
      await verifyResetCode(user?.email, code.join(""));
      if (!passwordFlowActiveRef.current) return;
      setPassStep("reset");
    } catch (error) {
      if (passwordFlowActiveRef.current) {
        setPasswordCodeError(error.response?.data?.message || "Invalid or expired code.");
      }
    } finally {
      setPassLoading(false);
    }
  };

  const handleChangePassword = async () => {
    const passwordError = validatePassword(newPass);
    if (passwordError) return toast.error(passwordError);
    const confirmationError = validatePasswordConfirmation(newPass, confirm);
    if (confirmationError) return toast.error(confirmationError);
    setPassLoading(true);
    try {
      await resetPassword(user?.email, newPass);
      if (!passwordFlowActiveRef.current) return;
      passwordFlowActiveRef.current = false;
      setPassStep(null);
      toast.success("Password changed successfully. Please log in again.");
      logoutTimerRef.current = setTimeout(async () => {
        const serverInvalidated = await logout();
        if (!serverInvalidated) {
          setAuthMessage("warning", "Signed out on this device, but the server could not invalidate the session.");
        }
        navigate("/login");
      }, 2000);
    } catch (error) {
      if (passwordFlowActiveRef.current) {
        toast.error(error.response?.data?.message || "Failed to change password");
      }
    } finally {
      setPassLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    const username = profileForm.username;
    const usernameError = validateUsername(username);
    if (usernameError) return toast.error(usernameError);
    setProfileLoading(true);
    try {
      await api.put(`/administrators/${user.id}`, { username });
      toast.success("Username updated successfully.");
      await refreshUser();
      setIsEditing(false);
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update username");
    } finally {
      setProfileLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setProfileForm({ username: user?.username || "" });
    setIsEditing(false);
  };

  const handleSignOut = async () => {
    const serverInvalidated = await logout();
    setAuthMessage(
      serverInvalidated ? "info" : "warning",
      serverInvalidated
        ? "You've been signed out."
        : "Signed out on this device, but the server could not invalidate the session.",
    );
    navigate("/login");
  };

  if (!user) return null;

  const usernameError = validateUsername(profileForm.username);
  const usernameIsValid = !usernameError;
  const usernameChanged = profileForm.username !== (user.username || "");
  const passwordMatches = newPass.length > 0 && newPass === confirm;

  return (
    <>
      <div className="administrator-account-page space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Administrator Account</h1>
          <p className="page-subtitle">Profile, contact information, and account security</p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>

      <section className="dash-card !mb-0">
        <div className="dash-card-body">
          <div className="administrator-profile-row">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar name={user.username} size={64} />
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold text-gray-900">{user.username}</h2>
                <p className="mt-0.5 truncate text-sm text-gray-500">
                  {user.email ? maskEmail(user.email) : "No email linked"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[13px] font-semibold uppercase tracking-wide text-blue-900">
                    {user.role?.replace("_", " ") || "Administrator"}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[13px] font-semibold capitalize ${
                    user.status === "active"
                      ? "bg-emerald-50 text-emerald-700"
                      : user.status ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    {user.status || "Unknown status"}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setProfileForm({ username: user.username || "" });
                setIsEditing(true);
              }}
              className="administrator-profile-action flex shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-semibold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-900"
            >
              <Pencil size={15} /> Edit username
            </button>
          </div>
        </div>
      </section>

      <div className="administrator-account-grid">
        <section className="account-details-card dash-card !mb-0 h-full min-w-0">
          <div className="dash-card-header">
            <h3 className="section-title">Account details</h3>
            <p className="section-subtitle">Read-only account information</p>
          </div>
          <div className="administrator-account-facts dash-card-body">
            <AccountFact icon={<Calendar size={16} />} label="Member since">
              {formatJoinDate(user.created_at)}
            </AccountFact>
            <AccountFact icon={<ShieldCheck size={16} />} label="Account status">
              <span className="inline-flex items-center gap-2 capitalize">
                <span className={`h-2 w-2 rounded-full ${
                  user.status === "active" ? "bg-emerald-500" : user.status ? "bg-red-500" : "bg-gray-300"
                }`} />
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

        <section className="account-security-card dash-card !mb-0 h-full min-w-0">
          <div className="dash-card-header">
            <h3 className="section-title">Security &amp; access</h3>
            <p className="section-subtitle">Verified contact and password controls</p>
          </div>
          <div className="divide-y divide-gray-100">
            <div className="p-5 sm:p-6">
              <div className="administrator-security-row">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-900">
                    <Mail size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-gray-800">Email address</h4>
                      <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                        user.email ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      }`}>
                        {user.email ? "Verified" : "Not linked"}
                      </span>
                    </div>
                    <p className="mt-0.5 break-all text-xs text-gray-500">
                      {user.email ? maskEmail(user.email) : "Required for password recovery"}
                    </p>
                  </div>
                </div>
                <button type="button" onClick={openEmailFlow} className="administrator-security-action shrink-0 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-semibold text-blue-900 transition hover:border-blue-200 hover:bg-blue-50">
                  {user.email ? "Change email" : "Add email"}
                </button>
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <div className="administrator-security-row">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-900">
                    <Lock size={18} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-gray-800">Password</h4>
                    <p className="small-text mt-0.5 text-gray-500">Secure your account with a new password</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openPasswordFlow}
                  disabled={!user.email}
                  title={!user.email ? "Link an email address first" : undefined}
                  className="administrator-security-action shrink-0 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-semibold text-blue-900 transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Change password
                </button>
              </div>
              {!user.email && (
                <p className="small-text mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-700">
                  Add and verify an email address before changing your password.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
      {/* Keep dialogs outside this responsive container. CSS containment would
          otherwise make their fixed backdrops start at the page content box. */}
      </div>

      {isEditing && (
        <AppModal
          title="Update username"
          onClose={handleCancelEdit}
          onEnter={() => {
            if (!profileLoading && usernameIsValid && usernameChanged) handleUpdateProfile();
          }}
          footer={<>
            <Button variant="secondary" onClick={handleCancelEdit}>Cancel</Button>
            <Button onClick={handleUpdateProfile} loading={profileLoading} disabled={!usernameIsValid || !usernameChanged}>
              {profileLoading ? "Saving..." : "Save username"}
            </Button>
          </>}
        >
          <div className="account-modal-content">
            <p className="account-modal-copy">
              This name is shown throughout the administrator portal and in activity records.
            </p>
            <div className="account-modal-field">
              <label htmlFor="account-username" className="account-modal-label">Username</label>
              <input
                id="account-username"
                type="text"
                autoComplete="username"
                maxLength={50}
                value={profileForm.username}
                onChange={(event) => setProfileForm({ username: event.target.value })}
                aria-describedby="username-help"
                aria-invalid={profileForm.username.length > 0 && !usernameIsValid}
                className="account-modal-input"
              />
              <div id="username-help" className="account-modal-help-row account-modal-help">
                <span className={profileForm.username.length > 0 && !usernameIsValid ? "font-medium text-red-600" : "text-gray-400"}>
                  {usernameError || USERNAME_HELP}
                </span>
                <span className="shrink-0 text-gray-400">{profileForm.username.length}/50</span>
              </div>
            </div>
          </div>
        </AppModal>
      )}

      {emailStep && (
        <AppModal
          title={user.email ? "Change email address" : "Add email address"}
          onClose={cancelEmailFlow}
          onEnter={() => {
            if (emailLoading) return;
            if (emailStep === "enter") handleRequestEmailCode();
            if (emailStep === "verify" && isVerificationCodeComplete(emailCode)) {
              handleVerifyEmailCode();
            }
          }}
          footer={emailStep === "enter" ? <>
            <Button variant="secondary" onClick={cancelEmailFlow}>Cancel</Button>
            <Button onClick={handleRequestEmailCode} loading={emailLoading} disabled={!newEmail.trim()}>
              {emailLoading ? "Sending..." : "Send verification code"}
            </Button>
          </> : <>
            <Button variant="secondary" onClick={() => { setEmailStep("enter"); setEmailCode(createEmptyVerificationCode()); setEmailCodeError(""); }}>Back</Button>
            <Button onClick={handleVerifyEmailCode} loading={emailLoading} disabled={!isVerificationCodeComplete(emailCode)}>
              {emailLoading ? "Verifying..." : "Verify and update"}
            </Button>
          </>}
        >
          <div className="account-modal-content">
            <StepIndicator steps={[{ key: "enter", label: "New email" }, { key: "verify", label: "Verify" }]} current={emailStep} />
            {emailStep === "enter" && <>
              {user.email && <ModalNotice icon={<Mail size={17} />} title="Current email">{maskEmail(user.email)}</ModalNotice>}
              <div className="account-modal-field">
                <label htmlFor="new-email" className="account-modal-label">New email address</label>
                <input
                  id="new-email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck="false"
                  maxLength={100}
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  placeholder="you@example.com"
                  aria-describedby="new-email-help"
                  className="account-modal-input"
                />
                <p id="new-email-help" className="account-modal-help">
                  We’ll send a 6-digit code to confirm you can access this address.
                </p>
              </div>
            </>}
            {emailStep === "verify" && <>
              <ModalNotice icon={<Mail size={17} />} title="Check your inbox">
                A 6-digit code was sent to <strong className="break-all font-semibold text-gray-700">{newEmail}</strong>. It expires in 5 minutes.
              </ModalNotice>
              <div className="account-modal-field">
                <VerificationCodeInput
                  id="email-code"
                  value={emailCode}
                  onChange={(nextCode) => {
                    setEmailCode(nextCode);
                    setEmailCodeError("");
                  }}
                  invalid={Boolean(emailCodeError)}
                  errorId={emailCodeError ? "email-code-error" : undefined}
                />
                {emailCodeError && (
                  <p id="email-code-error" className="account-modal-error" role="alert">
                    {emailCodeError}
                  </p>
                )}
                <div className="account-modal-code-actions">
                  <span>Didn’t receive the code?</span>
                  <button type="button" onClick={handleResendEmailCode} disabled={emailCooldown > 0}>
                    {emailCooldown > 0 ? `Resend code in ${emailCooldown}s` : "Resend code"}
                  </button>
                </div>
              </div>
            </>}
          </div>
        </AppModal>
      )}

      {confirmEmail && (
        <AppModal
          title="Double-check the email"
          onClose={() => setConfirmEmail(false)}
          onEnter={() => { if (!emailLoading) sendEmailCode(); }}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirmEmail(false)}>Edit email</Button>
            <Button onClick={sendEmailCode} loading={emailLoading}>{emailLoading ? "Sending..." : "Yes, send code"}</Button>
          </>}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><AlertTriangle size={19} /></div>
              <p className="pt-0.5 text-sm leading-6 text-gray-600">
                We don’t recognize this email domain. Confirm the address before sending a verification code.
              </p>
            </div>
            <p className="break-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800">{normalizeEmail(newEmail)}</p>
          </div>
        </AppModal>
      )}

      {passStep && (
        <AppModal
          title="Change password"
          onClose={cancelPasswordFlow}
          onEnter={() => {
            if (passLoading) return;
            if (passStep === "request") handleRequestCode();
            if (passStep === "verify" && isVerificationCodeComplete(code)) {
              handleVerifyPasswordCode();
            }
            if (passStep === "reset") handleChangePassword();
          }}
          footer={passStep === "request" ? <>
            <Button variant="secondary" onClick={cancelPasswordFlow}>Cancel</Button>
            <Button onClick={handleRequestCode} loading={passLoading}>{passLoading ? "Sending..." : "Send verification code"}</Button>
          </> : passStep === "verify" ? <>
            <Button variant="secondary" onClick={() => { setPassStep("request"); setCode(createEmptyVerificationCode()); setPasswordCodeError(""); }}>Back</Button>
            <Button onClick={handleVerifyPasswordCode} loading={passLoading} disabled={!isVerificationCodeComplete(code)}>
              {passLoading ? "Verifying..." : "Verify code"}
            </Button>
          </> : <>
            <Button variant="secondary" onClick={cancelPasswordFlow}>Cancel</Button>
            <Button onClick={handleChangePassword} loading={passLoading} disabled={!newPass || !passwordMatches}>
              {passLoading ? "Updating..." : "Update password"}
            </Button>
          </>}
        >
          <div className="account-modal-content">
            <StepIndicator steps={[
              { key: "request", label: "Send code" },
              { key: "verify", label: "Verify" },
              { key: "reset", label: "New password" },
            ]} current={passStep} />
            {passStep === "request" && (
              <ModalNotice icon={<Mail size={17} />} title="Verify it’s you">
                We’ll send a 6-digit verification code to <strong className="font-semibold text-gray-700">{maskEmail(user.email)}</strong>.
              </ModalNotice>
            )}
            {passStep === "verify" && <>
              <ModalNotice icon={<ShieldCheck size={17} />} title="Check your inbox">
                Enter the code sent to {maskEmail(user.email)}. It expires in 5 minutes.
              </ModalNotice>
              <div className="account-modal-field">
                <VerificationCodeInput
                  id="password-code"
                  value={code}
                  onChange={(nextCode) => {
                    setCode(nextCode);
                    setPasswordCodeError("");
                  }}
                  invalid={Boolean(passwordCodeError)}
                  errorId={passwordCodeError ? "password-code-error" : undefined}
                />
                {passwordCodeError && (
                  <p id="password-code-error" className="account-modal-error" role="alert">
                    {passwordCodeError}
                  </p>
                )}
                <div className="account-modal-code-actions">
                  <span>Didn’t receive the code?</span>
                  <button type="button" onClick={handleResendPasswordCode} disabled={resendCooldown > 0}>
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
                  </button>
                </div>
              </div>
            </>}
            {passStep === "reset" && <>
              <div className="account-modal-field">
                <label htmlFor="new-password" className="account-modal-label">New password</label>
                <input
                  id="new-password"
                  type={showPasswords ? "text" : "password"}
                  autoComplete="new-password"
                  maxLength={PASSWORD_MAX}
                  value={newPass}
                  onChange={(event) => setNewPass(event.target.value)}
                  className="account-modal-input"
                />
                <p className="account-modal-help">{PASSWORD_HELP}</p>
              </div>
              <div className="account-modal-field">
                <label htmlFor="confirm-password" className="account-modal-label">Confirm new password</label>
                <input
                  id="confirm-password"
                  type={showPasswords ? "text" : "password"}
                  autoComplete="new-password"
                  maxLength={PASSWORD_MAX}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  aria-invalid={confirm.length > 0 && !passwordMatches}
                  aria-describedby="password-match-help"
                  className="account-modal-input"
                />
                {confirm.length > 0 && (
                  <p id="password-match-help" className={`account-password-match ${passwordMatches ? "text-emerald-600" : "text-red-600"}`} aria-live="polite">
                    {passwordMatches ? "Passwords match." : "Passwords do not match yet."}
                  </p>
                )}
              </div>
              <label className="inline-flex w-fit cursor-pointer items-center gap-2 text-xs font-medium text-gray-600">
                <input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} className="h-4 w-4 accent-blue-900" />
                Show passwords
              </label>
            </>}
          </div>
        </AppModal>
      )}
    </>
  );
};

export default AdministratorAccount;
