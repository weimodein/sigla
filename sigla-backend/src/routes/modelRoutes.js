const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const requireSetupComplete = require("../middleware/requireSetupComplete.js");
const {
  getAllModels,
  getModelStats,
  getLatestModel,
  getModelById,
  trainModel,
  getModelStatus,
  testModel,
  deployModel,
  revertModel,
  deleteModel,
} = require("../controllers/modelController.js");

// Public — mobile checks for model updates before/after login
router.get("/latest", getLatestModel);

// All other routes require login + completed first-login setup
router.use(authMiddleware);
router.use(requireSetupComplete);

// ── Static routes first ───────────────────────────────────────
router.get("/stats", roleMiddleware("admin"), getModelStats);

// ── Admin model management routes ────────────────────────────
router.get("/", roleMiddleware("admin"), getAllModels);
router.get("/:id/status", roleMiddleware("admin"), getModelStatus);
router.get("/:id", roleMiddleware("admin"), getModelById);
router.post("/train", roleMiddleware("admin"), trainModel);
router.post("/test", roleMiddleware("admin"), testModel);
router.post("/deploy", roleMiddleware("admin"), deployModel);
router.post("/revert", roleMiddleware("admin"), revertModel);
router.delete("/:id", roleMiddleware("admin"), deleteModel);

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
// Body: { "version_number": "1.0.0" }

// POST /api/models/revert
// Body: { "version_number": "1.0.0" }

// DELETE /api/models/:id            → delete inactive model
