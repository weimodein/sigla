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
  resendCode,
  verifyResetCode,
} = require("../controllers/authController.js");

// Public routes
router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/set-password", setPassword);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/resend-code", resendCode); // New route to resend verification code
router.post("/verify-reset-code", verifyResetCode); // New route to verify reset code

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
