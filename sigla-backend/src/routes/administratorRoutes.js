const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const {
  getAllAdministrators,
  getDeactivatedAdministrators,
  getDeletedAdministrators,
  getAdministratorStats,
  getAdministratorById,
  createAdministrator,
  deactivateAdministrator,
  reactivateAdministrator,
  deleteAdministrator,
  updateAdministrator,
  resetAdministratorPassword,
} = require("../controllers/administratorController.js");
const { requestEmailCode, verifyEmailCode } = require("../controllers/emailController.js");
const { completeSetup } = require("../controllers/administratorController.js");
const requireSetupComplete = require("../middleware/requireSetupComplete.js");

// All routes require login
router.use(authMiddleware);

// ── Onboarding-safe routes (usable while must_complete_setup is true) ──
// Verified email add/change for the logged-in account
router.post("/email/request-code", requestEmailCode);
router.post("/email/verify", verifyEmailCode);
// Finish forced first-login setup
router.post("/complete-setup", completeSetup);

// ── Everything below requires completed setup ────────────────
router.use(requireSetupComplete);

// ── Stats — open to any admin (dashboard + reports need the counts) ──
router.get("/stats", roleMiddleware("admin"), getAdministratorStats);

// ── Administrator management routes — SUPER ADMIN ONLY (scope §15) ──
router.get("/deactivated", roleMiddleware("super_admin"), getDeactivatedAdministrators);
router.get("/deleted", roleMiddleware("super_admin"), getDeletedAdministrators);
router.get("/", roleMiddleware("super_admin"), getAllAdministrators);
router.post("/", roleMiddleware("super_admin"), createAdministrator);
router.get("/:id", roleMiddleware("super_admin"), getAdministratorById);
router.patch("/:id/deactivate", roleMiddleware("super_admin"), deactivateAdministrator);
router.patch("/:id/reactivate", roleMiddleware("super_admin"), reactivateAdministrator);
// Sets a TEMPORARY password and forces onboarding again — the only way a super
// admin can change someone else's password. See the controller for why.
router.post("/:id/reset-password", roleMiddleware("super_admin"), resetAdministratorPassword);
// PUT /:id stays open to any admin so each account can edit ITSELF; the
// controller allows the update only for self-edits or when the caller is super.
router.put("/:id", roleMiddleware("admin"), updateAdministrator);
router.delete("/:id", roleMiddleware("super_admin"), deleteAdministrator);

module.exports = router;

// ---

// Test in Postman — login as admin first, use Bearer <token> in Authorization header:
//
// GET    /api/administrators                  → list all administrators
// GET    /api/administrators/stats            → counts for dashboard
// GET    /api/administrators/deactivated      → deactivated list
// GET    /api/administrators/:id              → single administrator
// POST   /api/administrators                  → create administrator (username + password)
// PATCH  /api/administrators/:id/deactivate   → deactivate administrator
// PATCH  /api/administrators/:id/reactivate   → reactivate deactivated administrator
// POST   /api/administrators/:id/reset-password → set a temporary password
//                                                 (forces onboarding again)
// PUT    /api/administrators/:id              → edit administrator username/email
// DELETE /api/administrators/:id              → permanently delete administrator
