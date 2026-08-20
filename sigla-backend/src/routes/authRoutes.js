const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const {
  login,
  forgotPassword,
  resetPassword,
  getMe,
  resendCode,
  verifyResetCode,
} = require("../controllers/authController.js");

// Tighter per-IP budget for password guessing, inside the blanket authLimiter
// that server.js applies to all of /api/auth.
//
// skipSuccessfulRequests means only FAILURES count, so an admin who signs in
// correctly never spends this budget however often they log in.
//
// This also blunts a lockout denial-of-service: the account lockout is keyed on
// the account, so without a per-IP cap anyone who knows an admin's username
// could lock that admin out at will with five wrong passwords. Here the attacker
// exhausts their own IP allowance first.
//
// The 429 is a pre-handler rejection keyed on IP, never on the account, so it
// fires identically for real and non-existent identifiers and does not
// reintroduce the enumeration oracle the controller just closed.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // failed logins per IP per window
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many failed login attempts. Please try again later." },
});

// Public routes
// NOTE: Public self-registration is disabled — accounts are created only by a
// super administrator via the Manage Administrators module. The register /
// verify-email / set-password self-signup endpoints have been removed.
router.post("/login", loginLimiter, login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/resend-code", resendCode); // Resend verification code (password reset / email link)
router.post("/verify-reset-code", verifyResetCode); // Verify reset code before resetting password

// Protected route
router.get("/me", authMiddleware, getMe);

module.exports = router;
// ```

// ---

// **Test these in Postman in this exact order:**
// ```
// 1. POST /api/auth/register
//    Body: { "name": "Jhoren", "username": "jhoren_", "email": "jhorentuazon.dev@gmail.com" }
//    → Sends a 6-digit code to your email (valid 5 minutes)

// 2. POST /api/auth/verify-email
//    Body: { "email": "jhorentuazon.dev@gmail.com", "code": "123456" }
//    → Returns "Email verified successfully"
//    → Wrong code returns attempts remaining (max 5 before session invalidated)

// 3. POST /api/auth/set-password
//    Body: { "name": "Jhoren", "username": "jhoren_", "email": "jhorentuazon.dev@gmail.com", "password": "password123" }
//    → Creates account with status "pending"

// 4. POST /api/auth/login
//    Body: { "identifier": "jhoren_", "password": "password123" }  ← identifier not username
//    Body: { "identifier": "jhorentuazon.dev@gmail.com", "password": "password123" }  ← email also works
//    → Returns 403 "pending approval" until admin approves

// 5. POST /api/auth/forgot-password
//    Body: { "email": "jhorentuazon.dev@gmail.com" }
//    → Sends 6-digit reset code (valid 5 minutes)

// 6. POST /api/auth/verify-reset-code  ← NEW — must do this before reset
//    Body: { "email": "jhorentuazon.dev@gmail.com", "code": "123456" }
//    → Verifies the reset code first

// 7. POST /api/auth/reset-password  ← no longer needs code in body
//    Body: { "email": "jhorentuazon.dev@gmail.com", "password": "newpassword123" }
//    → Updates password

// 8. POST /api/auth/resend-code  ← NEW
//    Body: { "email": "jhorentuazon.dev@gmail.com", "type": "registration" }
//    → Only works after 1 minute cooldown

// 9. GET /api/auth/me
//    Header: Authorization: Bearer <token>
//    → Returns logged in user info
