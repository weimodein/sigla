import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  resendCode,
} from "../../api/authApi.js";
import { Hand, AlertCircle, Check, Eye, EyeOff, Loader2 } from "lucide-react";

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const toast = useToast();

  // step: login | forgot | verify | reset
  const [step, setStep] = useState("login");
  const [loading, setLoading] = useState(false);

  // Login fields
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

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

  // ── Login ─────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(identifier, password);
      navigate("/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password — send code ───────────────────────────
  const handleForgot = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword(email);
      toast.success("Verification code sent to your email. Valid for 5 minutes.");
      setStep("verify");
      startCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  // ── Verify reset code ─────────────────────────────────────
  const handleVerify = async (e) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error("Please enter the 6-digit verification code");
      return;
    }
    setLoading(true);
    try {
      await verifyResetCode(email, code);
      toast.success("Code verified. Please set your new password.");
      setStep("reset");
    } catch (err) {
      toast.error(err.response?.data?.message || "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  };

  // ── Resend code ───────────────────────────────────────────
  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      await resendCode(email, "password_reset");
      toast.success("New verification code sent.");
      startCooldown();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to resend code");
    }
  };

  // ── Reset password ────────────────────────────────────────
  const handleReset = async (e) => {
    e.preventDefault();
    if (newPass !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPass.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email, newPass);
      toast.success("Password reset successfully. You can now log in.");
      setStep("login");
      setCode("");
      setNewPass("");
      setConfirm("");
      setEmail("");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  // ── UI ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center px-16 text-white relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute top-20 left-20 w-72 h-72 bg-blue-700 rounded-full opacity-20 blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-500 rounded-full opacity-10 blur-3xl" />

        <div className="relative z-10 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-sm mb-8">
            <Hand size={40} className="text-blue-200" />
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight mb-3">
            SIGLA
          </h1>
          <p className="text-blue-200 text-lg mb-8 max-w-sm leading-relaxed">
            Admin Panel for managing the sign language learning platform
          </p>
          <div className="flex gap-4 justify-center text-sm text-blue-300">
            <span className="bg-white/10 px-4 py-2 rounded-full">Users</span>
            <span className="bg-white/10 px-4 py-2 rounded-full">Words</span>
            <span className="bg-white/10 px-4 py-2 rounded-full">Models</span>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <h1 className="text-4xl font-extrabold text-white tracking-tight">
              SIGLA
            </h1>
            <p className="text-blue-300 text-sm mt-1">Admin Panel</p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {/* Step header */}
            <div className="text-center mb-6">
              {step === "login" && (
                <>
                  <h2 className="text-2xl font-bold text-gray-900">
                    Welcome back
                  </h2>
                  <p className="text-gray-500 text-sm mt-1">
                    Sign in to your admin account
                  </p>
                </>
              )}
              {step === "forgot" && (
                <>
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 mb-3">
                    <AlertCircle size={22} className="text-blue-600" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">
                    Forgot password?
                  </h2>
                  <p className="text-gray-500 text-sm mt-1">
                    No worries, we'll send you a verification code
                  </p>
                </>
              )}
              {step === "verify" && (
                <>
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 mb-3">
                    <Check size={22} className="text-blue-600" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">
                    Check your email
                  </h2>
                  <p className="text-gray-500 text-sm mt-1">
                    Enter the 6-digit code sent to{" "}
                    <span className="font-medium text-gray-700">{email}</span>
                  </p>
                </>
              )}
              {step === "reset" && (
                <>
                  <h2 className="text-xl font-bold text-gray-900">
                    Set new password
                  </h2>
                  <p className="text-gray-500 text-sm mt-1">
                    Choose a strong password
                  </p>
                </>
              )}
            </div>

            {/* ── Login Form ── */}
            {step === "login" && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label
                    htmlFor="identifier"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Username or Email
                  </label>
                  <input
                    id="identifier"
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    placeholder="Enter your username or email"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-transparent transition"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Enter your password"
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-transparent transition"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                      tabIndex={-1}
                      aria-label={showPass ? "Hide password" : "Show password"}
                    >
                      {showPass ? (
                        <EyeOff size={16} />
                      ) : (
                        <Eye size={16} />
                      )}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-lg text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {loading ? "Logging in..." : "Login"}
                </button>
                <p
                  onClick={() => setStep("forgot")}
                  className="text-center text-sm text-blue-900 hover:underline cursor-pointer mt-2"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === "Enter" && setStep("forgot")
                  }
                >
                  Forgot password?
                </p>
              </form>
            )}

            {/* ── Forgot Password ── */}
            {step === "forgot" && (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label
                    htmlFor="forgot-email"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Email Address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="Enter your email"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-transparent transition"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-lg text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {loading ? "Sending..." : "Send Verification Code"}
                </button>
                <p
                  onClick={() => setStep("login")}
                  className="text-center text-sm text-blue-900 hover:underline cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === "Enter" && setStep("login")
                  }
                >
                  Back to login
                </p>
              </form>
            )}

            {/* ── Verify Code ── */}
            {step === "verify" && (
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label
                    htmlFor="code"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Verification Code
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    required
                    maxLength={6}
                    placeholder="000000"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-transparent tracking-widest text-center text-lg transition"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-lg text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
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
                    onClick={() => setStep("login")}
                    className="text-blue-900 hover:underline cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) =>
                      e.key === "Enter" && setStep("login")
                    }
                  >
                    Back to login
                  </p>
                </div>
              </form>
            )}

            {/* ── Reset Password ── */}
            {step === "reset" && (
              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <label
                    htmlFor="new-pass"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    New Password
                  </label>
                  <input
                    id="new-pass"
                    type="password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    required
                    placeholder="Enter new password"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-transparent transition"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirm-pass"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="confirm-pass"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    placeholder="Confirm new password"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-transparent transition"
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-lg text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {loading ? "Resetting..." : "Reset Password"}
                </button>
                <p
                  onClick={() => setStep("login")}
                  className="text-center text-sm text-blue-900 hover:underline cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === "Enter" && setStep("login")
                  }
                >
                  Back to login
                </p>
              </form>
            )}
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-blue-400 mt-6">
            &copy; {new Date().getFullYear()} SIGLA. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;