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
  updateWord,
  deleteWord,
  getSamples,
  deleteAllSamplesForWord,
  setVideo,
  uploadVideos,
  getUploadJob,
  getSignerIds,
  getActiveUploadJobs,
  getActiveUploadJob,
} = require("../controllers/wordController.js");
const videoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

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
    // Every deployed model, not just one: the words model and the alphabet
    // model are deployed side by side, and a findOne here would pick whichever
    // the database returned first and show the word bank as only that model's
    // vocabulary — with the alphabet winning, a five-entry word bank.
    const deployedAll = await ModelVersion.findAll({
      where: { status: "deployed" },
      attributes: ["id", "version_number", "trained_word_ids", "model_kind"],
      order: [["deployed_at", "DESC"]],
    });

    if (deployedAll.length > 0) {
      const wordsRows = deployedAll.filter((model) => model.model_kind === "words");
      const lettersRows = deployedAll.filter((model) => model.model_kind === "letters");
      if (
        wordsRows.length !== 1 ||
        lettersRows.length !== 1 ||
        wordsRows[0].version_number !== lettersRows[0].version_number
      ) {
        console.error(
          "Word bank refused an inconsistent deployed model pair:",
          deployedAll.map((model) => `${model.version_number}:${model.model_kind}`),
        );
        return res.status(503).json({
          message: "The deployed model pair is inconsistent. Please deploy a complete version.",
        });
      }
    }

    // The browsable word bank is the union of what the phone can actually
    // recognise across both models.
    const trainedIds = deployedAll.some((m) => Array.isArray(m.trained_word_ids))
      ? [
          ...new Set(
            deployedAll.flatMap((m) =>
              Array.isArray(m.trained_word_ids) ? m.trained_word_ids : [],
            ),
          ),
        ]
      : null;

    // The words model names the version, since that is what the pre-split
    // response meant and what a client comparing versions expects to move when
    // the main vocabulary changes.
    const deployed =
      deployedAll.find((m) => m.model_kind === "words") || deployedAll[0] || null;

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
        // Which model the word belongs to ("words" | "letters"). The app uses it
        // to open the translator on the right vocabulary from a word's page.
        "vocabulary",
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

// ── Known signer IDs ──────────────────────────────────────────
// Same ordering requirement as upload-jobs below: this must precede the /:id
// wildcard, or "signers" is read as a word id.
router.get("/signers", roleMiddleware("admin"), getSignerIds);

// ── Upload job status ─────────────────────────────────────────
// IMPORTANT: must come before the /:id wildcard below, or "upload-jobs" is
// swallowed as a word id and getWordById answers with a 404 instead.
//
// "active" is registered BEFORE /:jobId for the same reason one level down:
// Express would otherwise match the literal string as a job id.
router.get("/upload-jobs/active", roleMiddleware("admin"), getActiveUploadJobs);
router.get("/upload-jobs/:jobId", roleMiddleware("admin"), getUploadJob);


// ── List ──────────────────────────────────────────────────────
router.get("/", roleMiddleware("admin"), getAllWords);
router.get("/:id", roleMiddleware("admin"), getWordById);

// ── Admin video upload → ML landmark extraction ───────────────
// Returns 202 with an upload_jobs row; extraction runs in the background.
router.post("/:id/upload-videos", roleMiddleware("admin"), videoUpload.array("videos", 50), uploadVideos);

// The live batch for this word, so the UI can re-adopt a job in flight after a
// reload or navigating back.
router.get("/:id/upload-jobs/active", roleMiddleware("admin"), getActiveUploadJob);

// ── Samples ───────────────────────────────────────────────────
router.get("/:id/samples", roleMiddleware("admin"), getSamples);

// Permanently delete every sample for a word, keeping the word row. Requires
// ?confirm=<label>. Registered before the /:sampleId routes below for the same
// reason they are ordered that way — Express would otherwise have no chance to
// match this bare path once a wildcard segment is in play.
router.delete("/:id/samples", roleMiddleware("admin"), deleteAllSamplesForWord);

// ── Admin word management ─────────────────────────────────────
router.patch("/:id/set-video", roleMiddleware("admin"), setVideo);
router.put("/:id", roleMiddleware("admin"), updateWord);
router.delete("/:id", roleMiddleware("admin"), deleteWord);

module.exports = router;
