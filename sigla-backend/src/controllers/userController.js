const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const {
  User,
  Role,
  UserSetting,
  ActivityLog,
  Notification,
} = require("../models/index.js");

// ── GET /api/users ────────────────────────────────────────────
// Admin: get all users with pagination and filters
const getAllUsers = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const where = { role_id: 3 }; // normal users only

    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { username: { [Op.iLike]: `%${search}%` } },
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: { exclude: ["password"] },
      include: [{ model: Role, as: "role", attributes: ["name"] }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      users: rows,
    });
  } catch (err) {
    console.error("Get all users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/pending ────────────────────────────────────
// Admin: get all pending user registration requests
const getPendingUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { status: "pending", role_id: 3 },
      attributes: { exclude: ["password"] },
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({ users });
  } catch (err) {
    console.error("Get pending users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/deactivated ────────────────────────────────
// Admin: get all deactivated users
const getDeactivatedUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { status: "deactivated", role_id: 3 },
      attributes: { exclude: ["password"] },
      order: [["updated_at", "DESC"]],
    });

    return res.status(200).json({ users });
  } catch (err) {
    console.error("Get deactivated users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/stats ──────────────────────────────────────
// Admin: get user counts for dashboard
const getUserStats = async (req, res) => {
  try {
    const [total, pending, deactivated, admins] = await Promise.all([
      User.count({ where: { role_id: 3 } }),
      User.count({ where: { role_id: 3, status: "pending" } }),
      User.count({ where: { role_id: 3, status: "deactivated" } }),
      User.count({ where: { role_id: { [Op.in]: [1, 2] } } }),
    ]);

    return res.status(200).json({ total, pending, deactivated, admins });
  } catch (err) {
    console.error("Get user stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/:id ────────────────────────────────────────
// Admin: get a single user by ID
const getUserById = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id },
      attributes: { exclude: ["password"] },
      include: [{ model: Role, as: "role", attributes: ["name"] }],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ user });
  } catch (err) {
    console.error("Get user by id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/:id/approve ─────────────────────────────
// Admin: approve a pending user registration
const approveUser = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, status: "pending" },
    });

    if (!user) {
      return res.status(404).json({ message: "Pending user not found" });
    }

    await user.update({ status: "active" });

    // Notify user
    await Notification.create({
      user_id: user.id,
      title: "Account Approved",
      message: "Your account has been approved. You can now log in to SIGLA.",
      type: "general",
    });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: "approved_user",
      target_type: "user",
      target_id: user.id,
      details: `Approved account for ${user.username}`,
    });

    return res.status(200).json({ message: "User approved successfully" });
  } catch (err) {
    console.error("Approve user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/:id/deactivate ──────────────────────────
// Admin: deactivate an active user
const deactivateUser = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, status: "active", role_id: 3 },
    });

    if (!user) {
      return res.status(404).json({ message: "Active user not found" });
    }

    await user.update({ status: "deactivated" });

    // Notify user
    await Notification.create({
      user_id: user.id,
      title: "Account Deactivated",
      message:
        "Your account has been deactivated. Please contact support for assistance.",
      type: "general",
    });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: "deactivated_user",
      target_type: "user",
      target_id: user.id,
      details: `Deactivated account for ${user.username}`,
    });

    return res.status(200).json({ message: "User deactivated successfully" });
  } catch (err) {
    console.error("Deactivate user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/:id/reactivate ──────────────────────────
// Admin: reactivate a deactivated user
const reactivateUser = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, status: "deactivated", role_id: 3 },
    });

    if (!user) {
      return res.status(404).json({ message: "Deactivated user not found" });
    }

    await user.update({ status: "active" });

    // Notify user
    await Notification.create({
      user_id: user.id,
      title: "Account Reactivated",
      message:
        "Your account has been reactivated. You can now log in to SIGLA.",
      type: "general",
    });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: "reactivated_user",
      target_type: "user",
      target_id: user.id,
      details: `Reactivated account for ${user.username}`,
    });

    return res.status(200).json({ message: "User reactivated successfully" });
  } catch (err) {
    console.error("Reactivate user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/users/:id ─────────────────────────────────────
// Admin: permanently delete a deactivated user
const deleteUser = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, status: "deactivated", role_id: 3 },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found or not deactivated",
      });
    }

    // Log before deleting
    await ActivityLog.create({
      user_id: req.user.id,
      action: "deleted_user",
      target_type: "user",
      target_id: user.id,
      details: `Permanently deleted account for ${user.username}`,
    });

    await user.destroy();

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("Delete user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PUT /api/users/:id ────────────────────────────────────────
// Admin: edit user information
const updateUser = async (req, res) => {
  try {
    const { name, username, email, age, gender } = req.body;

    const user = await User.findOne({
      where: { id: req.params.id, role_id: 3 },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check for username/email conflicts with other users
    if (username && username !== user.username) {
      const taken = await User.findOne({ where: { username } });
      if (taken) {
        return res.status(409).json({ message: "Username already taken" });
      }
    }
    if (email && email !== user.email) {
      const taken = await User.findOne({ where: { email } });
      if (taken) {
        return res.status(409).json({ message: "Email already in use" });
      }
    }

    await user.update({
      name: name || user.name,
      username: username || user.username,
      email: email || user.email,
      age: age ?? user.age,
      gender: gender || user.gender,
    });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: "updated_user",
      target_type: "user",
      target_id: user.id,
      details: `Updated info for ${user.username}`,
    });

    return res.status(200).json({ message: "User updated successfully" });
  } catch (err) {
    console.error("Update user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/admins ─────────────────────────────────────
// Super admin only: get all admins
const getAllAdmins = async (req, res) => {
  try {
    const admins = await User.findAll({
      where: { role_id: 2 },
      attributes: { exclude: ["password"] },
      include: [{ model: Role, as: "role", attributes: ["name"] }],
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({ admins });
  } catch (err) {
    console.error("Get all admins error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/users/admins ────────────────────────────────────
// Super admin only: create a new admin account
const createAdmin = async (req, res) => {
  try {
    const { name, username, email, password } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

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

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await User.create({
      name,
      username,
      email,
      password: hashedPassword,
      role_id: 2,
      status: "active",
    });

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: "created_admin",
      target_type: "user",
      target_id: admin.id,
      details: `Created admin account for ${admin.username}`,
    });

    return res.status(201).json({ message: "Admin created successfully" });
  } catch (err) {
    console.error("Create admin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/users/admins/:id ──────────────────────────────
// Super admin only: remove an admin account
const deleteAdmin = async (req, res) => {
  try {
    const admin = await User.findOne({
      where: { id: req.params.id, role_id: 2 },
    });

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Log before deleting
    await ActivityLog.create({
      user_id: req.user.id,
      action: "deleted_admin",
      target_type: "user",
      target_id: admin.id,
      details: `Removed admin account for ${admin.username}`,
    });

    await admin.destroy();

    return res.status(200).json({ message: "Admin removed successfully" });
  } catch (err) {
    console.error("Delete admin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getAllUsers,
  getPendingUsers,
  getDeactivatedUsers,
  getUserStats,
  getUserById,
  approveUser,
  deactivateUser,
  reactivateUser,
  deleteUser,
  updateUser,
  getAllAdmins,
  createAdmin,
  deleteAdmin,
};
