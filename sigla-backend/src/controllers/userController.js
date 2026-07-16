const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const {
  User,
  UserSetting,
  Word,
  GestureSample,
} = require("../models/index.js");
const { logActivity } = require("../utils/activityLogger.js");

// Administrator accounts live in the users table under role_id = 1.
const ADMIN_ROLE_ID = 1;

// ── GET /api/users ────────────────────────────────────────────
const getAllUsers = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // "All" excludes soft-deleted admins — deleted accounts have their own tab.
    const where = { role_id: ADMIN_ROLE_ID, status: { [Op.ne]: "deleted" } };
    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { username: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: { exclude: ["password"] },
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
    console.error("Get all administrators error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/deactivated ────────────────────────────────
const getDeactivatedUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { status: "deactivated", role_id: ADMIN_ROLE_ID },
      attributes: { exclude: ["password"] },
      order: [["deactivated_at", "DESC"]],
    });
    return res.status(200).json({ users });
  } catch (err) {
    console.error("Get deactivated administrators error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/deleted ────────────────────────────────────
const getDeletedUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { status: "deleted", role_id: ADMIN_ROLE_ID },
      attributes: { exclude: ["password"] },
      order: [["updated_at", "DESC"]],
    });
    return res.status(200).json({ users });
  } catch (err) {
    console.error("Get deleted administrators error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/stats ──────────────────────────────────────
const getUserStats = async (req, res) => {
  try {
    const [total, active, deactivated, deleted] = await Promise.all([
      User.count({ where: { role_id: ADMIN_ROLE_ID } }),
      User.count({ where: { role_id: ADMIN_ROLE_ID, status: "active" } }),
      User.count({ where: { role_id: ADMIN_ROLE_ID, status: "deactivated" } }),
      User.count({ where: { role_id: ADMIN_ROLE_ID, status: "deleted" } }),
    ]);

    return res.status(200).json({ total, active, deactivated, deleted });
  } catch (err) {
    console.error("Get administrator stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/:id ────────────────────────────────────────
const getUserById = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, role_id: ADMIN_ROLE_ID },
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    return res.status(200).json({ user });
  } catch (err) {
    console.error("Get administrator by id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/users ───────────────────────────────────────────
// Master administrator creates an administrator account.
// Only a username and password are required — the email is linked later
// by the administrator on first login.
const createUser = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required",
      });
    }

    // Check for an existing username (email is linked later, so not checked here)
    const existing = await User.findOne({ where: { username } });
    if (existing) {
      return res.status(409).json({ message: "Username already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email: null,
      password: hashedPassword,
      role_id: ADMIN_ROLE_ID,
      status: "active",
      // New admins must complete first-login setup (link email + change credentials).
      must_complete_setup: true,
    });

    // Create default settings for the new administrator
    await UserSetting.create({ user_id: user.id });

    await logActivity({
      user_id: req.user.id,
      action: "created_admin",
      target_type: "user",
      target_id: user.id,
      details: `Created administrator account: ${user.username}`,
    });

    return res.status(201).json({
      message: "Administrator account created successfully",
      user: {
        id: user.id,
        username: user.username,
        status: user.status,
      },
    });
  } catch (err) {
    console.error("Create administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/:id/deactivate ──────────────────────────
const deactivateUser = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, status: "active", role_id: ADMIN_ROLE_ID },
    });

    if (!user) {
      return res.status(404).json({ message: "Active administrator not found" });
    }

    await user.update({
      status: "deactivated",
      deactivated_at: new Date(),
    });

    await logActivity({
      user_id: req.user.id,
      action: "deactivated_admin",
      target_type: "user",
      target_id: user.id,
      details: `Deactivated administrator: ${user.username}`,
    });

    return res.status(200).json({
      message: "Administrator deactivated successfully.",
    });
  } catch (err) {
    console.error("Deactivate administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/:id/reactivate ──────────────────────────
const reactivateUser = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, status: "deactivated", role_id: ADMIN_ROLE_ID },
    });

    if (!user) {
      return res.status(404).json({ message: "Deactivated administrator not found" });
    }

    await user.update({
      status: "active",
      deactivated_at: null,
    });

    await logActivity({
      user_id: req.user.id,
      action: "reactivated_admin",
      target_type: "user",
      target_id: user.id,
      details: `Reactivated administrator: ${user.username}`,
    });

    return res.status(200).json({ message: "Administrator reactivated successfully" });
  } catch (err) {
    console.error("Reactivate administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/users/:id ─────────────────────────────────────
// Soft delete — sets status to "deleted" to preserve activity logs.
// Cancels the administrator's pending word submissions and detaches
// their approved gesture samples so the dataset stays intact.
const deleteUser = async (req, res) => {
  try {
    const user = await User.findOne({
      where: {
        id: req.params.id,
        role_id: ADMIN_ROLE_ID,
        status: { [Op.in]: ["deactivated", "active"] },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    // Cancel all pending word submissions from this administrator
    const pendingWords = await Word.findAll({
      where: { submitted_by: user.id, status: "pending" },
    });

    if (pendingWords.length > 0) {
      await Word.update(
        { status: "rejected" },
        { where: { submitted_by: user.id, status: "pending" } },
      );
    }

    // Remove pending and rejected gesture samples submitted by this administrator.
    // Approved samples are retained (nullify submitted_by) to preserve the dataset.
    await GestureSample.destroy({
      where: {
        submitted_by: user.id,
        status: { [Op.in]: ["pending", "rejected"] },
      },
    });
    await GestureSample.update(
      { submitted_by: null },
      { where: { submitted_by: user.id, status: "approved" } },
    );

    // Soft delete — preserves logs and gesture sample references
    await user.update({ status: "deleted" });

    await logActivity({
      user_id: req.user.id,
      action: "deleted_admin",
      target_type: "user",
      target_id: user.id,
      details: `Deleted administrator: ${user.username}`,
    });

    return res.status(200).json({
      message: "Administrator account permanently deleted.",
      cancelled_submissions: pendingWords.length,
    });
  } catch (err) {
    console.error("Delete administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PUT /api/users/:id ────────────────────────────────────────
const updateUser = async (req, res) => {
  try {
    // Note: email is intentionally NOT accepted here — it can only be changed
    // through the verified email flow (POST /users/email/request-code + verify).
    const { username, name, password } = req.body;

    // Any admin may edit their OWN account; only a master admin may edit others.
    const isSelf = String(req.params.id) === String(req.user.id);
    const isMaster = req.user.role === "master_admin";
    if (!isSelf && !isMaster) {
      return res.status(403).json({
        message: "Access denied. Only the master administrator can edit other accounts.",
      });
    }

    // Self-edits may target a master account (role_id 2); master-edits of others
    // target administrator accounts (role_id 1).
    const where = isSelf
      ? { id: req.params.id }
      : { id: req.params.id, role_id: ADMIN_ROLE_ID };
    const user = await User.findOne({ where });

    if (!user) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    if (username && username !== user.username) {
      const taken = await User.findOne({ where: { username } });
      if (taken) {
        return res.status(409).json({ message: "Username already taken" });
      }
    }

    // Password is optional on edit — only updated when a new one is provided.
    const updates = {
      username: username || user.username,
      name: name !== undefined ? name : user.name,
    };
    if (password) {
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
          message:
            "Password must be at least 8 characters and include a letter and a number",
        });
      }
      updates.password = await bcrypt.hash(password, 10);
    }

    await user.update(updates);

    await logActivity({
      user_id: req.user.id,
      action: "updated_admin",
      target_type: "user",
      target_id: user.id,
      details: `Updated administrator account: ${user.username}${password ? " (password changed)" : ""}`,
    });

    return res.status(200).json({ message: "Administrator updated successfully" });
  } catch (err) {
    console.error("Update administrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/users/complete-setup ────────────────────────────
// Finishes forced first-login onboarding for the logged-in account:
// requires that an email is already linked (email-first), then sets the new
// username + password and clears the must_complete_setup flag.
const completeSetup = async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    if (!user.must_complete_setup) {
      return res.status(400).json({ message: "Account setup is already complete" });
    }

    // Email-first: an email must have been linked (via the verified email flow).
    if (!user.email) {
      return res
        .status(400)
        .json({ message: "Link and verify your email address first" });
    }

    if (!username || !username.trim() || !password) {
      return res
        .status(400)
        .json({ message: "New username and password are required" });
    }

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include a letter and a number",
      });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername !== user.username) {
      const taken = await User.findOne({ where: { username: trimmedUsername } });
      if (taken) {
        return res.status(409).json({ message: "Username already taken" });
      }
    }

    await user.update({
      username: trimmedUsername,
      password: await bcrypt.hash(password, 10),
      must_complete_setup: false,
    });

    await logActivity({
      user_id: user.id,
      action: "completed_setup",
      target_type: "user",
      target_id: user.id,
      details: "Completed first-login account setup",
    });

    return res.status(200).json({ message: "Account setup complete" });
  } catch (err) {
    console.error("Complete setup error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getAllUsers,
  getDeactivatedUsers,
  getDeletedUsers,
  getUserStats,
  getUserById,
  createUser,
  deactivateUser,
  reactivateUser,
  deleteUser,
  updateUser,
  completeSetup,
};
