const { Op } = require("sequelize");
const { Notification, User } = require("../models/index.js");

// ── GET /api/notifications ────────────────────────────────────
// Get all notifications for the logged in user
// Also marks undelivered notifications as delivered
const getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    // Mark all undelivered notifications as delivered
    // This handles the case where user was offline and just reconnected
    await Notification.update(
      { delivered: true },
      {
        where: {
          user_id: req.user.id,
          delivered: false,
        },
      },
    );

    const { count, rows } = await Notification.findAndCountAll({
      where: { user_id: req.user.id },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    const unreadCount = await Notification.count({
      where: { user_id: req.user.id, is_read: false },
    });

    return res.status(200).json({
      total: count,
      unread: unreadCount,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      notifications: rows,
    });
  } catch (err) {
    console.error("Get notifications error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/notifications/:id/read ────────────────────────
// Mark a single notification as read
const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    await notification.update({ is_read: true });

    return res.status(200).json({ message: "Notification marked as read" });
  } catch (err) {
    console.error("Mark as read error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/notifications/read-all ────────────────────────
// Mark all notifications as read for the logged in user
const markAllAsRead = async (req, res) => {
  try {
    await Notification.update(
      { is_read: true },
      { where: { user_id: req.user.id, is_read: false } },
    );

    return res
      .status(200)
      .json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error("Mark all as read error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/notifications/:id ────────────────────────────
// Delete a single notification
const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    await notification.destroy();

    return res.status(200).json({ message: "Notification deleted" });
  } catch (err) {
    console.error("Delete notification error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/notifications/unread-count ──────────────────────
// Get unread notification count — used by mobile app to show badge
const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.count({
      where: { user_id: req.user.id, is_read: false },
    });

    return res.status(200).json({ unread: count });
  } catch (err) {
    console.error("Get unread count error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/notifications/announce ─────────────────────────
// Admin broadcasts an announcement to ALL active users
// Creates one notification record per active user
const broadcastAnnouncement = async (req, res) => {
  try {
    const { title, message } = req.body;

    if (!title || !message) {
      return res
        .status(400)
        .json({ message: "Title and message are required" });
    }

    // Get all active users
    const activeUsers = await User.findAll({
      where: { status: "active", role_id: 3 },
      attributes: ["id"],
    });

    if (activeUsers.length === 0) {
      return res
        .status(200)
        .json({ message: "No active users to notify", sent: 0 });
    }

    // Create one notification per active user
    const notifications = activeUsers.map((user) => ({
      user_id: user.id,
      title,
      message,
      type: "announcement",
      is_broadcast: true,
      is_read: false,
      delivered: false,
      created_at: new Date(),
    }));

    await Notification.bulkCreate(notifications);

    // Log activity
    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "broadcast_announcement",
    //   target_type: "announcement",
    //   target_id: null,
    //   details: `Broadcast announcement to ${activeUsers.length} users. Title: "${title}"`,
    // });

    return res.status(201).json({
      message: "Announcement sent successfully",
      sent: activeUsers.length,
    });
  } catch (err) {
    console.error("Broadcast announcement error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/notifications/admin/all ─────────────────────────
// Admin views all announcements ever sent
const getAllAnnouncements = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows } = await Notification.findAndCountAll({
      where: { is_broadcast: true },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
      // Group by title + message + created_at to avoid showing duplicate rows per user
      attributes: ["title", "message", "created_at", "type"],
      group: ["title", "message", "created_at", "type"],
    });

    return res.status(200).json({
      total: count.length,
      page: parseInt(page),
      totalPages: Math.ceil(count.length / limit),
      announcements: rows,
    });
  } catch (err) {
    console.error("Get all announcements error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  broadcastAnnouncement,
  getAllAnnouncements,
};
