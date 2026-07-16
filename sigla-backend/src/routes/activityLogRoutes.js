const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const { getActivityLogs } = require("../controllers/activityLogController.js");

// All routes require login
router.use(authMiddleware);

// ── Read-only audit trail (admin) ─────────────────────────────
router.get("/", roleMiddleware("admin"), getActivityLogs);

module.exports = router;

// ---
// GET /api/activity-logs?action=&target_type=&startDate=&endDate=&search=&page=&limit=
//   → paginated system-wide activity log, most recent first
