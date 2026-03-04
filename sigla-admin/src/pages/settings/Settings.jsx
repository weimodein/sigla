import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useNavigate } from "react-router-dom";
import api from "../../api/authApi.js";

const Settings = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // ── Change password state ─────────────────────────────────
  const [passForm, setPassForm] = useState({
    email: user?.email || "",
    code: "",
    newPassword: "",
    confirm: "",
  });
  const [step, setStep] = useState("request"); // request | verify
  const [passLoading, setPassLoading] = useState(false);
  const [passError, setPassError] = useState("");
  const [passSuccess, setPassSuccess] = useState("");

  // ── Profile state ─────────────────────────────────────────
  const [profileForm, setProfileForm] = useState({
    name: user?.name || "",
    username: user?.username || "",
    email: user?.email || "",
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");

  // ── Request reset code ────────────────────────────────────
  const handleRequestCode = async () => {
    setPassError("");
    setPassLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: passForm.email });
      setPassSuccess("Verification code sent to your email.");
      setStep("verify");
    } catch (err) {
      setPassError(err.response?.data?.message || "Failed to send code");
    } finally {
      setPassLoading(false);
    }
  };

  // ── Reset password ────────────────────────────────────────
  const handleChangePassword = async () => {
    setPassError("");

    if (passForm.newPassword !== passForm.confirm) {
      setPassError("Passwords do not match");
      return;
    }
    if (passForm.newPassword.length < 6) {
      setPassError("Password must be at least 6 characters");
      return;
    }

    setPassLoading(true);
    try {
      await api.post("/auth/reset-password", {
        email: passForm.email,
        code: passForm.code,
        password: passForm.newPassword,
      });
      setPassSuccess("Password changed successfully. Please log in again.");
      setTimeout(() => {
        logout();
        navigate("/login");
      }, 2000);
    } catch (err) {
      setPassError(err.response?.data?.message || "Failed to change password");
    } finally {
      setPassLoading(false);
    }
  };

  // ── Update profile ────────────────────────────────────────
  const handleUpdateProfile = async () => {
    setProfileError("");
    setProfileLoading(true);
    try {
      await api.put(`/users/${user.id}`, profileForm);
      setProfileSuccess("Profile updated successfully.");
      setTimeout(() => setProfileSuccess(""), 3000);
    } catch (err) {
      setProfileError(
        err.response?.data?.message || "Failed to update profile",
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
        <h2 className="text-2xl font-bold text-gray-800">Settings</h2>
        <p className="text-gray-500 text-sm mt-1">
          Manage your account settings
        </p>
      </div>

      {/* ── Profile Card ── */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-800 mb-1">
          Profile Information
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Update your name, username, or email
        </p>

        {profileError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            {profileError}
          </div>
        )}
        {profileSuccess && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">
            {profileSuccess}
          </div>
        )}

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
              value={profileForm.email}
              onChange={(e) =>
                setProfileForm({ ...profileForm, email: e.target.value })
              }
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
            />
          </div>

          {/* Role — read only */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Role
            </label>
            <input
              type="text"
              value={user?.role?.replace("_", " ")}
              disabled
              className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed capitalize"
            />
          </div>

          <button
            onClick={handleUpdateProfile}
            disabled={profileLoading}
            className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
          >
            {profileLoading ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </div>

      {/* ── Change Password Card ── */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-800 mb-1">
          Change Password
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          A verification code will be sent to your email
        </p>

        {passError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            {passError}
          </div>
        )}
        {passSuccess && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">
            {passSuccess}
          </div>
        )}

        {step === "request" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={passForm.email}
                onChange={(e) =>
                  setPassForm({ ...passForm, email: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <button
              onClick={handleRequestCode}
              disabled={passLoading}
              className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
            >
              {passLoading ? "Sending..." : "Send Verification Code"}
            </button>
          </div>
        )}

        {step === "verify" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Verification Code
              </label>
              <input
                type="text"
                value={passForm.code}
                maxLength={4}
                onChange={(e) =>
                  setPassForm({ ...passForm, code: e.target.value })
                }
                placeholder="Enter 4-digit code"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                New Password
              </label>
              <input
                type="password"
                value={passForm.newPassword}
                onChange={(e) =>
                  setPassForm({ ...passForm, newPassword: e.target.value })
                }
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
                value={passForm.confirm}
                onChange={(e) =>
                  setPassForm({ ...passForm, confirm: e.target.value })
                }
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
                {passLoading ? "Changing..." : "Change Password"}
              </button>
              <button
                onClick={() => {
                  setStep("request");
                  setPassError("");
                  setPassSuccess("");
                }}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Account Info Card ── */}
      <div className="bg-white rounded-xl shadow-sm p-6">
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

        {/* Logout button */}
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="w-full mt-6 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold py-2 rounded-lg transition"
        >
          Logout
        </button>
      </div>
    </div>
  );
};

export default Settings;
