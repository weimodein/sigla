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
// ```

// ---

// **Test these in Postman in this exact order:**
// ```
// 1. POST /api/auth/register
//    Body: { "name": "Jhoren", "username": "jhoren_", "email": "jhorentuazon.dev@gmail.com" }
//    → Should send a 4-digit code to your email

// 2. POST /api/auth/verify-email
//    Body: { "email": "jhorentuazon.dev@gmail.com", "code": "1234" }
//    → Should return "Email verified successfully"

// 3. POST /api/auth/set-password
//    Body: { "name": "Jhoren", "username": "jhoren_", "email": "jhorentuazon.dev@gmail.com", "password": "password123" }
//    → Should create the account

// 4. POST /api/auth/login
//    Body: { "username": "jhoren_", "password": "password123" }
//    → Will return 403 "pending approval" until admin approves

// 5. POST /api/auth/forgot-password
//    Body: { "email": "jhorentuazon.dev@gmail.com" }
//    → Sends reset code

// 6. POST /api/auth/reset-password
//    Body: { "email": "jhorentuazon.dev@gmail.com", "code": "1234", "password": "newpassword123" }
//    → Updates password

// 7. GET /api/auth/me
//    Header: Authorization: Bearer <token>
//    → Returns logged in user info
