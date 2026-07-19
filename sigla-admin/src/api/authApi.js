import axios from "axios";
import { API_URL } from "../utils/constants.js";

const api = axios.create({
  baseURL: API_URL,
});

// Attach JWT token to every request automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses globally — clear session so ProtectedRoute redirects to login.
// Skip auth endpoints so their errors propagate normally to the calling component.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url ?? "";
    const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/me");
    if (error.response?.status === 401 && !isAuthEndpoint) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }
    return Promise.reject(error);
  },
);

// ── Auth endpoints ────────────────────────────────────────────

// Login accepts email OR username via identifier field
export const login = async (identifier, password) => {
  const response = await api.post("/auth/login", { identifier, password });
  return response.data;
};

export const getMe = async () => {
  const response = await api.get("/auth/me");
  return response.data;
};

export const forgotPassword = async (email) => {
  const response = await api.post("/auth/forgot-password", { email });
  return response.data;
};

// Step 1 — verify the 6-digit reset code
export const verifyResetCode = async (email, code) => {
  const response = await api.post("/auth/verify-reset-code", { email, code });
  return response.data;
};

// Step 2 — set the new password after code is verified
export const resetPassword = async (email, password) => {
  const response = await api.post("/auth/reset-password", { email, password });
  return response.data;
};

export const resendCode = async (email, type) => {
  const response = await api.post("/auth/resend-code", { email, type });
  return response.data;
};

// ── Verified email add/change (authenticated) ─────────────────
// Sends a 6-digit code to the NEW email being added/changed.
export const requestEmailCode = async (email) => {
  const response = await api.post("/users/email/request-code", { email });
  return response.data;
};

export const verifyEmailCode = async (email, code) => {
  const response = await api.post("/users/email/verify", { email, code });
  return response.data;
};

// Finish forced first-login onboarding (email must already be linked).
export const completeSetup = async ({ username, password }) => {
  const response = await api.post("/users/complete-setup", { username, password });
  return response.data;
};

export default api;
