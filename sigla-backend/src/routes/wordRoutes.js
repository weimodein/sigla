const express = require("express");
const multer = require("multer");
const { Op } = require("sequelize");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const requireSetupComplete = require("../middleware/requireSetupComplete.js");
const { Word, Category, ModelVersion } = require("../models/index.js");
const {
  getAllWords,
  getWordStats,
  getWordById,
  adminAddWord,
  adminUploadSamples,
  approveWord,
  rejectWord,
  updateWord,
  deleteWord,
  getSamples,
  getMotionSequences,
  generateVideo,
  approveSample,
  rejectSample,
  approveAllSamplesByUser,
  rejectAllSamplesByUser,
  approveAllSamplesForWord,
  rejectAllSamplesForWord,
  approveSubmission,
  rejectSubmission,
  activateWord,
  setThumbnail,
  setVideo,
  uploadVideos,
  getUploadJob,
  getActiveUploadJob,
} = require("../controllers/wordController.js");
const videoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ... other requires

// Public route for mobile word bank.
//
// The word list is derived from the CURRENTLY DEPLOYED model version, not from a
// standalone flag. Word.is_active used to be a one-way latch — deploy set it
// true and nothing ever set it back — so reverting to an older model left the
// phone advertising words that model was never trained on. Keying off the
// deployed row means deploy and revert both move the word bank automatically.
//
// Falls back to is_active when the deployed version predates trained_word_ids,
// or when nothing is deployed at all, so existing data behaves exactly as before.
router.get("/word-bank", async (req, res) => {
  try {
    const deployed = await ModelVersion.findOne({
      where: { status: "deployed" },
      attributes: ["id", "version_number", "trained_word_ids"],
    });

    const trainedIds = Array.isArray(deployed?.trained_word_ids)
      ? deployed.trained_word_ids
      : null;

    const where = trainedIds
      ? { id: { [Op.in]: trainedIds } }
      : { is_active: true };

    const rows = await Word.findAll({
      where,
      attributes: [
        "id",
        "label",
        "description",
        "sign_type",
        "thumbnail_url",
        "video_url",
        "filipino_translation",
      ],
      include: [{ model: Category, as: "category_ref", attributes: ["name"] }],
      order: [["label", "ASC"]],
    });
    // Emit `category` as a name string (default "additional words") — the shape
    // the mobile app's ModelInfo expects. category_id stays internal.
    const words = rows.map((w) => {
      const json = w.toJSON();
      const category = json.category_ref?.name || "additional words";
      delete json.category_ref;
      return { ...json, category };
    });
    // model_version is additive — it lets the client tell which model this list
    // belongs to and refetch when that changes. The `words` array is unchanged.
    res.json({ words, model_version: deployed?.version_number ?? null });
  } catch (err) {
    console.error("Word bank error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// All other routes require login + completed first-login setup
router.use(authMiddleware);
router.use(requireSetupComplete);

// ── Static routes first ───────────────────────────────────────
router.get("/stats", roleMiddleware("admin"), getWordStats);

// ── Admin add word manually ───────────────────────────────────
// IMPORTANT: must come before /:id wildcard routes
router.post("/admin-add", roleMiddleware("admin"), adminAddWord);

// ── Upload job status ─────────────────────────────────────────
// IMPORTANT: must come before the /:id wildcard below, or "upload-jobs" is
// swallowed as a word id and getWordById answers with a 404 instead.
router.get("/upload-jobs/:jobId", roleMiddleware("admin"), getUploadJob);


// ── List ──────────────────────────────────────────────────────
router.get("/", roleMiddleware("admin"), getAllWords);
router.get("/:id", roleMiddleware("admin"), getWordById);

// ── Admin sample upload (auto-approved, bypasses user cap) ────
router.post("/:id/admin-samples", roleMiddleware("admin"), adminUploadSamples);

// ── Admin video upload → ML landmark extraction ───────────────
// Returns 202 with an upload_jobs row; extraction runs in the background.
router.post("/:id/upload-videos", roleMiddleware("admin"), videoUpload.array("videos", 50), uploadVideos);

// The live batch for this word, so the UI can re-adopt a job in flight after a
// reload or navigating back.
router.get("/:id/upload-jobs/active", roleMiddleware("admin"), getActiveUploadJob);

// ── Samples ───────────────────────────────────────────────────
router.get("/:id/samples", roleMiddleware("admin"), getSamples);

// ── Sample review routes (admin only) ────────────────────────
// IMPORTANT: specific /user/:userId routes MUST come BEFORE /:sampleId wildcard
// otherwise Express matches "user" as sampleId and the route is never reached
router.patch(
  "/:id/samples/approve-all",
  roleMiddleware("admin"),
  approveAllSamplesForWord,
);
router.patch(
  "/:id/samples/reject-all",
  roleMiddleware("admin"),
  rejectAllSamplesForWord,
);
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

// ── Submission level routes ───────────────────────────────────
// IMPORTANT: these must come AFTER /:id/samples/user/:userId routes
// but BEFORE /:id/lock /:id/unlock etc.
router.patch(
  "/:id/approve-submission/:userId?",
  roleMiddleware("admin"),
  approveSubmission,
);
router.patch(
  "/:id/reject-submission/:userId?",
  roleMiddleware("admin"),
  rejectSubmission,
);
router.patch("/:id/activate", roleMiddleware("admin"), activateWord);

// ── Motion sequence routes (admin only) ───────────────────────
router.get("/:id/motion-sequences", roleMiddleware("admin"), getMotionSequences);
router.post("/:id/generate-video", roleMiddleware("admin"), generateVideo);

// ── Admin word management ─────────────────────────────────────
router.patch("/:id/set-thumbnail", roleMiddleware("admin"), setThumbnail);
router.patch("/:id/set-video", roleMiddleware("admin"), setVideo);
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
