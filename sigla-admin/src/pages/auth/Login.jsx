import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  resendCode,
} from "../../api/authApi.js";

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  // step: login | forgot | verify | reset
  const [step, setStep] = useState("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Login fields
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // Forgot/reset fields
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");

  // Resend cooldown
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

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  // ── Login ─────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      await login(identifier, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password — send code ───────────────────────────
  const handleForgot = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      await forgotPassword(email);
      setSuccess("Verification code sent to your email. Valid for 5 minutes.");
      setStep("verify");
      startCooldown();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  // ── Verify reset code ─────────────────────────────────────
  const handleVerify = async (e) => {
    e.preventDefault();
    clearMessages();
    if (code.length !== 6) {
      setError("Please enter the 6-digit verification code");
      return;
    }
    setLoading(true);
    try {
      await verifyResetCode(email, code);
      setSuccess("Code verified. Please set your new password.");
      setStep("reset");
    } catch (err) {
      setError(err.response?.data?.message || "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  };

  // ── Resend code ───────────────────────────────────────────
  const handleResend = async () => {
    if (resendCooldown > 0) return;
    clearMessages();
    try {
      await resendCode(email, "password_reset");
      setSuccess("New verification code sent.");
      startCooldown();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to resend code");
    }
  };

  // ── Reset password ────────────────────────────────────────
  const handleReset = async (e) => {
    e.preventDefault();
    clearMessages();
    if (newPass !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (newPass.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email, newPass);
      setSuccess("Password reset successfully. You can now log in.");
      setStep("login");
      setCode("");
      setNewPass("");
      setConfirm("");
      setEmail("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  // ── UI ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-900">SIGLA</h1>
          <p className="text-gray-500 text-sm mt-1">Admin Panel</p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">
            {success}
          </div>
        )}

        {/* ── Login Form ── */}
        {step === "login" && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username or Email
              </label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder="Enter your username or email"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Enter your password"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm transition disabled:opacity-50"
            >
              {loading ? "Logging in..." : "Login"}
            </button>
            <p
              onClick={() => {
                setStep("forgot");
                clearMessages();
              }}
              className="text-center text-sm text-blue-900 hover:underline cursor-pointer mt-2"
            >
              Forgot password?
            </p>
          </form>
        )}

        {/* ── Forgot Password — Enter Email ── */}
        {step === "forgot" && (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-sm text-gray-600 mb-2">
              Enter your email address and we will send you a 6-digit
              verification code.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Enter your email"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm transition disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send Verification Code"}
            </button>
            <p
              onClick={() => {
                setStep("login");
                clearMessages();
              }}
              className="text-center text-sm text-blue-900 hover:underline cursor-pointer"
            >
              Back to login
            </p>
          </form>
        )}

        {/* ── Verify Code ── */}
        {step === "verify" && (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-gray-600 mb-2">
              Enter the 6-digit code sent to <strong>{email}</strong>. The code
              is valid for 5 minutes. You have a maximum of 5 attempts.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Verification Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
                maxLength={6}
                placeholder="Enter 6-digit code"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900 tracking-widest text-center text-lg"
              />
            </div>
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm transition disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify Code"}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="text-blue-900 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
              >
                {resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : "Resend code"}
              </button>
              <p
                onClick={() => {
                  setStep("login");
                  clearMessages();
                }}
                className="text-blue-900 hover:underline cursor-pointer"
              >
                Back to login
              </p>
            </div>
          </form>
        )}

        {/* ── Reset Password ── */}
        {step === "reset" && (
          <form onSubmit={handleReset} className="space-y-4">
            <p className="text-sm text-gray-600 mb-2">
              Set a new password for <strong>{email}</strong>.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New Password
              </label>
              <input
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                required
                placeholder="Enter new password"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                placeholder="Confirm new password"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm transition disabled:opacity-50"
            >
              {loading ? "Resetting..." : "Reset Password"}
            </button>
            <p
              onClick={() => {
                setStep("login");
                clearMessages();
              }}
              className="text-center text-sm text-blue-900 hover:underline cursor-pointer"
            >
              Back to login
            </p>
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;
