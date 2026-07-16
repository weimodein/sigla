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
const { requestEmailCode, verifyEmailCode } = require("../controllers/emailController.js");

// All routes require login
router.use(authMiddleware);

// ── Settings (any authenticated user) ────────────────────────
router.get("/settings", getMySettings);
router.patch("/settings", updateMySettings);

// ── Verified email add/change for the logged-in account ──────
router.post("/email/request-code", requestEmailCode);
router.post("/email/verify", verifyEmailCode);

// ── Stats — open to any admin (dashboard + reports need the counts) ──
router.get("/stats", roleMiddleware("admin"), getUserStats);

// ── Administrator management routes — MASTER ADMIN ONLY (scope §15) ──
router.get("/deactivated", roleMiddleware("master_admin"), getDeactivatedUsers);
router.get("/deleted", roleMiddleware("master_admin"), getDeletedUsers);
router.get("/", roleMiddleware("master_admin"), getAllUsers);
router.post("/", roleMiddleware("master_admin"), createUser);
router.get("/:id", roleMiddleware("master_admin"), getUserById);
router.patch("/:id/deactivate", roleMiddleware("master_admin"), deactivateUser);
router.patch("/:id/reactivate", roleMiddleware("master_admin"), reactivateUser);
// PUT /:id stays open to any admin so each account can edit ITSELF; the
// controller allows the update only for self-edits or when the caller is master.
router.put("/:id", roleMiddleware("admin"), updateUser);
router.delete("/:id", roleMiddleware("master_admin"), deleteUser);

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
