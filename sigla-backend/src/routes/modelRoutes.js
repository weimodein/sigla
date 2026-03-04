const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const {
  getAllModels,
  getModelStats,
  getLatestModel,
  getModelById,
  trainModel,
  testModel,
  deployModel,
  revertModel,
  deleteModel,
} = require("../controllers/modelController.js");

// All routes require login
router.use(authMiddleware);

// ── Static routes first ───────────────────────────────────────
router.get("/stats", roleMiddleware("admin", "super_admin"), getModelStats);
router.get(
  "/latest",
  roleMiddleware("admin", "super_admin", "user"),
  getLatestModel,
);

// ── Admin routes ──────────────────────────────────────────────
router.get("/", roleMiddleware("admin", "super_admin"), getAllModels);
router.get("/:id", roleMiddleware("admin", "super_admin"), getModelById);
router.post("/train", roleMiddleware("admin", "super_admin"), trainModel);
router.post("/test", roleMiddleware("admin", "super_admin"), testModel);
router.post("/deploy", roleMiddleware("admin", "super_admin"), deployModel);
router.post("/revert", roleMiddleware("admin", "super_admin"), revertModel);
router.delete("/:id", roleMiddleware("admin", "super_admin"), deleteModel);

module.exports = router;
// ```

// ---

// **Test in Postman:**
// ```
// GET  /api/models                  → all model versions
// GET  /api/models/stats            → counts for dashboard
// GET  /api/models/latest           → latest deployed model (used by mobile app)
// GET  /api/models/:id              → single model

// POST /api/models/train            → trigger training
// Body: { "version_number": "v1.0", "notes": "Initial model" }

// POST /api/models/test
// Body: { "model_id": 1 }

// POST /api/models/deploy
// Body: { "model_id": 1 }

// POST /api/models/revert
// Body: { "model_id": 1 }

// DELETE /api/models/:id            → delete inactive model
