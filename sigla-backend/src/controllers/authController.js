const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const {
  User,
  Role,
  EmailVerification,
  UserSetting,
} = require("../models/index.js");
const { sendVerificationCode } = require("../utils/mailer.js");
require("dotenv").config();

// ── Helper: generate 4-digit code ────────────────────────────
const generateCode = () => Math.floor(1000 + Math.random() * 9000).toString();

// ── Helper: generate JWT ──────────────────────────────────────
const generateToken = (user) =>
  jwt.sign(
    { id: user.id, role: user.role_name, status: user.status },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );

// ── POST /api/auth/register ───────────────────────────────────
const register = async (req, res) => {
  try {
    const { name, username, email } = req.body;

    if (!name || !username || !email) {
      return res
        .status(400)
        .json({ message: "Name, username, and email are required" });
    }

    // Check if username or email already exists
    const existing = await User.findOne({
      where: { [Op.or]: [{ email }, { username }] },
    });
    if (existing) {
      return res.status(409).json({
        message:
          existing.email === email
            ? "Email already in use"
            : "Username already taken",
      });
    }

    // Send verification code
    const code = generateCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await EmailVerification.create({
      email,
      code,
      type: "registration",
      expires_at: expires,
    });

    await sendVerificationCode(email, code, "registration");

    return res.status(200).json({
      message: "Verification code sent to email",
      email,
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/auth/verify-email ───────────────────────────────
const verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ message: "Email and code are required" });
    }

    const record = await EmailVerification.findOne({
      where: {
        email,
        code,
        type: "registration",
        is_used: false,
        expires_at: { [Op.gt]: new Date() },
      },
    });

    if (!record) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    await record.update({ is_used: true });

    return res.status(200).json({ message: "Email verified successfully" });
  } catch (err) {
    console.error("Verify email error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/auth/set-password ───────────────────────────────
const setPassword = async (req, res) => {
  try {
    const { name, username, email, age, gender, password } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Confirm email was verified
    const verified = await EmailVerification.findOne({
      where: { email, type: "registration", is_used: true },
    });
    if (!verified) {
      return res.status(400).json({ message: "Email not verified" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with role_id 3 (user) and status pending
    const user = await User.create({
      name,
      username,
      email,
      age: age || null,
      gender: gender || null,
      password: hashedPassword,
      role_id: 3,
      status: "pending",
    });

    // Create default settings for the user
    await UserSetting.create({ user_id: user.id });

    return res.status(201).json({
      message: "Account created successfully. Waiting for admin approval.",
    });
  } catch (err) {
    console.error("Set password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/auth/login ──────────────────────────────────────
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    // Find user with role
    const user = await User.findOne({
      where: { username },
      include: [{ model: Role, as: "role", attributes: ["name"] }],
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    // Check account status
    if (user.status === "pending") {
      return res.status(403).json({ message: "Account is pending approval" });
    }
    if (user.status === "deactivated") {
      return res.status(403).json({ message: "Account has been deactivated" });
    }

    const token = generateToken({
      id: user.id,
      role_name: user.role.name,
      status: user.status,
    });

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role.name,
        profile_image: user.profile_image,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/auth/forgot-password ───────────────────────────
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      // Don't reveal if email exists or not
      return res
        .status(200)
        .json({ message: "If that email exists, a code has been sent" });
    }

    const code = generateCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    await EmailVerification.create({
      user_id: user.id,
      email,
      code,
      type: "password_reset",
      expires_at: expires,
    });

    await sendVerificationCode(email, code, "password_reset");

    return res
      .status(200)
      .json({ message: "If that email exists, a code has been sent" });
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/auth/reset-password ────────────────────────────
const resetPassword = async (req, res) => {
  try {
    const { email, code, password } = req.body;

    if (!email || !code || !password) {
      return res
        .status(400)
        .json({ message: "Email, code, and password are required" });
    }

    const record = await EmailVerification.findOne({
      where: {
        email,
        code,
        type: "password_reset",
        is_used: false,
        expires_at: { [Op.gt]: new Date() },
      },
    });

    if (!record) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.update({ password: hashedPassword }, { where: { email } });
    await record.update({ is_used: true });

    return res.status(200).json({ message: "Password reset successfully" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/auth/me ──────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.user.id },
      attributes: { exclude: ["password"] },
      include: [{ model: Role, as: "role", attributes: ["name"] }],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ user });
  } catch (err) {
    console.error("Get me error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  register,
  verifyEmail,
  setPassword,
  login,
  forgotPassword,
  resetPassword,
  getMe,
};
