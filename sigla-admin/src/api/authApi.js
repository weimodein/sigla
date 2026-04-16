import axios from "axios";
import { API_URL } from "../utils/constants.js";

const api = axios.create({
  baseURL: API_URL,
});

// Attach JWT token to every request automatically
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses globally — redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("user");
      window.location.href = "/login";
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

export default api;
