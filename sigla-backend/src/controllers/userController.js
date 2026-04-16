const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const {
  User,
  Role,
  UserSetting,
  // ActivityLog,
  Notification,
  Word,
  GestureSample,
} = require("../models/index.js");

// ── GET /api/users ────────────────────────────────────────────
const getAllUsers = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const where = { role_id: 3 };
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
const getDeactivatedUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { status: "deactivated", role_id: 3 },
      attributes: { exclude: ["password"] },
      order: [["deactivated_at", "DESC"]],
    });
    return res.status(200).json({ users });
  } catch (err) {
    console.error("Get deactivated users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/warned ─────────────────────────────────────
const getWarnedUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { role_id: 3, warning_count: { [Op.gt]: 0 } },
      attributes: { exclude: ["password"] },
      order: [["warning_count", "DESC"]],
    });
    return res.status(200).json({ users });
  } catch (err) {
    console.error("Get warned users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/stats ──────────────────────────────────────
const getUserStats = async (req, res) => {
  try {
    const [total, active, deactivated, warned, deleted] = await Promise.all([
      User.count({ where: { role_id: 3 } }),
      User.count({ where: { role_id: 3, status: "active" } }),
      User.count({ where: { role_id: 3, status: "deactivated" } }),
      User.count({ where: { role_id: 3, warning_count: { [Op.gt]: 0 } } }),
      User.count({ where: { role_id: 3, status: "deleted" } }),
    ]);

    return res
      .status(200)
      .json({ total, active, deactivated, warned, deleted });
  } catch (err) {
    console.error("Get user stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/:id ────────────────────────────────────────
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

// ── POST /api/users/create ────────────────────────────────────
// Admin manually creates a user account — bypasses email verification
// Account is immediately active, no verification code sent
const createUser = async (req, res) => {
  try {
    const { username, name, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        message: "Username, email, and password are required",
      });
    }

    // Check for existing username or email
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

    // Admin-created accounts are immediately active —
    // email verification is bypassed since the admin is entering the credentials
    const user = await User.create({
      username,
      name: name || null,
      email,
      password: hashedPassword,
      role_id: 3,
      status: "active",
      warning_count: 0,
    });

    // Create default settings for the new user
    await UserSetting.create({ user_id: user.id });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "created_user",
    //   target_type: "user",
    //   target_id: user.id,
    //   details: `Admin manually created account for ${username} (${email})`,
    // });

    return res.status(201).json({
      message: "User account created successfully",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        status: user.status,
      },
    });
  } catch (err) {
    console.error("Create user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/:id/approve ─────────────────────────────
const approveUser = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, status: "pending" },
    });

    if (!user) {
      return res.status(404).json({ message: "Pending user not found" });
    }

    await user.update({ status: "active" });

    await Notification.create({
      user_id: user.id,
      title: "Account Approved",
      message: "Your account has been approved. You can now log in to SIGLA.",
      type: "general",
      is_read: false,
      delivered: false,
    });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "approved_user",
    //   target_type: "user",
    //   target_id: user.id,
    //   details: `Approved account for ${user.username}`,
    // });

    return res.status(200).json({ message: "User approved successfully" });
  } catch (err) {
    console.error("Approve user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/:id/warn ─────────────────────────────────
// Increments warning_count — deactivate button becomes available after 2 warnings
const warnUser = async (req, res) => {
  try {
    const { reason } = req.body;

    const user = await User.findOne({
      where: { id: req.params.id, role_id: 3, status: "active" },
    });

    if (!user) {
      return res.status(404).json({ message: "Active user not found" });
    }

    const newWarningCount = (user.warning_count || 0) + 1;
    await user.update({ warning_count: newWarningCount });

    await Notification.create({
      user_id: user.id,
      title: `Warning ${newWarningCount} of 2`,
      message: reason
        ? `You have received a warning from the administrator. Reason: ${reason}. Warning ${newWarningCount} of 2 — receiving 2 warnings will result in account suspension.`
        : `You have received a warning from the administrator. Warning ${newWarningCount} of 2 — receiving 2 warnings will result in account suspension.`,
      type: "warning",
      is_read: false,
      delivered: false,
    });

    // Auto-deactivate after 2nd warning
    if (newWarningCount >= 2) {
      await user.update({ status: "deactivated", deactivated_at: new Date() });
      await Notification.create({
        user_id: user.id,
        title: "Account Suspended",
        message: "Your account has been suspended after receiving 2 warnings for violating the system's terms and conditions. Your account will be automatically reactivated after 30 days.",
        type: "warning",
        is_read: false,
        delivered: false,
      });
    }

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "warned_user",
    //   target_type: "user",
    //   target_id: user.id,
    //   details: `Issued warning ${newWarningCount}/2 to ${user.username}. Reason: ${reason || "No reason provided"}`,
    // });

    return res.status(200).json({
      message: newWarningCount >= 2
        ? `Warning issued. Account automatically suspended after ${newWarningCount}/2 warnings.`
        : `Warning issued. User now has ${newWarningCount}/2 warnings.`,
      warning_count: newWarningCount,
      auto_deactivated: newWarningCount >= 2,
    });
  } catch (err) {
    console.error("Warn user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/:id/deactivate ──────────────────────────
// Only allowed after 2 warnings — sets deactivated_at for 30-day auto reactivation
const deactivateUser = async (req, res) => {
  try {
    const { reason } = req.body;

    const user = await User.findOne({
      where: { id: req.params.id, status: "active", role_id: 3 },
    });

    if (!user) {
      return res.status(404).json({ message: "Active user not found" });
    }

    if ((user.warning_count || 0) < 2) {
      return res.status(400).json({
        message: `User must have at least 2 warnings before being deactivated. Current warnings: ${user.warning_count || 0}/2`,
        warning_count: user.warning_count || 0,
      });
    }

    await user.update({
      status: "deactivated",
      deactivated_at: new Date(),
    });

    await Notification.create({
      user_id: user.id,
      title: "Account Suspended",
      message: reason
        ? `Your account has been suspended. Reason: ${reason}. Your account will be automatically reactivated after 30 days.`
        : "Your account has been suspended due to violations of the system's terms and conditions. Your account will be automatically reactivated after 30 days.",
      type: "warning",
      is_read: false,
      delivered: false,
    });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "deactivated_user",
    //   target_type: "user",
    //   target_id: user.id,
    //   details: `Deactivated account for ${user.username}. Will auto-reactivate on ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toDateString()}. Reason: ${reason || "No reason provided"}`,
    // });

    return res.status(200).json({
      message:
        "User deactivated successfully. Account will auto-reactivate after 30 days.",
      reactivates_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  } catch (err) {
    console.error("Deactivate user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/:id/reactivate ──────────────────────────
// Resets warning_count to 0 so the user starts fresh
const reactivateUser = async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, status: "deactivated", role_id: 3 },
    });

    if (!user) {
      return res.status(404).json({ message: "Deactivated user not found" });
    }

    await user.update({
      status: "active",
      deactivated_at: null,
      warning_count: 0,
    });

    await Notification.create({
      user_id: user.id,
      title: "Account Reactivated",
      message:
        "Your account has been reactivated. You can now log in to SIGLA. Please ensure you follow the system's terms and conditions to avoid further violations.",
      type: "general",
      is_read: false,
      delivered: false,
    });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "reactivated_user",
    //   target_type: "user",
    //   target_id: user.id,
    //   details: `Manually reactivated account for ${user.username}. Warning count reset to 0.`,
    // });

    return res.status(200).json({ message: "User reactivated successfully" });
  } catch (err) {
    console.error("Reactivate user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/users/:id ─────────────────────────────────────
// Soft delete — sets status to "deleted" to preserve activity logs
// Cancels all pending word submissions
// Gesture samples are retained for dataset integrity (submitted_by set to NULL via DB constraint)
const deleteUser = async (req, res) => {
  try {
    const { reason } = req.body;

    const user = await User.findOne({
      where: {
        id: req.params.id,
        role_id: 3,
        status: { [Op.in]: ["deactivated", "active"] },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Cancel all pending word submissions from this user
    const pendingWords = await Word.findAll({
      where: { submitted_by: user.id, status: "pending" },
    });

    if (pendingWords.length > 0) {
      await Word.update(
        { status: "rejected" },
        { where: { submitted_by: user.id, status: "pending" } },
      );
    }

    // Remove pending and rejected gesture samples submitted by this user.
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

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "deleted_user",
    //   target_type: "user",
    //   target_id: user.id,
    //   details: `Permanently deleted account for ${user.username}. ${pendingWords.length} pending submission(s) cancelled. Reason: ${reason || "No reason provided"}`,
    // });

    return res.status(200).json({
      message: "User account permanently deleted.",
      cancelled_submissions: pendingWords.length,
    });
  } catch (err) {
    console.error("Delete user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PUT /api/users/:id ────────────────────────────────────────
const updateUser = async (req, res) => {
  try {
    const { username, name, email, age, gender } = req.body;

    const user = await User.findOne({
      where: { id: req.params.id, role_id: 3 },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

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
      username: username || user.username,
      name: name !== undefined ? name : user.name,
      email: email || user.email,
      age: age ?? user.age,
      gender: gender || user.gender,
    });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "updated_user",
    //   target_type: "user",
    //   target_id: user.id,
    //   details: `Updated info for ${user.username}`,
    // });

    return res.status(200).json({ message: "User updated successfully" });
  } catch (err) {
    console.error("Update user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── Auto reactivation cron job ────────────────────────────────
// Runs daily — reactivates deactivated users whose 30 days have passed
// Resets warning_count to 0 on reactivation
const runAutoReactivationJob = async () => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const usersToReactivate = await User.findAll({
      where: {
        status: "deactivated",
        deactivated_at: { [Op.lte]: thirtyDaysAgo },
      },
    });

    for (const user of usersToReactivate) {
      await user.update({
        status: "active",
        deactivated_at: null,
        warning_count: 0,
      });

      await Notification.create({
        user_id: user.id,
        title: "Account Reactivated",
        message:
          "Your account has been automatically reactivated after 30 days. You can now log in to SIGLA. Please ensure you follow the system's terms and conditions.",
        type: "general",
        is_read: false,
        delivered: false,
      });

      // await ActivityLog.create({
      //   user_id: null,
      //   action: "auto_reactivated_user",
      //   target_type: "user",
      //   target_id: user.id,
      //   details: `Auto-reactivated account for ${user.username} after 30-day suspension. Warning count reset to 0.`,
      // });

      console.log(`Auto-reactivated user: ${user.username}`);
    }

    console.log(
      `Auto reactivation job complete. ${usersToReactivate.length} user(s) reactivated.`,
    );
  } catch (err) {
    console.error("Auto reactivation job error:", err);
  }
};

// ── GET /api/users/registrations?period=week|month|year ───────
const getUserRegistrations = async (req, res) => {
  try {
    const { period = "month" } = req.query;
    const { sequelize } = require("../config/db.js");

    let trunc, interval;
    if (period === "week") {
      trunc = "day";
      interval = "7 days";
    } else if (period === "year") {
      trunc = "month";
      interval = "12 months";
    } else {
      // month
      trunc = "day";
      interval = "30 days";
    }

    const rows = await sequelize.query(
      `SELECT DATE_TRUNC(:trunc, created_at) AS date, COUNT(*) AS count
       FROM users
       WHERE role_id = 3
         AND created_at >= NOW() - INTERVAL :interval
       GROUP BY DATE_TRUNC(:trunc, created_at)
       ORDER BY date ASC`,
      {
        replacements: { trunc, interval },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    const data = rows.map((r) => ({
      date: r.date,
      count: parseInt(r.count, 10),
    }));

    return res.status(200).json({ data, period });
  } catch (err) {
    console.error("Get user registrations error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/users/activity?limit=10 ──────────────────────────
// const getRecentActivity = async (req, res) => {
//   try {
//     const limit = Math.min(parseInt(req.query.limit) || 10, 50);
//     const logs = await ActivityLog.findAll({
//       include: [
//         {
//           model: User,
//           as: "user",
//           attributes: ["id", "username"], // removed "name"
//           required: false,
//         },
//       ],
//       order: [["created_at", "DESC"]],
//       limit,
//     });
//     return res.status(200).json({ activity: logs });
//   } catch (err) {
//     console.error("Get recent activity error:", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// };

module.exports = {
  getAllUsers,
  getPendingUsers,
  getDeactivatedUsers,
  getWarnedUsers,
  getUserStats,
  getUserById,
  createUser,
  approveUser,
  warnUser,
  deactivateUser,
  reactivateUser,
  deleteUser,
  updateUser,
  runAutoReactivationJob,
  getUserRegistrations,
  // getRecentActivity,
};
