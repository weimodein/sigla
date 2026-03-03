const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const {
  register,
  verifyEmail,
  setPassword,
  login,
  forgotPassword,
  resetPassword,
  getMe,
} = require("../controllers/authController.js");

// Public routes
router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/set-password", setPassword);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Protected route
router.get("/me", authMiddleware, getMe);

module.exports = router;
