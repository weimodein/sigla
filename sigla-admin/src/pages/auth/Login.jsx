import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { forgotPassword, resetPassword } from "../../api/authApi.js";

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  // ── Form state ────────────────────────────────────────────
  const [step, setStep] = useState("login"); // login | forgot | reset
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");

  // ── Login handler ─────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password handler ───────────────────────────────
  const handleForgot = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await forgotPassword(email);
      setSuccess("Verification code sent to your email.");
      setStep("reset");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  // ── Reset password handler ────────────────────────────────
  const handleReset = async (e) => {
    e.preventDefault();
    setError("");

    if (newPass !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(email, code, newPass);
      setSuccess("Password reset successfully. You can now log in.");
      setStep("login");
      setCode("");
      setNewPass("");
      setConfirm("");
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
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-900">SIGLA</h1>
          <p className="text-gray-500 text-sm mt-1">Admin Panel</p>
        </div>

        {/* Error / Success messages */}
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
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="Enter your username"
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
                setError("");
                setSuccess("");
              }}
              className="text-center text-sm text-blue-900 hover:underline cursor-pointer mt-2"
            >
              Forgot password?
            </p>
          </form>
        )}

        {/* ── Forgot Password Form ── */}
        {step === "forgot" && (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-sm text-gray-600 mb-2">
              Enter your email address and we'll send you a verification code.
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
                setError("");
                setSuccess("");
              }}
              className="text-center text-sm text-blue-900 hover:underline cursor-pointer"
            >
              Back to login
            </p>
          </form>
        )}

        {/* ── Reset Password Form ── */}
        {step === "reset" && (
          <form onSubmit={handleReset} className="space-y-4">
            <p className="text-sm text-gray-600 mb-2">
              Enter the verification code sent to <strong>{email}</strong> and
              set a new password.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Verification Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={4}
                placeholder="Enter 4-digit code"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>

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
                setError("");
                setSuccess("");
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
// ```

// ---

// After saving, visit `http://localhost:5173` — it should redirect to `/login` and show a clean login form with SIGLA branding.

// Try logging in with your admin account:
// ```
// username: admin01
// password: password
