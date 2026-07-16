const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const {
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
} = require("../controllers/userController.js");
const { getMySettings, updateMySettings } = require("../controllers/settingsController.js");

// All routes require login
router.use(authMiddleware);

// ── Settings (any authenticated user) ────────────────────────
router.get("/settings", getMySettings);
router.patch("/settings", updateMySettings);

// ── Static routes first ───────────────────────────────────────
router.get("/stats", roleMiddleware("admin"), getUserStats);
router.get("/deactivated", roleMiddleware("admin"), getDeactivatedUsers);
router.get("/deleted", roleMiddleware("admin"), getDeletedUsers);

// ── Administrator management routes ───────────────────────────
router.get("/", roleMiddleware("admin"), getAllUsers);
router.post("/", roleMiddleware("admin"), createUser);
router.get("/:id", roleMiddleware("admin"), getUserById);
router.patch("/:id/deactivate", roleMiddleware("admin"), deactivateUser);
router.patch("/:id/reactivate", roleMiddleware("admin"), reactivateUser);
router.put("/:id", roleMiddleware("admin"), updateUser);
router.delete("/:id", roleMiddleware("admin"), deleteUser);

module.exports = router;

// ---

// Test in Postman — login as admin first, use Bearer <token> in Authorization header:
//
// GET    /api/users                  → list all administrators
// GET    /api/users/stats            → counts for dashboard
// GET    /api/users/deactivated      → deactivated list
// GET    /api/users/:id              → single administrator
// POST   /api/users                  → create administrator (username + password)
// PATCH  /api/users/:id/deactivate   → deactivate administrator
// PATCH  /api/users/:id/reactivate   → reactivate deactivated administrator
// PUT    /api/users/:id              → edit administrator info
// DELETE /api/users/:id              → permanently delete administrator
