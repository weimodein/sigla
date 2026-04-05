import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../context/ToastContext.jsx";
import {
  verifyResetCode,
  resetPassword,
  resendCode,
} from "../../api/authApi.js";
import api from "../../api/authApi.js";

const AdministratorAccount = () => {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // ── Profile state ─────────────────────────────────────────
  const [profileForm, setProfileForm] = useState({
    name: user?.name || "",
    username: user?.username || "",
  });
  const [profileLoading, setProfileLoading] = useState(false);

  // ── Change password state ─────────────────────────────────
  // step: request | verify | reset
  const [passStep, setPassStep] = useState("request");
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
    } catch (err) {
      toast.error(
        err.response?.data?.message || "Failed to update profile"
      );
    } finally {
      setProfileLoading(false);
    }
  };

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800">
          Administrator Account
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          Manage your account information and password
        </p>
      </div>

      {/* ── Account Info Card ── */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-800 mb-4">
          Account Information
        </h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-500">Username</span>
            <span className="font-medium text-gray-800">{user?.username}</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-500">Name</span>
            <span className="font-medium text-gray-800">{user?.name}</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-500">Email</span>
            <span className="font-medium text-gray-800">{user?.email}</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-500">Role</span>
            <span className="font-medium text-gray-800 capitalize">
              {user?.role?.replace("_", " ")}
            </span>
          </div>
        </div>
      </div>

      {/* ── Edit Profile Card ── */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-800 mb-1">
          Edit Profile
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Update your name and username. Email address cannot be changed as it
          was verified during registration.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Name
            </label>
            <input
              type="text"
              value={profileForm.name}
              onChange={(e) =>
                setProfileForm({ ...profileForm, name: e.target.value })
              }
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Username
            </label>
            <input
              type="text"
              value={profileForm.username}
              onChange={(e) =>
                setProfileForm({ ...profileForm, username: e.target.value })
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
              value={user?.email || ""}
              disabled
              className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">
              Email address is fixed and cannot be changed
            </p>
          </div>
          <button
            onClick={handleUpdateProfile}
            disabled={profileLoading}
            className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
          >
            {profileLoading ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      {/* ── Change Password Card ── */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-800 mb-1">
          Change Password
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          A 6-digit verification code will be sent to your registered email
          address before you can set a new password.
        </p>

        {/* Step 1 — Request code */}
        {passStep === "request" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Click the button below to send a verification code to{" "}
              <strong>{user?.email}</strong>.
            </p>
            <button
              onClick={handleRequestCode}
              disabled={passLoading}
              className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
            >
              {passLoading ? "Sending..." : "Send Verification Code"}
            </button>
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
                  setPassStep("request");
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

      {/* ── Logout ── */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-1">Sign Out</h3>
        <p className="text-xs text-gray-400 mb-4">
          Sign out of your administrator account
        </p>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="w-full border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold py-2 rounded-lg transition"
        >
          Logout
        </button>
      </div>
    </div>
  );
};

export default AdministratorAccount;
