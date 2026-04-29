const express = require("express");
const multer = require("multer");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware.js");
const roleMiddleware = require("../middleware/roleMiddleware.js");
const Word = require("../models/Word.js");
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
} = require("../controllers/wordController.js");

const videoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ... other requires

// Public route for mobile word bank
router.get("/word-bank", async (req, res) => {
  try {
    const words = await Word.findAll({
      where: { is_active: true },
      attributes: [
        "id",
        "label",
        "description",
        "sign_type",
        "category",
        "hands_count",
        "gesture_type",
        "thumbnail_url",
        "video_url",
        "filipino_translation",
      ],
      order: [["label", "ASC"]],
    });
    res.json({ words });
  } catch (err) {
    console.error("Word bank error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// All other routes require login
router.use(authMiddleware);

// ── Static routes first ───────────────────────────────────────
router.get("/stats", roleMiddleware("admin"), getWordStats);

// ── Admin add word manually ───────────────────────────────────
// IMPORTANT: must come before /:id wildcard routes
router.post("/admin-add", roleMiddleware("admin"), adminAddWord);

// ── List ──────────────────────────────────────────────────────
router.get("/", roleMiddleware("admin"), getAllWords);
router.get("/:id", roleMiddleware("admin"), getWordById);

// ── Admin sample upload (auto-approved, bypasses user cap) ────
router.post("/:id/admin-samples", roleMiddleware("admin"), adminUploadSamples);

// ── Admin video upload → ML landmark extraction ───────────────
router.post("/:id/upload-videos", roleMiddleware("admin"), videoUpload.array("videos", 50), uploadVideos);

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

// ── User + admin accessible ───────────────────────────────────
router.get(
  "/:id/user-sample-count",
  roleMiddleware("admin", "user"),
  getUserSampleCountForWord,
);

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
