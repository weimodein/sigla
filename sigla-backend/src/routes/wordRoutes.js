const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const {
  getAllWords,
  getWordStats,
  getWordById,
  submitWord,
  approveWord,
  rejectWord,
  updateWord,
  deleteWord,
  uploadSamples,
  getSamples,
} = require("../controllers/wordController.js");

// All routes require login
router.use(authMiddleware);

// ── Static routes first ───────────────────────────────────────
router.get("/stats", roleMiddleware("admin", "super_admin"), getWordStats);

// ── User routes ───────────────────────────────────────────────
router.get("/", roleMiddleware("admin", "super_admin"), getAllWords);
router.get("/:id", roleMiddleware("admin", "super_admin", "user"), getWordById);
router.post("/", roleMiddleware("user"), submitWord);
router.post("/:id/samples", roleMiddleware("user"), uploadSamples);
router.get("/:id/samples", roleMiddleware("admin", "super_admin"), getSamples);

// ── Admin routes ──────────────────────────────────────────────
router.patch(
  "/:id/approve",
  roleMiddleware("admin", "super_admin"),
  approveWord,
);
router.patch("/:id/reject", roleMiddleware("admin", "super_admin"), rejectWord);
router.put("/:id", roleMiddleware("admin", "super_admin"), updateWord);
router.delete("/:id", roleMiddleware("admin", "super_admin"), deleteWord);

module.exports = router;
// ```

// ---

// **Test in Postman:**
// ```
// GET    /api/words?status=pending         → all pending words
// GET    /api/words?sign_type=FSL          → FSL words only
// GET    /api/words?sign_type=ASL          → ASL words only
// GET    /api/words/stats                  → word counts
// GET    /api/words/:id                    → single word
// POST   /api/words                        → submit word (user token)
// PATCH  /api/words/:id/approve            → approve (admin token)
// PATCH  /api/words/:id/reject             → reject (admin token)
// PUT    /api/words/:id                    → edit (admin token)
// DELETE /api/words/:id                    → delete (admin token)
// POST   /api/words/:id/samples            → upload samples (user token)
// GET    /api/words/:id/samples            → get samples (admin token)
