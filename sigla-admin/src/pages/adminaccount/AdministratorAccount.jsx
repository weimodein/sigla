import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../context/ToastContext.jsx";
import { User, Mail, Pencil, Lock, LogOut } from "lucide-react";
import {
  verifyResetCode,
  resetPassword,
  resendCode,
} from "../../api/authApi.js";
import api from "../../api/authApi.js";

// ── Color Palette ──
const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  muted: "#9ca3af",
  border: "#e5e7eb",
};

const AdministratorAccount = () => {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // ── Profile state ─────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({
    username: "",
    email: "",
  });
  const [profileLoading, setProfileLoading] = useState(false);

  // Sync form with user data once it loads
  useEffect(() => {
    if (user) {
      setProfileForm({
        username: user.username || "",
        email: user.email || "",
      });
    }
  }, [user]);

  // ── Change password state ─────────────────────────────────
  // step: null | request | verify | reset
  const [passStep, setPassStep] = useState(null);
  const [passLoading, setPassLoading] = useState(false);
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // ── Resend cooldown timer ─────────────────────────────────
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

  // ── Step 1: Request verification code ────────────────────
  const handleRequestCode = async () => {
    setPassLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: user?.email });
      toast.success(
        `Verification code sent to ${user?.email}. Valid for 5 minutes.`
      );
      setPassStep("verify");
      startCooldown();
    } catch (err) {
      toast.error(
        err.response?.data?.message || "Failed to send verification code"
      );
    } finally {
      setPassLoading(false);
    }
  };

  // ── Resend code ───────────────────────────────────────────
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

  // ── Step 2: Verify code ───────────────────────────────────
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

  // ── Step 3: Set new password ──────────────────────────────
  const handleChangePassword = async () => {
    if (newPass !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPass.length < 6) {
      toast.error("Password must be at least 6 characters");
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

  // ── Update profile ────────────────────────────────────────
  const handleUpdateProfile = async () => {
    setProfileLoading(true);
    try {
      await api.put(`/users/${user.id}`, profileForm);
      toast.success("Profile updated successfully.");
      setIsEditing(false);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update profile");
    } finally {
      setProfileLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setProfileForm({
      username: user?.username || "",
      email: user?.email || "",
    });
    setIsEditing(false);
  };

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
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

      {/* ── Account Information Card ── */}
      <div className="dash-card mb-6">
        <div className="dash-card-header">
          <h3 className="text-base font-semibold text-gray-800">
            Account Information
          </h3>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-900 hover:underline"
            >
              <Pencil size={14} />
              Edit Profile
            </button>
          )}
        </div>
        <div className="dash-card-body">
          {!isEditing ? (
            <div className="space-y-3 text-sm">
              <div
                className="flex items-center justify-between py-2.5"
                style={{ borderBottom: `1px solid ${C.border}` }}
              >
                <div className="flex items-center gap-2 text-gray-500">
                  <User size={16} />
                  <span>Username</span>
                </div>
                <span className="font-medium text-gray-800">
                  {user?.username}
                </span>
              </div>
              <div
                className="flex items-center justify-between py-2.5"
                style={{ borderBottom: `1px solid ${C.border}` }}
              >
                <div className="flex items-center gap-2 text-gray-500">
                  <Mail size={16} />
                  <span>Email</span>
                </div>
                <span className="font-medium text-gray-800">
                  {user?.email}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2 text-gray-500">
                  <Lock size={16} />
                  <span>Role</span>
                </div>
                <span
                  className="text-xs font-semibold px-3 py-1 rounded-full"
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
          ) : (
            <div className="space-y-4">
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
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, email: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleUpdateProfile}
                  disabled={profileLoading}
                  className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                >
                  {profileLoading ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Change Password Card ── */}
      <div className="dash-card mb-6">
        <div className="dash-card-header">
          <h3 className="text-base font-semibold text-gray-800">
            Change Password
          </h3>
        </div>
        <div className="dash-card-body">
          {/* Not initiated */}
          {!passStep && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                A 6-digit verification code will be sent to{" "}
                <strong>{user?.email}</strong> to confirm your identity before
                setting a new password.
              </p>
              <button
                onClick={() => setPassStep("request")}
                className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition"
              >
                Change Password
              </button>
            </div>
          )}

          {/* Step 1 — Request code */}
          {passStep === "request" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Click the button below to send a verification code to{" "}
                <strong>{user?.email}</strong>.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRequestCode}
                  disabled={passLoading}
                  className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                >
                  {passLoading ? "Sending..." : "Send Verification Code"}
                </button>
                <button
                  onClick={() => {
                    setPassStep(null);
                    setCode("");
                  }}
                  className="border border-gray-300 text-gray-600 text-sm font-semibold py-2 px-4 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Verify code */}
          {passStep === "verify" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Enter the 6-digit code sent to <strong>{user?.email}</strong>.
                Valid for 5 minutes. Maximum 5 attempts.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Verification Code
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  maxLength={6}
                  placeholder="Enter 6-digit code"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900 tracking-widest text-center text-lg"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleVerifyCode}
                  disabled={passLoading || code.length !== 6}
                  className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                >
                  {passLoading ? "Verifying..." : "Verify Code"}
                </button>
                <button
                  onClick={() => {
                    setPassStep("request");
                    setCode("");
                  }}
                  className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
                >
                  Back
                </button>
              </div>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="w-full text-sm text-blue-900 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
              >
                {resendCooldown > 0
                  ? `Resend code in ${resendCooldown}s`
                  : "Resend code"}
              </button>
            </div>
          )}

          {/* Step 3 — Set new password */}
          {passStep === "reset" && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleChangePassword}
                  disabled={passLoading}
                  className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                >
                  {passLoading ? "Saving..." : "Save New Password"}
                </button>
                <button
                  onClick={() => {
                    setPassStep(null);
                    setCode("");
                    setNewPass("");
                    setConfirm("");
                  }}
                  className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Sign Out Card ── */}
      <div className="dash-card">
        <div className="dash-card-header">
          <h3 className="text-base font-semibold text-gray-800">Sign Out</h3>
          <p className="text-xs text-gray-400 mt-1">
            Sign out of your administrator account
          </p>
        </div>
        <div className="dash-card-body">
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="w-full flex items-center justify-center gap-2 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold py-2 rounded-lg transition"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdministratorAccount;
