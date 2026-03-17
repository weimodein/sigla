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
  approveSample,
  rejectSample,
  approveAllSamplesByUser,
  rejectAllSamplesByUser,
  approveSubmission,
  rejectSubmission,
  lockWord,
  unlockWord,
  getUserSampleCountForWord,
} = require("../controllers/wordController.js");

// All routes require login
router.use(authMiddleware);

// ── Static routes first ───────────────────────────────────────
router.get("/stats", roleMiddleware("admin"), getWordStats);

// ── User routes ───────────────────────────────────────────────
router.get("/", roleMiddleware("admin"), getAllWords);
router.get("/:id", roleMiddleware("admin", "user"), getWordById);
router.post("/", roleMiddleware("user"), submitWord);
router.post("/:id/samples", roleMiddleware("user"), uploadSamples);
router.get("/:id/samples", roleMiddleware("admin"), getSamples);

// ── Sample review routes (admin only) ────────────────────────
// IMPORTANT: specific /user/:userId routes must come BEFORE /:sampleId wildcard
// otherwise Express matches "user" as a sampleId and the route is never reached
router.patch(
  "/:id/samples/user/:userId/approve-all",
  roleMiddleware("admin"),
  approveAllSamplesByUser,
);
router.patch(
  "/:id/samples/user/:userId/reject-all",
  roleMiddleware("admin"),
  rejectAllSamplesByUser,
);
router.patch(
  "/:id/samples/:sampleId/approve",
  roleMiddleware("admin"),
  approveSample,
);
router.patch(
  "/:id/samples/:sampleId/reject",
  roleMiddleware("admin"),
  rejectSample,
);

// ── Submission level routes (admin only) ──────────────────────
router.patch(
  "/:id/approve-submission",
  roleMiddleware("admin"),
  approveSubmission,
);
router.patch(
  "/:id/reject-submission",
  roleMiddleware("admin"),
  rejectSubmission,
);
router.patch("/:id/lock", roleMiddleware("admin"), lockWord);
router.patch("/:id/unlock", roleMiddleware("admin"), unlockWord);

// ── User + admin accessible ───────────────────────────────────
router.get(
  "/:id/user-sample-count",
  roleMiddleware("admin", "user"),
  getUserSampleCountForWord,
);

// ── Admin word management routes ──────────────────────────────
router.patch("/:id/approve", roleMiddleware("admin"), approveWord);
router.patch("/:id/reject", roleMiddleware("admin"), rejectWord);
router.put("/:id", roleMiddleware("admin"), updateWord);
router.delete("/:id", roleMiddleware("admin"), deleteWord);

module.exports = router;

// ---

// Test in Postman:
//
// GET    /api/words?status=pending                          → all pending words (admin)
// GET    /api/words?sign_type=FSL                          → FSL words only (admin)
// GET    /api/words/stats                                  → word counts (admin)
// GET    /api/words/:id                                    → single word (user/admin)
// POST   /api/words                                        → submit word (user)
// PUT    /api/words/:id                                    → edit word (admin)
// DELETE /api/words/:id                                    → delete word (admin)
//
// POST   /api/words/:id/samples                            → upload samples (user)
// GET    /api/words/:id/samples                            → get all samples (admin)
// GET    /api/words/:id/user-sample-count                  → check user sample count (user/admin)
//
// PATCH  /api/words/:id/samples/user/:userId/approve-all   → approve all from user (admin)
// PATCH  /api/words/:id/samples/user/:userId/reject-all    → reject all from user (admin)
// PATCH  /api/words/:id/samples/:sampleId/approve          → approve single sample (admin)
// PATCH  /api/words/:id/samples/:sampleId/reject           → reject single sample (admin)
//
// PATCH  /api/words/:id/approve-submission                 → approve full submission (admin)
// PATCH  /api/words/:id/reject-submission                  → reject full submission (admin)
// PATCH  /api/words/:id/approve                            → manual word approval (admin)
// PATCH  /api/words/:id/reject                             → manual word rejection (admin)
//
// PATCH  /api/words/:id/lock                               → lock word submissions (admin)
// PATCH  /api/words/:id/unlock                             → unlock word submissions (admin)
