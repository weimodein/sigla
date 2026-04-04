const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const {
  getAllUsers,
  getPendingUsers,
  getDeactivatedUsers,
  getUserStats,
  getUserById,
  createUser,
  approveUser,
  warnUser,
  deactivateUser,
  reactivateUser,
  deleteUser,
  updateUser,
  getUserRegistrations,
  // getRecentActivity,
} = require("../controllers/userController.js");

// All routes require login
router.use(authMiddleware);

// ── Static routes first ───────────────────────────────────────
router.get("/stats", roleMiddleware("admin"), getUserStats);
router.get("/registrations", roleMiddleware("admin"), getUserRegistrations);
// router.get("/activity", roleMiddleware("admin"), getRecentActivity);
router.get("/pending", roleMiddleware("admin"), getPendingUsers);
router.get("/deactivated", roleMiddleware("admin"), getDeactivatedUsers);

// ── Admin user management routes ──────────────────────────────
router.get("/", roleMiddleware("admin"), getAllUsers);
router.post("/create", roleMiddleware("admin"), createUser);
router.get("/:id", roleMiddleware("admin"), getUserById);
router.patch("/:id/approve", roleMiddleware("admin"), approveUser);
router.patch("/:id/warn", roleMiddleware("admin"), warnUser);
router.patch("/:id/deactivate", roleMiddleware("admin"), deactivateUser);
router.patch("/:id/reactivate", roleMiddleware("admin"), reactivateUser);
router.put("/:id", roleMiddleware("admin"), updateUser);
router.delete("/:id", roleMiddleware("admin"), deleteUser);

module.exports = router;

// ---

// Test in Postman — login as admin first, use Bearer <token> in Authorization header:
//
// GET    /api/users                  → list all users
// GET    /api/users/stats            → counts for dashboard
// GET    /api/users/pending          → pending approvals
// GET    /api/users/deactivated      → deactivated list
// GET    /api/users/:id              → single user
// PATCH  /api/users/:id/approve      → approve pending user
// PATCH  /api/users/:id/warn         → issue warning to user (max 2 before deactivate)
// PATCH  /api/users/:id/deactivate   → deactivate user (only after 2 warnings)
// PATCH  /api/users/:id/reactivate   → manually reactivate deactivated user
// PUT    /api/users/:id              → edit user info
// DELETE /api/users/:id              → permanently delete user
