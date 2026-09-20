const { Op } = require("sequelize");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
  Word,
  GestureSample,
  Administrator,
  Category,
  UploadJob,
} = require("../models/index.js");
const { logActivity } = require("../utils/activityLogger.js");
const { validateWordLabel } = require("../utils/validators.js");
const { sequelize } = require("../config/db.js");

// Resolve a category *name* (what the form and mobile send) to its id, or null
// when the name is blank or matches no category. Case-insensitive, mirroring the
// old text join. Returns the FK the words table now stores.
const resolveCategoryId = async (name) => {
  if (!name || !String(name).trim()) return null;
  const cat = await Category.findOne({
    where: sequelize.where(
      sequelize.fn("LOWER", sequelize.col("name")),
      String(name).trim().toLowerCase(),
    ),
  });
  return cat ? cat.id : null;
};

// Flatten a Word instance (with category_ref included) to the API shape the
// clients expect: a `category` name string, defaulting to "additional words".
const withCategoryName = (word) => {
  const json = typeof word.toJSON === "function" ? word.toJSON() : word;
  const name = json.category_ref?.name || "additional words";
  delete json.category_ref;
  return { ...json, category: name };
};

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET      = process.env.SUPABASE_BUCKET_GESTURES || "gesture-samples";
const SUPABASE_BUCKET_VIDEOS = process.env.SUPABASE_BUCKET_VIDEOS || "gesture-videos";

// Fall back to local disk only when Supabase env vars are missing (dev without .env)
const UPLOADS_DIR = path.join(__dirname, "../../uploads/samples");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Sample caps ───────────────────────────────────────────────
// All gestures are motion; a single flat cap/threshold applies to every word.
const PER_USER_CAP = 25;         // max samples ONE user can contribute to a word
const DEFAULT_SAMPLE_CAP = 25;   // flat total-sample cap per word, across all users
const ACTIVATION_THRESHOLD = 20; // approved samples needed before a word is deploy-eligible (scope §17)
const MIN_SIGNERS_PER_WORD = Number.parseInt(process.env.MIN_SIGNERS_PER_WORD || "4", 10);
const MIN_SAMPLES_PER_SIGNER = Number.parseInt(process.env.MIN_SAMPLES_PER_SIGNER || "4", 10);

// ── Helper: normalize word label ──────────────────────────────
const normalizeLabel = (label) =>
  label
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();

// ── Helper: total sample cap per word ─────────────────────────
// A flat default applies to every word. (The `word` argument is kept so the
// call sites are unchanged and a per-word cap could return later.)
// eslint-disable-next-line no-unused-vars
const getSampleCap = (word) => DEFAULT_SAMPLE_CAP;

// ── Helper: per-user cap ──────────────────────────────────────
const getPerUserCap = () => PER_USER_CAP;

// ── Helper: activation threshold ──────────────────────────────
const getActivationThreshold = () => ACTIVATION_THRESHOLD;

// ── Helper: get total samples submitted by user for a word ────
const getUserSampleCount = async (userId, wordId) => {
  return await GestureSample.count({
    where: { submitted_by: userId, word_id: wordId },
  });
};

// ── Helper: get total approved samples for a word ─────────────
const getApprovedSampleCount = async (wordId) => {
  return await GestureSample.count({
    where: { word_id: wordId, status: "approved" },
  });
};

// Live sample counts, derived from gesture_samples rather than read from the
// words.total_samples / words.approved_sample_count columns.
//
// Those columns are denormalized counters that were incremented on upload and
// never decremented on delete, so they drifted from reality the first time any
// samples were removed: after two cleanups the admin UI reported 1880 samples
// against 1039 real rows, and showed the twelve CALENDAR words as holding 33-40
// samples each when all of them had zero. That is not a cosmetic difference — it
// is the UI asserting that training data exists when it does not.
//
// A decrement on the delete path would not have fixed it. Rows are also removed
// by direct SQL during dataset cleanups, which no controller-side hook observes.
// Deriving the number instead makes it impossible to drift, and at this scale
// (~1k sample rows, indexed word_id FK) the cost is not measurable.
//
// Returns a Map of word_id -> { total, approved }; callers merge it into their
// response so the API shape stays exactly as clients expect.
const getSampleCounts = async (wordIds = null) => {
  const where = wordIds && wordIds.length ? { word_id: { [Op.in]: wordIds } } : {};
  const rows = await GestureSample.findAll({
    where,
    attributes: [
      "word_id",
      [sequelize.fn("COUNT", sequelize.col("id")), "total"],
      [
        sequelize.fn(
          "SUM",
          sequelize.literal("CASE WHEN status = 'approved' THEN 1 ELSE 0 END"),
        ),
        "approved",
      ],
    ],
    group: ["word_id"],
    raw: true,
  });
  const counts = new Map();
  for (const r of rows) {
    counts.set(Number(r.word_id), {
      total: Number(r.total) || 0,
      approved: Number(r.approved) || 0,
    });
  }
  return counts;
};

// Overlay derived counts onto a word (or plain object) for the API response.
// Words with no samples are absent from the count map, so they resolve to 0
// rather than to whatever the stale column happened to hold.
const withSampleCounts = (word, counts) => {
  const json = typeof word.toJSON === "function" ? word.toJSON() : { ...word };
  const c = counts.get(Number(json.id)) || { total: 0, approved: 0 };
  json.total_samples = c.total;
  json.approved_sample_count = c.approved;
  return json;
};

// Count only known signer IDs with enough approved clips. The uploading admin is
// not a signer identifier, and twenty clips from one person do not demonstrate
// that a model will work for a new user.
const getSignerCoverage = async (wordId) => {
  const rows = await GestureSample.findAll({
    where: {
      word_id: wordId,
      status: "approved",
      session_id: { [Op.ne]: null },
    },
    attributes: ["session_id"],
    raw: true,
  });
  const counts = {};
  for (const row of rows) {
    const signer = String(row.session_id || "").trim().toLowerCase();
    if (signer) counts[signer] = (counts[signer] || 0) + 1;
  }
  const qualifiedSigners = Object.values(counts).filter(
    (count) => count >= MIN_SAMPLES_PER_SIGNER,
  ).length;
  return { counts, qualifiedSigners };
};

// ── Helper: update sample count; mark word approved when threshold met ────
// Words are NOT activated here — activation only happens on model deploy.
const checkAndActivateWord = async (word, reviewerId = null) => {
  const threshold = getActivationThreshold();
  const approvedCount = await getApprovedSampleCount(word.id);
  const signerCoverage = await getSignerCoverage(word.id);

  const reachedThreshold =
    approvedCount >= threshold &&
    signerCoverage.qualifiedSigners >= MIN_SIGNERS_PER_WORD;

  await word.update({
    approved_sample_count: approvedCount,
    // Mark as approved (ready for training) once threshold is reached,
    // but do NOT set is_active — that only happens on model deploy.
    ...(reachedThreshold &&
      word.status !== "approved" && {
        status: "approved",
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
      }),
  });

  return reachedThreshold;
};

// ── Helper: extract landmarks for one file via the ML service and store a
// GestureSample. Shared by the manual upload route (uploadVideos) and the
// FSL-105 bulk importer so both use identical extraction + storage logic.
//
// Returns { status: "ok"|"skipped"|"failed", type, sample_id?, reason?/error? }.
// Does NOT update word counters — the caller does that after a batch.
const IMAGE_RX = /\.(jpe?g|png)$/i;
const VIDEO_RX = /\.(mov|mp4|webm|avi|mkv)$/i;

const extractAndStoreSample = async (
  word,
  fileBuffer,
  filename,
  mimetype,
  userId,
  fileUrl = null,
  sessionId = null,
) => {
  const isVideo = VIDEO_RX.test(filename) || (mimetype || "").startsWith("video/");

  // Every gesture is motion — only video files produce a valid sequence.
  if (!isVideo) {
    return { file: filename, status: "skipped", type: "unknown", reason: "Only video files are supported" };
  }

  const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
  const FormData = require("form-data");

  try {
    const form = new FormData();
    form.append("file", fileBuffer, { filename, contentType: mimetype });

    const mlRes = await axios.post(`${ML_SERVICE_URL}/extract-landmarks`, form, {
      headers: form.getHeaders(),
      timeout: 60000,
      maxBodyLength: Infinity,
    });

    const { sequence } = mlRes.data;

    const sample = await GestureSample.create({
      word_id: word.id,
      submitted_by: userId,
      file_url: fileUrl || `video_upload_${Date.now()}`,
      session_id: sessionId,
      sample_count: 1,
      status: "approved",
      is_validated: true,
      sequence: sequence,
    });

    return { file: filename, status: "ok", type: "video", sample_id: sample.id };
  } catch (err) {
    // Log the cause. This used to return silently, so a batch where EVERY clip
    // failed still came back as HTTP 207 "N processed, M failed" with nothing in
    // the server log — the failure was invisible from both the terminal and the UI.
    //
    // err.message alone is rarely enough: Sequelize puts the real Postgres error in
    // err.original (type mismatch, constraint, connection) and validation failures in
    // err.errors, while an ML-service rejection arrives as err.response.data.detail.
    const detail =
      err.response?.data?.detail ||
      err.original?.message ||
      err.errors?.map((e) => e.message).join("; ") ||
      err.message;

    console.error(
      `[extractAndStoreSample] FAILED "${filename}" (word=${word.label}): ${detail}`,
      {
        name: err.name,
        http_status: err.response?.status,
        pg_code: err.original?.code,
        validation: err.errors?.map((e) => `${e.path}: ${e.message}`),
      },
    );

    return { file: filename, status: "failed", type: "video", error: detail };
  }
};

// ── Helper: upload a base64 image to Supabase Storage, return its public URL
// Falls back to local disk when Supabase env vars are not set (local dev).
const saveImage = async (base64, index, folder = "static") => {
  const filename = `sample_${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${index}.jpg`;
  const buffer   = Buffer.from(base64, "base64");

  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const storagePath = `${folder}/${filename}`;
      const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${storagePath}`;
      const res = await axios.post(url, buffer, {
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
        },
        maxBodyLength: Infinity,
        validateStatus: null, // don't throw on non-2xx, log it instead
      });
      if (res.status >= 200 && res.status < 300) {
        return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${storagePath}`;
      }
      console.error(`Supabase upload failed [${res.status}]:`, JSON.stringify(res.data));
      throw new Error(`Supabase ${res.status}: ${JSON.stringify(res.data)}`);
    } catch (e) {
      console.error("Supabase upload error:", e.message);
      throw e; // propagate so the whole sample upload fails visibly instead of saving broken local paths
    }
  }

  // Local fallback
  try {
    const filepath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filepath, buffer);
    return `/uploads/samples/${folder}/${filename}`;
  } catch (e) {
    return `landmark_direct_${Date.now()}_${index}`;
  }
};

// ── Upload a demonstration video to Supabase Storage ─────────
// Mirrors saveImage: pushes to the gesture-videos bucket and returns the
// public URL. Falls back to local disk when Supabase env vars are absent.
const VIDEO_CONTENT_TYPES = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

const saveVideo = async (buffer, ext, wordId) => {
  const cleanExt = (ext || "mp4").replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp4";
  const contentType = VIDEO_CONTENT_TYPES[cleanExt] || "application/octet-stream";
  const filename = `gesture_${wordId}_${Date.now()}.${cleanExt}`;

  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const storagePath = filename;
      const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET_VIDEOS}/${storagePath}`;
      const res = await axios.post(url, buffer, {
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        maxBodyLength: Infinity,
        validateStatus: null, // don't throw on non-2xx, log it instead
      });
      if (res.status >= 200 && res.status < 300) {
        return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET_VIDEOS}/${storagePath}`;
      }
      console.error(`Supabase video upload failed [${res.status}]:`, JSON.stringify(res.data));
      throw new Error(`Supabase ${res.status}: ${JSON.stringify(res.data)}`);
    } catch (e) {
      console.error("Supabase video upload error:", e.message);
      throw e; // propagate so the upload fails visibly instead of saving broken paths
    }
  }

  // Local fallback
  const videosDir = path.join(__dirname, "../../uploads/videos");
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
  const filepath = path.join(videosDir, filename);
  fs.writeFileSync(filepath, buffer);
  return `/uploads/videos/${filename}`;
};

// ── GET /api/words ────────────────────────────────────────────
const getAllWords = async (req, res) => {
  try {
    const {
      status,
      sign_type,
      category,
      search,
      page = 1,
      limit = 10,
    } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (sign_type) where.sign_type = sign_type;
    // The filter arrives as a category name; resolve it to the FK.
    //
    // A name that matches nothing resolves to null, and assigning that directly
    // meant `category_id: null` — which matches every UNCATEGORISED word instead
    // of none. Picking a since-deleted category from a stale dropdown therefore
    // filled the table with unrelated words as though they belonged to it. An
    // unresolvable filter must match nothing, so use an id that cannot exist.
    if (category) {
      const resolvedCategoryId = await resolveCategoryId(category);
      where.category_id = resolvedCategoryId === null ? -1 : resolvedCategoryId;
    }
    if (search) {
      where[Op.or] = [
        { label: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await Word.findAndCountAll({
      where,
      include: [
        {
          model: Administrator,
          as: "submitter",
          attributes: ["id", "username"],
        },
        { model: Administrator, as: "reviewer", attributes: ["id", "username"] },
        { model: Category, as: "category_ref", attributes: ["name"] },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    // Sample counts derived from gesture_samples, not from the stored columns —
    // one grouped query for the whole page. See getSampleCounts.
    const counts = await getSampleCounts(rows.map((w) => w.id));

    return res.status(200).json({
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      words: rows.map((w) => withSampleCounts(withCategoryName(w), counts)),
    });
  } catch (err) {
    console.error("Get all words error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/words/stats ──────────────────────────────────────
const getWordStats = async (req, res) => {
  try {
    const [total, pending, approved, rejected, active, totalSamples] =
      await Promise.all([
        Word.count(),
        Word.count({ where: { status: "pending" } }),
        Word.count({ where: { status: "approved" } }),
        Word.count({ where: { status: "rejected" } }),
        Word.count({ where: { is_active: true } }),
        // Count the sample rows themselves. Summing words.total_samples reported
        // 1880 against 1039 real rows — see getSampleCounts.
        GestureSample.count(),
      ]);

    // Words approved but not yet active — waiting for next model deploy
    const readyToActivate = await Word.count({
      where: { status: "approved", is_active: false },
    });

    return res.status(200).json({
      total,
      pending,
      approved,
      rejected,
      active,
      ready_to_activate: readyToActivate,
      total_samples: totalSamples || 0,
    });
  } catch (err) {
    console.error("Get word stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/words/:id ────────────────────────────────────────
const getWordById = async (req, res) => {
  try {
    const word = await Word.findOne({
      where: { id: req.params.id },
      include: [
        {
          model: Administrator,
          as: "submitter",
          attributes: ["id", "username"],
        },
        { model: Administrator, as: "reviewer", attributes: ["id", "username"] },
        {
          model: GestureSample,
          as: "samples",
          include: [
            { model: Administrator, as: "submitter", attributes: ["id", "username"] },
          ],
        },
      ],
    });

    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    return res.status(200).json({ word });
  } catch (err) {
    console.error("Get word by id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/words ───────────────────────────────────────────
// Administrator submits a new word — normalizes label before duplicate check
const submitWord = async (req, res) => {
  try {
    const {
      label,
      description,
      sign_type,
      category,
    } = req.body;

    if (!label || !sign_type) {
      return res
        .status(400)
        .json({ message: "Label and sign type are required" });
    }

    const labelError = validateWordLabel(label);
    if (labelError) {
      return res.status(400).json({ message: labelError });
    }

    const normalized = normalizeLabel(label);

    // Check for duplicate normalized label
    const existing = await Word.findOne({
      where: {
        normalized_label: normalized,
        sign_type,
        status: { [Op.in]: ["pending", "approved"] },
      },
    });

    if (existing) {
      return res.status(409).json({
        message: "This word already exists in the system. Only new words can be submitted.",
        existing: true,
      });
    }

    const word = await Word.create({
      label,
      normalized_label: normalized,
      description: description || null,
      sign_type,
      category_id: await resolveCategoryId(category),
      submitted_by: req.user.id,
      status: "pending",
      is_locked: false,
      is_active: false,
      approved_sample_count: 0,
    });

    return res.status(201).json({
      message: "Word submitted successfully. Waiting for admin review.",
      word,
    });
  } catch (err) {
    console.error("Submit word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/words/admin-add ─────────────────────────────────
// Admin manually adds a new word entry to the system
// No gesture samples are required at this point — admin uploads samples separately
const adminAddWord = async (req, res) => {
  try {
    const {
      label,
      description,
      sign_type,
      category,
      filipino_translation,
    } = req.body;

    if (!label || !sign_type) {
      return res
        .status(400)
        .json({ message: "Label and sign type are required" });
    }

    const labelError = validateWordLabel(label);
    if (labelError) {
      return res.status(400).json({ message: labelError });
    }

    const normalized = normalizeLabel(label);

    // Check for duplicate
    const existing = await Word.findOne({
      where: {
        normalized_label: normalized,
        sign_type,
        status: { [Op.in]: ["pending", "approved"] },
      },
    });

    if (existing) {
      return res.status(409).json({
        message: "A word with this label already exists in the system",
        word_id: existing.id,
      });
    }

    // Admin-added words start as approved but inactive —
    // they need gesture samples before they can be activated
    const word = await Word.create({
      label,
      normalized_label: normalized,
      description: description || null,
      sign_type,
      category_id: await resolveCategoryId(category),
      filipino_translation: filipino_translation || null,
      submitted_by: req.user.id,
      status: "approved",
      is_locked: false,
      is_active: false,
      approved_sample_count: 0,
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "added_word",
      target_type: "word",
      target_id: word.id,
      details: `Added word: ${word.label}`,
    });

    return res.status(201).json({
      message:
        "Word added successfully. Upload gesture samples to activate it.",
      word,
    });
  } catch (err) {
    console.error("Admin add word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/words/:id/admin-samples ─────────────────────────
// Admin uploads gesture samples for any word — auto-approved
// Accepts { images: [base64, ...] } JSON — each image becomes one GestureSample
// Bypasses user sample cap — admin can upload as many as needed
// Triggers word activation if threshold is met
const adminUploadSamples = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const { images } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ message: "At least one image is required" });
    }

    // Upload each base64 image to Supabase and create one GestureSample per image
    const samples = [];
    for (let i = 0; i < images.length; i++) {
      const url = await saveImage(images[i], i, "static");
      const sample = await GestureSample.create({
        word_id: word.id,
        submitted_by: req.user.id,
        file_url: url,
        sample_count: 1,
        status: "approved",
        is_validated: true,
      });
      samples.push(sample);
    }

    const newCount = samples.length;

    // Counters are no longer incremented here: the API derives them from
    // gesture_samples (see getSampleCounts), so a blind `+ newCount` could only
    // reintroduce the drift it used to cause. checkAndActivateWord below still
    // recomputes approved_sample_count from the real rows, which is what the
    // activation threshold reads.

    // Re-fetch word with updated counts before activation check
    await word.reload();
    const activated = await checkAndActivateWord(word, req.user.id);

    const remaining = getActivationThreshold() - word.approved_sample_count;

    return res.status(201).json({
      message: activated
        ? `${newCount} sample(s) uploaded and word "${word.label}" is now active`
        : `${newCount} sample(s) uploaded. ${Math.max(0, remaining)} more approved sample(s) needed to activate this word.`,
      count: newCount,
      activated,
      approved_sample_count: word.approved_sample_count,
    });
  } catch (err) {
    console.error("Admin upload samples error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/samples/:sampleId/approve ────────────
const approveSample = async (req, res) => {
  try {
    const sample = await GestureSample.findOne({
      where: { id: req.params.sampleId, word_id: req.params.id },
    });

    if (!sample) {
      return res.status(404).json({ message: "Sample not found" });
    }

    await sample.update({ status: "approved" });

    const word = await Word.findOne({ where: { id: req.params.id } });
    await checkAndActivateWord(word, req.user.id);
    const approvedCount = await getApprovedSampleCount(word.id);

    return res
      .status(200)
      .json({ message: "Sample approved", approved_count: approvedCount });
  } catch (err) {
    console.error("Approve sample error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/samples/:sampleId/reject ─────────────
const rejectSample = async (req, res) => {
  try {
    const sample = await GestureSample.findOne({
      where: { id: req.params.sampleId, word_id: req.params.id },
    });

    if (!sample) {
      return res.status(404).json({ message: "Sample not found" });
    }

    await sample.update({ status: "rejected" });

    return res.status(200).json({ message: "Sample rejected" });
  } catch (err) {
    console.error("Reject sample error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/samples/user/:userId/approve-all ─────
const approveAllSamplesByUser = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) return res.status(404).json({ message: "Word not found" });

    // Count pending samples before approving them
    const userSamplesBefore = await GestureSample.findAll({
      where: { word_id: req.params.id, submitted_by: req.params.userId },
    });
    const approvedBefore = userSamplesBefore.filter((s) => s.status === "approved").length;
    const pendingCount = userSamplesBefore.filter((s) => s.status === "pending").length;

    await GestureSample.update(
      { status: "approved" },
      {
        where: {
          word_id: req.params.id,
          submitted_by: req.params.userId,
          status: "pending",
        },
      },
    );

    await checkAndActivateWord(word, req.user.id);
    const approvedCount = await getApprovedSampleCount(word.id);

    return res.status(200).json({
      message: "All samples from user approved",
      approved_count: approvedCount,
    });
  } catch (err) {
    console.error("Approve all by user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/samples/user/:userId/reject-all ──────
const rejectAllSamplesByUser = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) return res.status(404).json({ message: "Word not found" });

    const userSamplesBefore = await GestureSample.findAll({
      where: { word_id: req.params.id, submitted_by: req.params.userId },
    });
    const existingApproved = userSamplesBefore.filter((s) => s.status === "approved").length;
    const pendingCount = userSamplesBefore.filter((s) => s.status === "pending").length;

    await GestureSample.update(
      { status: "rejected" },
      {
        where: {
          word_id: req.params.id,
          submitted_by: req.params.userId,
          status: "pending",
        },
      },
    );

    return res.status(200).json({ message: "All samples from user rejected" });
  } catch (err) {
    console.error("Reject all by user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/approve-submission ───────────────────
// Approves all pending samples from a specific user and checks activation threshold
const approveSubmission = async (req, res) => {
  try {
    const user_id = req.params.userId || req.body.user_id;
    if (!user_id) {
      return res.status(400).json({ message: "user_id is required" });
    }

    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const userSamples = await GestureSample.findAll({
      where: { word_id: word.id, submitted_by: user_id },
    });

    const totalSubmitted = userSamples.length;
    const approvedBeforeCount = userSamples.filter((s) => s.status === "approved").length;
    const pendingCount = userSamples.filter((s) => s.status === "pending").length;

    // Approve all remaining pending samples from this user
    await GestureSample.update(
      { status: "approved" },
      {
        where: {
          word_id: word.id,
          submitted_by: user_id,
          status: "pending",
        },
      },
    );

    const totalApproved = await getApprovedSampleCount(word.id);
    const activated = await checkAndActivateWord(word, req.user.id);

    await logActivity({
      administrator_id: req.user.id,
      action: "approved_submission",
      target_type: "word",
      target_id: word.id,
      details: `Approved submission for word: ${word.label} — ${totalApproved} total approved samples. Activated: ${activated}`,
    });

    return res.status(200).json({
      message: "Submission approved",
      total_approved: totalApproved,
      is_active: activated,
    });
  } catch (err) {
    console.error("Approve submission error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/reject-submission ────────────────────
const rejectSubmission = async (req, res) => {
  try {
    const user_id = req.params.userId || req.body.user_id;
    if (!user_id) {
      return res.status(400).json({ message: "user_id is required" });
    }
    const { reason } = req.body;

    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const userSamples = await GestureSample.findAll({
      where: { word_id: word.id, submitted_by: user_id },
    });

    await GestureSample.update(
      { status: "rejected" },
      {
        where: {
          word_id: word.id,
          submitted_by: user_id,
          status: "pending",
        },
      },
    );

    const totalApproved = await getApprovedSampleCount(word.id);
    if (totalApproved === 0) {
      await word.update({
        status: "rejected",
        reviewed_by: req.user.id,
        reviewed_at: new Date(),
      });
    }

    await logActivity({
      administrator_id: req.user.id,
      action: "rejected_submission",
      target_type: "word",
      target_id: word.id,
      details: `Rejected submission for word: ${word.label}. Reason: ${reason || "No reason provided"}`,
    });

    return res
      .status(200)
      .json({ message: "Submission rejected and user notified" });
  } catch (err) {
    console.error("Reject submission error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/activate ────────────────────────────
const activateWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    // Activation is gated by the ACTIVATION THRESHOLD (20), not the sample cap
    // (25). These are different things: the cap limits how many samples may be
    // uploaded for a word, the threshold is how many approved samples make it
    // eligible to activate. Using the cap here created a dead zone — a word with
    // 20-24 approved samples was reported "ready to activate" by getWordStats and
    // checkAndActivateWord, while this endpoint refused it.
    const threshold = getActivationThreshold();
    const signerCoverage = await getSignerCoverage(word.id);

    if ((word.approved_sample_count || 0) < threshold) {
      return res.status(400).json({
        message: `Cannot activate: needs ${threshold} approved samples but only has ${word.approved_sample_count || 0}.`,
      });
    }
    if (signerCoverage.qualifiedSigners < MIN_SIGNERS_PER_WORD) {
      return res.status(400).json({
        message:
          `Cannot activate: needs ${MIN_SIGNERS_PER_WORD} signers with at least ` +
          `${MIN_SAMPLES_PER_SIGNER} approved clips each, but only ` +
          `${signerCoverage.qualifiedSigners} signer(s) qualify.`,
        signer_counts: signerCoverage.counts,
      });
    }

    await word.update({ is_active: true });

    await logActivity({
      administrator_id: req.user.id,
      action: "activated_word",
      target_type: "word",
      target_id: word.id,
      details: `Activated word: ${word.label}`,
    });

    return res.status(200).json({ message: "Word activated successfully." });
  } catch (err) {
    console.error("Activate word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/approve ──────────────────────────────
const approveWord = async (req, res) => {
  try {
    const word = await Word.findOne({
      where: { id: req.params.id, status: "pending" },
    });

    if (!word) {
      return res.status(404).json({ message: "Pending word not found" });
    }

    await word.update({
      status: "approved",
      // is_active stays false — word becomes visible in mobile only after model deploy
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "approved_word",
      target_type: "word",
      target_id: word.id,
      details: `Approved word: ${word.label}`,
    });

    return res
      .status(200)
      .json({ message: "Word approved and added to word bank" });
  } catch (err) {
    console.error("Approve word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/reject ───────────────────────────────
const rejectWord = async (req, res) => {
  try {
    const { reason } = req.body;

    const word = await Word.findOne({
      where: { id: req.params.id, status: "pending" },
    });

    if (!word) {
      return res.status(404).json({ message: "Pending word not found" });
    }

    await word.update({
      status: "rejected",
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "rejected_word",
      target_type: "word",
      target_id: word.id,
      details: `Rejected word: ${word.label}. Reason: ${reason || "No reason provided"}`,
    });

    return res.status(200).json({ message: "Word rejected successfully" });
  } catch (err) {
    console.error("Reject word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PUT /api/words/:id ────────────────────────────────────────
const updateWord = async (req, res) => {
  try {
    const {
      label,
      description,
      sign_type,
      category,
      filipino_translation,
    } = req.body;

    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const updatedLabel = label || word.label;
    const updatedNormalized = normalizeLabel(updatedLabel);
    const updatedSignType = sign_type || word.sign_type;

    const labelError = validateWordLabel(updatedLabel);
    if (labelError) {
      return res.status(400).json({ message: labelError });
    }

    // Renaming onto an existing label used to be allowed: adminAddWord guards
    // this with a 409 but the update path did not, so two words could end up
    // sharing a normalized_label. Training then produces two classes with the
    // same name, which corrupts the dataset rather than just the display.
    //
    // Skipped when the normalized label is unchanged, so re-saving a word with
    // its own label (or only a casing/punctuation tweak) is not a false positive.
    if (updatedNormalized !== word.normalized_label) {
      const duplicate = await Word.findOne({
        where: {
          id: { [Op.ne]: word.id },
          normalized_label: updatedNormalized,
          sign_type: updatedSignType,
          status: { [Op.in]: ["pending", "approved"] },
        },
      });
      if (duplicate) {
        return res.status(409).json({
          message: "A word with this label already exists in the system",
          word_id: duplicate.id,
        });
      }
    }

    // Only touch the category when the form supplied one; a blank/absent value
    // leaves the existing link intact.
    const nextCategoryId =
      category !== undefined && category !== null && String(category).trim() !== ""
        ? await resolveCategoryId(category)
        : word.category_id;

    await word.update({
      label: updatedLabel,
      normalized_label: updatedNormalized,
      description: description ?? word.description,
      sign_type: updatedSignType,
      category_id: nextCategoryId,
      filipino_translation:
        filipino_translation !== undefined
          ? filipino_translation
          : word.filipino_translation,
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "updated_word",
      target_type: "word",
      target_id: word.id,
      details: `Updated word: ${word.label}`,
    });

    return res.status(200).json({ message: "Word updated successfully" });
  } catch (err) {
    console.error("Update word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/words/:id ─────────────────────────────────────
const deleteWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const deletedWordId = word.id;
    const deletedWordLabel = word.label;

    await word.destroy();

    await logActivity({
      administrator_id: req.user.id,
      action: "deleted_word",
      target_type: "word",
      target_id: deletedWordId,
      details: `Deleted word: ${deletedWordLabel} — all associated gesture samples and word bank entry removed`,
    });

    return res.status(200).json({
      message:
        "Word deleted successfully. All associated gesture samples and word bank entry have been removed.",
    });
  } catch (err) {
    console.error("Delete word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/words/:id/samples ────────────────────────────────
const getSamples = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const samples = await GestureSample.findAll({
      where: { word_id: word.id },
      include: [
        { model: Administrator, as: "submitter", attributes: ["id", "username"] },
      ],
      order: [["created_at", "DESC"]],
    });

    console.log(`GET /api/words/${req.params.id}/samples`);
    console.log(`  Word: ${word.label}`);
    console.log(`  Total samples found: ${samples.length}`);
    if (samples.length > 0) {
      console.log(`  Sample types:`, samples.map(s => ({
        id: s.id,
        status: s.status,
        has_sequence: !!s.sequence,
        sequence_length: s.sequence?.length || 0,
        file_url: s.file_url?.substring(0, 50)
      })));
    }

    return res.status(200).json({
      samples,
      // Derived from the rows this handler already loaded rather than from the
      // stored columns, which drift on delete — see getSampleCounts.
      total_samples: samples.length,
      approved_sample_count: samples.filter((s) => s.status === "approved").length,
      is_active: word.is_active,
      activation_threshold: getActivationThreshold(),
      sample_cap: getSampleCap(word),
    });
  } catch (err) {
    console.error("Get samples error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/words/:id/user-sample-count ─────────────────────
const getUserSampleCountForWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const count = await getUserSampleCount(req.user.id, req.params.id);
    const cap = getSampleCap(word);

    return res.status(200).json({
      count,
      remaining: cap - count,
      limit_reached: count >= cap,
      cap,
    });
  } catch (err) {
    console.error("Get user sample count error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/samples/approve-all ─────────────────
// Approve ALL pending samples for a word regardless of submitter
const approveAllSamplesForWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    // Capture pending counts per submitter BEFORE the bulk update
    const pendingSamples = await GestureSample.findAll({
      where: { word_id: word.id, status: "pending" },
      attributes: ["submitted_by"],
    });
    const submitterCounts = {};
    for (const s of pendingSamples) {
      if (s.submitted_by)
        submitterCounts[s.submitted_by] = (submitterCounts[s.submitted_by] || 0) + 1;
    }

    const [count] = await GestureSample.update(
      { status: "approved" },
      { where: { word_id: word.id, status: "pending" } },
    );

    const totalApproved = await getApprovedSampleCount(word.id);
    const activated = await checkAndActivateWord(word, req.user.id);

    await word.update({ approved_sample_count: totalApproved });

    await logActivity({
      administrator_id: req.user.id,
      action: "approved_word",
      target_type: "word",
      target_id: word.id,
      details: `Approved all ${count} pending samples for word: ${word.label}. Activated: ${activated}`,
    });

    return res.status(200).json({
      message: `${count} samples approved`,
      total_approved: totalApproved,
      is_active: activated,
    });
  } catch (err) {
    console.error("Approve all samples for word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/words/:id/samples ────────────────────────────
// Permanently delete every gesture sample for a word, keeping the word itself.
//
// This existed only as hand-written SQL before. Clearing a word's training data
// is a normal part of the dataset workflow — a category is re-recorded because
// the takes were inconsistent, or a batch is found to be mislabelled — and the
// only alternatives were deleting the whole word (losing its id, so a re-import
// renumbers and the label->id mapping shifts) or running DELETE by hand against
// production.
//
// Deliberately NOT touched here:
//   * word.status    — an admin decision, not a consequence of having no clips.
//   * word.is_active — set only by the model-deploy path, which reconciles
//     against the deployed model's trained_word_ids. A deployed model still
//     genuinely recognises this word; clearing the rows we would retrain FROM
//     does not change what the shipped .tflite can do. Flipping it here would
//     hide a word the app can still predict.
//
// Requires ?confirm=<label> matching the word exactly. The guard is the point:
// this is unrecoverable, the row count is not visible from the URL, and an
// id-only call is too easy to fire at the wrong word.
const deleteAllSamplesForWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const confirm = req.query.confirm ?? req.body?.confirm;
    if (confirm !== word.label) {
      return res.status(400).json({
        message:
          `Confirmation required. Pass confirm="${word.label}" to delete every ` +
          `sample for this word. This cannot be undone.`,
        word_id: word.id,
        label: word.label,
      });
    }

    const total = await GestureSample.count({ where: { word_id: word.id } });
    if (total === 0) {
      return res.status(200).json({
        message: `"${word.label}" already has no samples.`,
        deleted: 0,
      });
    }

    const deleted = await GestureSample.destroy({ where: { word_id: word.id } });

    // Keep the stored counter consistent with the rows. The API derives
    // total_samples at read time (see getSampleCounts), but approved_sample_count
    // is read back by checkAndActivateWord, so it must not be left stale.
    await word.update({ total_samples: 0, approved_sample_count: 0 });

    await logActivity({
      administrator_id: req.user.id,
      action: "deleted_word_samples",
      target_type: "word",
      target_id: word.id,
      details:
        `Deleted all ${deleted} gesture sample(s) for word: ${word.label}. ` +
        `The word row was kept; is_active and status were left unchanged.`,
    });

    return res.status(200).json({
      message: `Deleted all ${deleted} sample(s) for "${word.label}".`,
      word_id: word.id,
      label: word.label,
      deleted,
    });
  } catch (err) {
    console.error("Delete all samples error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/samples/reject-all ──────────────────
// Reject ALL pending samples for a word regardless of submitter
const rejectAllSamplesForWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    // Capture pending counts per submitter BEFORE the bulk update
    const pendingSamples = await GestureSample.findAll({
      where: { word_id: word.id, status: "pending" },
      attributes: ["submitted_by"],
    });
    const submitterCounts = {};
    for (const s of pendingSamples) {
      if (s.submitted_by)
        submitterCounts[s.submitted_by] = (submitterCounts[s.submitted_by] || 0) + 1;
    }

    const [count] = await GestureSample.update(
      { status: "rejected" },
      { where: { word_id: word.id, status: "pending" } },
    );

    const totalApproved = await getApprovedSampleCount(word.id);
    if (totalApproved === 0) {
      await word.update({
        status: "rejected",
        reviewed_by: req.user.id,
        reviewed_at: new Date(),
      });
    }

    await logActivity({
      administrator_id: req.user.id,
      action: "rejected_word",
      target_type: "word",
      target_id: word.id,
      details: `Rejected all ${count} pending samples for word: ${word.label}`,
    });

    return res.status(200).json({ message: `${count} samples rejected` });
  } catch (err) {
    console.error("Reject all samples for word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/words/:id/motion-sequences ───────────────────────
// Returns motion gesture samples grouped by sequence with frame URLs
const getMotionSequences = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const samples = await GestureSample.findAll({
      where: { word_id: word.id, status: "approved" },
      include: [
        { model: Administrator, as: "submitter", attributes: ["id", "username"] },
      ],
      order: [["created_at", "ASC"]],
    });

    console.log(`GET /api/words/${req.params.id}/motion-sequences`);
    console.log(`  Word: ${word.label}`);
    console.log(`  Found ${samples.length} approved samples`);
    if (samples.length > 0) {
      console.log(`  Samples with sequence data:`, samples.filter(s => s.sequence && s.sequence.length > 0).length);
    }

    const sequences = [];

    for (const sample of samples) {
      if (sample.sequence && Array.isArray(sample.sequence)) {
        const frameCount = sample.sequence.length;
        let frameUrls = [];

        // Split file_url by '|' to get individual frame image URLs
        if (sample.file_url && sample.file_url.includes("|")) {
          frameUrls = sample.file_url.split("|");
        } else if (sample.file_url) {
          // Single URL - use for all frames as fallback
          frameUrls = Array(frameCount).fill(sample.file_url);
        }

        // Build frame objects
        const frames = [];
        for (let i = 0; i < frameCount; i++) {
          frames.push({
            frame_index: i,
            landmarks: sample.sequence[i],
            image_url: frameUrls[i] || null,
          });
        }

        sequences.push({
          sequence_id: `seq_${sample.id}`,
          sample_id: sample.id,
          submitter_id: sample.submitter?.id || null,
          submitter_name: sample.submitter?.username || "Admin",
          frame_count: frames.length,
          frames: frames,
          created_at: sample.created_at,
        });
      }
    }

    return res.status(200).json({
      sequences,
      total_sequences: sequences.length,
    });
  } catch (err) {
    console.error("Get motion sequences error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/words/:id/generate-video ────────────────────────
// Generates a video from motion sequence frames using ffmpeg
const generateVideo = async (req, res) => {
  try {
    const ffmpegPath = require("ffmpeg-static");
    const ffmpeg = require("fluent-ffmpeg");

    ffmpeg.setFfmpegPath(ffmpegPath);

    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const { sequence_ids } = req.body;
    if (
      !sequence_ids ||
      !Array.isArray(sequence_ids) ||
      sequence_ids.length === 0
    ) {
      return res.status(400).json({ message: "sequence_ids is required" });
    }

    // Get the samples for these sequences
    const samples = await GestureSample.findAll({
      where: {
        word_id: word.id,
        id: sequence_ids,
        status: "approved",
      },
      order: [["created_at", "ASC"]],
    });

    if (samples.length === 0) {
      return res.status(400).json({ message: "No valid samples found" });
    }

    // Create temp directory for frames
    const tempDir = path.join(UPLOADS_DIR, "temp", `video_${Date.now()}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const framePaths = [];
    let frameIndex = 0;

    // Process each sample - each sample contains a sequence of frames
    for (const sample of samples) {
      if (sample.sequence && Array.isArray(sample.sequence)) {
        // Parse file_url to extract individual frame URLs (pipe-separated)
        let frameUrls = [];
        if (sample.file_url && sample.file_url.includes("|")) {
          frameUrls = sample.file_url.split("|");
        } else if (sample.file_url) {
          // Single URL - replicate for all frames in sequence
          frameUrls = Array(sample.sequence.length).fill(sample.file_url);
        }

        // Process each frame in the sequence
        for (let i = 0; i < sample.sequence.length; i++) {
          const frameUrl = frameUrls[i] || sample.file_url;
          if (!frameUrl) continue;

          const ext = path.extname(frameUrl.split("|")[0]) || ".jpg";
          const framePath = path.join(
            tempDir,
            `frame_${frameIndex.toString().padStart(4, "0")}${ext}`,
          );

          // If it's a local file, copy it; otherwise download from URL
          if (frameUrl.startsWith("/")) {
            const sourcePath = path.join(__dirname, "../..", frameUrl.slice(1));
            if (fs.existsSync(sourcePath)) {
              fs.copyFileSync(sourcePath, framePath);
              framePaths.push(framePath);
              frameIndex++;
            }
          } else {
            // Download from URL
            try {
              const https = require("https");
              const file = fs.createWriteStream(framePath);
              await new Promise((resolve, reject) => {
                https
                  .get(frameUrl, (response) => {
                    response.pipe(file);
                    file.on("finish", () => {
                      file.close();
                      framePaths.push(framePath);
                      frameIndex++;
                      resolve();
                    });
                  })
                  .on("error", (err) => {
                    fs.unlink(framePath, () => {});
                    reject(err);
                  });
              });
            } catch (downloadErr) {
              console.error(
                "Failed to download frame:",
                frameUrl,
                downloadErr.message,
              );
            }
          }
        }
      } else if (sample.file_url) {
        // Fallback: sample without sequence data, treat as single frame
        const ext = path.extname(sample.file_url) || ".jpg";
        const framePath = path.join(
          tempDir,
          `frame_${frameIndex.toString().padStart(4, "0")}${ext}`,
        );

        if (sample.file_url.startsWith("/")) {
          const sourcePath = path.join(__dirname, "../..", sample.file_url.slice(1));
          if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, framePath);
            framePaths.push(framePath);
            frameIndex++;
          }
        } else {
          try {
            const https = require("https");
            const file = fs.createWriteStream(framePath);
            await new Promise((resolve, reject) => {
              https
                .get(sample.file_url, (response) => {
                  response.pipe(file);
                  file.on("finish", () => {
                    file.close();
                    framePaths.push(framePath);
                    frameIndex++;
                    resolve();
                  });
                })
                .on("error", (err) => {
                  fs.unlink(framePath, () => {});
                  reject(err);
                });
            });
          } catch (downloadErr) {
            console.error(
              "Failed to download frame:",
              sample.file_url,
              downloadErr.message,
            );
          }
        }
      }
    }

    if (framePaths.length === 0) {
      console.error("generateVideo: No frames found after processing");
      console.error("  Temp dir:", tempDir);
      console.error("  __dirname:", __dirname);
      for (const sample of samples) {
        if (sample.file_url && !sample.file_url.startsWith("landmark_direct_")) {
          const urls = sample.file_url.split("|");
          for (const url of urls) {
            const expectedPath = path.join(__dirname, "../..", url.startsWith("/") ? url.slice(1) : url);
            console.error("  Looking for:", expectedPath);
            console.error("  Exists:", fs.existsSync(expectedPath));
          }
        }
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      return res.status(400).json({ message: "No image frames found" });
    }

    // Generate video using ffmpeg-static binary with concat demuxer
    const timestamp = Date.now();
    const outputPath = path.join(
      UPLOADS_DIR,
      `motion_${word.id}_${timestamp}.mp4`,
    );

    // Use ffmpeg-static binary directly via execFile
    const { execFile } = require("child_process");
    const ffmpegBin = require("ffmpeg-static");

    // Create concat list file with forward slashes (ffmpeg requires this on Windows)
    const fileListPath = path.join(tempDir, "frames.txt");
    const fileListContent = framePaths
      .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\\\''")}'`)
      .join("\r\n");
    fs.writeFileSync(fileListPath, fileListContent);

    console.log(`Encoding ${framePaths.length} frames to ${outputPath}`);

    await new Promise((resolve, reject) => {
      execFile(
        ffmpegBin,
        [
          "-y",
          "-f", "concat",
          "-safe", "0",
          "-i", fileListPath,
          "-framerate", "15",
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-vf", "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2",
          outputPath,
        ],
        (err, stdout, stderr) => {
          if (err) {
            console.error("FFmpeg stderr:", stderr);
            reject(err);
          } else {
            console.log("FFmpeg stdout:", stdout);
            resolve();
          }
        },
      );
    });

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Return the video URL
    const videoUrl = `/uploads/samples/motion_${word.id}_${timestamp}.mp4`;

    return res.status(200).json({
      message: "Video generated successfully",
      video_url: videoUrl,
    });
  } catch (err) {
    console.error("Generate video error:", err);
    return res.status(500).json({ message: "Server error: " + err.message });
  }
};

// ── PATCH /api/words/:id/set-thumbnail ───────────────────────
async function setThumbnail(req, res) {
  try {
    const word = await Word.findByPk(req.params.id);
    if (!word) return res.status(404).json({ message: "Word not found" });

    const { thumbnail_url } = req.body;
    if (!thumbnail_url)
      return res.status(400).json({ message: "thumbnail_url is required" });

    await word.update({ thumbnail_url });

    return res
      .status(200)
      .json({ message: "Thumbnail updated", thumbnail_url });
  } catch (err) {
    console.error("Set thumbnail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ── PATCH /api/words/:id/set-video ───────────────────────────
async function setVideo(req, res) {
  try {
    const word = await Word.findByPk(req.params.id);
    if (!word) return res.status(404).json({ message: "Word not found" });

    let videoUrl = req.body.video_url || null;

    if (!videoUrl && req.body.video_base64) {
      // Uploading a new file replaces any existing demo video (one per word)
      videoUrl = await saveVideo(
        Buffer.from(req.body.video_base64, "base64"),
        req.body.video_ext,
        word.id,
      );
    }

    if (!videoUrl)
      return res
        .status(400)
        .json({ message: "Either video_url or video_base64 is required" });

    await word.update({ video_url: videoUrl });

    await logActivity({
      administrator_id: req.user.id,
      action: "set_word_video",
      target_type: "word",
      target_id: word.id,
      details: `Set demo video for word: ${word.label}`,
    });

    return res
      .status(200)
      .json({ message: "Video updated", video_url: videoUrl });
  } catch (err) {
    console.error("Set video error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

const checkWordExists = async (req, res) => {
  try {
    const { label, sign_type = "FSL" } = req.query;
    if (!label) return res.status(400).json({ message: "label is required" });
    const normalized = normalizeLabel(label);
    const existing = await Word.findOne({
      where: {
        normalized_label: normalized,
        sign_type,
        status: { [Op.in]: ["pending", "approved"] },
      },
    });
    return res.json({ exists: !!existing });
  } catch (err) {
    console.error("Check word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/words/:id/upload-videos ────────────────────────
// Admin uploads video files — backend forwards each to ML service for
// MediaPipe landmark extraction, then stores the resulting GestureSample rows
const uploadVideos = async (req, res) => {
  try {
    const word = await Word.findByPk(req.params.id);
    if (!word) return res.status(404).json({ message: "Word not found" });

    // Files are attached by multer middleware before this handler runs
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "At least one file is required" });
    }

    // Who signed these clips, for signer-grouped cross-validation.
    //
    // Cannot be derived from submitted_by — that is the uploading ADMIN, identical
    // across every signer (1 for 1664 of 1726 existing rows). Without a real grouping
    // key, cross-validation puts the same signer in both train and test and the
    // resulting accuracy overstates performance for a new user.
    //
    // A generated ID per upload batch would make repeated batches from one person
    // look like several independent signers and could falsely satisfy the diversity
    // gate. Require the real signer ID and normalize its spelling across batches.
    const providedSessionId = (req.body?.session_id || "").trim().toLowerCase();
    if (!providedSessionId) {
      return res.status(400).json({
        message: "Signer ID is required. Reuse the same ID for this person across every word and batch.",
      });
    }
    if (providedSessionId.length > 100) {
      return res.status(400).json({ message: "Signer/session ID must be at most 100 characters." });
    }
    const sessionId = providedSessionId;

    // Refuse a second concurrent batch for the same word. The UI disables its
    // upload button while a job is live, but the server cannot rely on that —
    // two batches would race on the same counters below.
    const live = await UploadJob.findOne({
      where: { word_id: word.id, status: "processing" },
    });
    if (live) {
      return res.status(409).json({
        message: "An upload is already in progress for this word.",
        job: live,
      });
    }

    const job = await UploadJob.create({
      word_id: word.id,
      started_by: req.user.id,
      session_id: sessionId,
      status: "processing",
      total_count: files.length,
    });

    // Answer before doing any extraction. 50 clips x 60s of MediaPipe is up to 50
    // minutes, and Render's proxy closes the request at ~30 seconds — the same wall
    // trainModel returns 202 to avoid. The client polls the job row instead, so the
    // batch also survives the admin closing the modal or reloading the page.
    res.status(202).json({
      message: "Upload started. Poll /api/words/upload-jobs/:jobId for progress.",
      job,
    });

    // Detached: the response is already sent, so nothing here may touch `res`.
    //
    // Holds every multer buffer (memory storage, up to 50 x 100MB) alive for the
    // life of the batch. Acceptable at current single-admin usage; moving to disk
    // storage or a real queue is the fix if batches grow.
    (async () => {
      const results = [];
      let successCount = 0;
      let failCount = 0;

      try {
        for (const file of files) {
          const result = await extractAndStoreSample(
            word,
            file.buffer,
            file.originalname,
            file.mimetype,
            req.user.id,
            null,
            sessionId,
          );
          results.push(result);
          if (result.status === "ok") successCount++;
          else failCount++;

          // Per-clip so the client shows real progress. Best-effort: a failed
          // progress write must not abort a batch that is otherwise fine.
          await job
            .update({
              processed_count: results.length,
              success_count: successCount,
              fail_count: failCount,
            })
            .catch(() => {});
        }

        // Surface the outcome server-side. A wholly-failed batch is otherwise
        // indistinguishable from a successful one in the terminal.
        if (failCount > 0) {
          console.warn(
            `[uploadVideos] "${word.label}": ${successCount} stored, ${failCount} FAILED ` +
              `(per-clip reasons logged above)`,
          );
        } else {
          console.log(`[uploadVideos] "${word.label}": ${successCount} stored`);
        }

        // total_samples is no longer incremented — it is derived from
        // gesture_samples at read time (see getSampleCounts). approved_sample_count
        // is still written from a real COUNT because checkAndActivateWord reads it.
        const newApproved = await getApprovedSampleCount(word.id);
        await word.update({ approved_sample_count: newApproved });
        await word.reload();
        await checkAndActivateWord(word, req.user.id);

        await logActivity({
          administrator_id: req.user.id,
          action: "uploaded_samples",
          target_type: "word",
          target_id: word.id,
          details: `Uploaded gesture samples for word: ${word.label} — ${successCount} processed, ${failCount} failed/skipped`,
        });

        await job.update({
          status: "completed",
          results,
          processed_count: results.length,
          success_count: successCount,
          fail_count: failCount,
          finished_at: new Date(),
        });
      } catch (err) {
        // Only a batch-level failure lands here — an unreachable ML service, a DB
        // error. Individual clip failures are recorded per-clip and still complete
        // the job. Partial results are kept: those clips really were stored.
        console.error(`[uploadVideos] job ${job.id} FAILED:`, err);
        await job
          .update({
            status: "failed",
            error: err.message || "Unknown upload error",
            results,
            finished_at: new Date(),
          })
          .catch(() => {});
      }
    })();
  } catch (err) {
    console.error("Upload videos error:", err);
    // The 202 may already have been sent, in which case the failure belongs on the
    // job row (handled above) and the headers are gone.
    if (res.headersSent) return;
    return res.status(500).json({ message: "Server error" });
  }
};

// Poll target for a single upload batch. Mirrors modelController.getModelStatus.
const getUploadJob = async (req, res) => {
  try {
    const job = await UploadJob.findByPk(req.params.jobId);
    if (!job) return res.status(404).json({ message: "Upload job not found" });
    return res.json({ job });
  } catch (err) {
    console.error("Get upload job error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// The live batch for a word, if any. Lets the admin UI re-adopt a job that is
// still running after a reload or navigating back to the page — component state
// does not survive either, but this row does.
const getActiveUploadJob = async (req, res) => {
  try {
    const job = await UploadJob.findOne({
      where: { word_id: req.params.id, status: "processing" },
      order: [["created_at", "DESC"]],
    });
    return res.json({ job: job || null });
  } catch (err) {
    console.error("Get active upload job error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getAllWords,
  getWordStats,
  getWordById,
  checkWordExists,
  submitWord,
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
  deleteAllSamplesForWord,
  approveSubmission,
  rejectSubmission,
  activateWord,
  getUserSampleCountForWord,
  setThumbnail,
  setVideo,
  uploadVideos,
  getUploadJob,
  getActiveUploadJob,
  // Shared helpers reused by the FSL-105 bulk importer
  extractAndStoreSample,
  normalizeLabel,
  checkAndActivateWord,
  getApprovedSampleCount,
};
