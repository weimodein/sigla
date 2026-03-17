const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  broadcastAnnouncement,
  getAllAnnouncements,
} = require("../controllers/notificationController.js");

// All routes require login
router.use(authMiddleware);

// ── Static routes first ───────────────────────────────────────
router.get("/unread-count", getUnreadCount);
router.patch("/read-all", markAllAsRead);

// ── Admin only routes ─────────────────────────────────────────
router.post("/announce", roleMiddleware("admin"), broadcastAnnouncement);
router.get("/admin/all", roleMiddleware("admin"), getAllAnnouncements);

// ── User routes ───────────────────────────────────────────────
router.get("/", getNotifications);
router.patch("/:id/read", markAsRead);
router.delete("/:id", deleteNotification);

module.exports = router;

// ---

// Test in Postman — use Bearer <token> in Authorization header:
//
// GET    /api/notifications                  → get all notifications (user)
// GET    /api/notifications/unread-count     → get unread badge count (user)
// PATCH  /api/notifications/read-all         → mark all as read (user)
// PATCH  /api/notifications/:id/read         → mark single as read (user)
// DELETE /api/notifications/:id              → delete notification (user)
//
// POST   /api/notifications/announce         → broadcast to all users (admin)
//        Body: { "title": "Maintenance", "message": "System will be down at midnight." }
// GET    /api/notifications/admin/all        → view all sent announcements (admin)
