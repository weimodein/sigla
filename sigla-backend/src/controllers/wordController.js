const { Op } = require("sequelize");
const fs = require("fs");
const path = require("path");
const {
  Word,
  GestureSample,
  WordBank,
  User,
  Notification,
  // ActivityLog,
} = require("../models/index.js");

const UPLOADS_DIR = path.join(__dirname, "../../uploads/samples");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Sample caps ───────────────────────────────────────────────
// Per-user maximums: how many samples ONE user can contribute to a single word.
const PER_USER_CAP = { static: 100, motion: 75 };

// Default total caps across ALL users (used when admin has not set sample_limit).
const DEFAULT_SAMPLE_CAP = { static: 100, motion: 150 };

// Activation threshold: approved samples needed before a word is eligible for deploy.
const ACTIVATION_THRESHOLD = { static: 100, motion: 150 };

// ── Helper: normalize word label ──────────────────────────────
const normalizeLabel = (label) =>
  label
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();

// ── Helper: total cap for a word (admin-set or default) ───────
const getSampleCap = (gestureTypeOrWord) => {
  if (gestureTypeOrWord && typeof gestureTypeOrWord === "object") {
    const word = gestureTypeOrWord;
    if (word.sample_limit != null) return word.sample_limit;
    return DEFAULT_SAMPLE_CAP[word.gesture_type] || DEFAULT_SAMPLE_CAP.static;
  }
  return DEFAULT_SAMPLE_CAP[gestureTypeOrWord] || DEFAULT_SAMPLE_CAP.static;
};

// ── Helper: per-user cap based on gesture type ────────────────
const getPerUserCap = (gestureType) =>
  PER_USER_CAP[gestureType] || PER_USER_CAP.static;

// ── Helper: get activation threshold based on gesture_type ────
const getActivationThreshold = (gestureType) =>
  ACTIVATION_THRESHOLD[gestureType] || ACTIVATION_THRESHOLD.static;

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

// ── Helper: send submission result notification ───────────────
const sendSubmissionNotification = async (
  userId,
  wordLabel,
  approved,
  total,
  maxLimit,
) => {
  let title, message;

  if (approved === 0) {
    // All rejected
    title = "Submission Rejected";
    message = `None of your submitted samples for "${wordLabel}" were approved. Please review the terms and conditions and the gesture collection instructions before submitting again.`;
  } else if (approved === total) {
    // All approved
    title = "Submission Approved";
    message = `All ${approved} of your submitted samples for "${wordLabel}" have been accepted. Your contribution has been successfully added to the system.`;
  } else {
    // Partial
    const remaining = maxLimit - approved;
    title = "Submission Partially Approved";
    message = `${approved} out of ${total} submitted samples for "${wordLabel}" were approved. You may still contribute up to ${remaining} more samples for this word.`;
  }

  await Notification.create({
    user_id: userId,
    title,
    message,
    type: "submission_result",
    is_read: false,
    delivered: false,
  });
};

// ── Helper: update sample count; mark word approved when threshold met ────
// Words are NOT activated here — activation only happens on model deploy.
const checkAndActivateWord = async (word, reviewerId = null) => {
  const threshold = getActivationThreshold(word.gesture_type || "static");
  const approvedCount = await getApprovedSampleCount(word.id);

  const reachedThreshold = approvedCount >= threshold;

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

// ── Helper: save a base64 image to disk, return its public URL path
const saveImage = (base64, index) => {
  try {
    const filename = `sample_${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${index}.jpg`;
    const filepath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(base64, "base64"));
    return `/uploads/samples/${filename}`;
  } catch (e) {
    return `landmark_direct_${Date.now()}_${index}`;
  }
};

// ── GET /api/words ────────────────────────────────────────────
const getAllWords = async (req, res) => {
  try {
    const {
      status,
      sign_type,
      category,
      gesture_type,
      search,
      page = 1,
      limit = 10,
    } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (sign_type) where.sign_type = sign_type;
    if (category) where.category = category;
    if (gesture_type) where.gesture_type = gesture_type;
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
          model: User,
          as: "submitter",
          attributes: ["id", "username"],
        },
        { model: User, as: "reviewer", attributes: ["id", "username"] },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      words: rows,
    });
  } catch (err) {
    console.error("Get all words error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/words/stats ──────────────────────────────────────
const getWordStats = async (req, res) => {
  try {
    const [total, pending, approved, rejected, active, locked, totalSamples] =
      await Promise.all([
        Word.count(),
        Word.count({ where: { status: "pending" } }),
        Word.count({ where: { status: "approved" } }),
        Word.count({ where: { status: "rejected" } }),
        Word.count({ where: { is_active: true } }),
        Word.count({ where: { is_locked: true } }),
        Word.sum("total_samples"),
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
      locked,
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
          model: User,
          as: "submitter",
          attributes: ["id", "username"],
        },
        { model: User, as: "reviewer", attributes: ["id", "username"] },
        {
          model: GestureSample,
          as: "samples",
          include: [
            { model: User, as: "submitter", attributes: ["id", "username"] },
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
// User submits a new word — normalizes label before duplicate check
const submitWord = async (req, res) => {
  try {
    const {
      label,
      description,
      hands_count,
      sign_type,
      category,
      gesture_type,
    } = req.body;

    if (!label || !sign_type) {
      return res
        .status(400)
        .json({ message: "Label and sign type are required" });
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
      const totalCap = getSampleCap(existing);
      const perUserCap = getPerUserCap(existing.gesture_type || "static");

      // Use live DB counts — stored counters can be stale
      const [totalSamples, userSamples] = await Promise.all([
        GestureSample.count({ where: { word_id: existing.id } }),
        getUserSampleCount(req.user.id, existing.id),
      ]);

      return res.status(409).json({
        message: "This word already exists or is pending approval",
        word_id: existing.id,
        existing: true,
        label: existing.label,
        gesture_type: existing.gesture_type || "static",
        hands_count: existing.hands_count || 1,
        is_locked: !!existing.is_locked,
        cap_reached: totalSamples >= totalCap,
        user_cap_reached: userSamples >= perUserCap,
        cap: totalCap,
        per_user_cap: perUserCap,
        total_samples: totalSamples,
        user_samples: userSamples,
        remaining_for_user: Math.max(
          0,
          Math.min(perUserCap - userSamples, totalCap - totalSamples),
        ),
      });
    }

    const word = await Word.create({
      label,
      normalized_label: normalized,
      description: description || null,
      hands_count: hands_count || 1,
      sign_type,
      gesture_type: gesture_type || "static",
      category: category || "additional words",
      submitted_by: req.user.id,
      status: "pending",
      is_locked: false,
      is_active: false,
      approved_sample_count: 0,
    });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "submitted_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Submitted word: ${label} (${sign_type}, ${gesture_type || "static"})`,
    // });

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
      hands_count,
      sign_type,
      category,
      gesture_type,
      filipino_translation,
    } = req.body;

    if (!label || !sign_type) {
      return res
        .status(400)
        .json({ message: "Label and sign type are required" });
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
      hands_count: hands_count || 1,
      sign_type,
      gesture_type: gesture_type || "static",
      category: category || "additional words",
      filipino_translation: filipino_translation || null,
      submitted_by: req.user.id,
      status: "approved",
      is_locked: false,
      is_active: false,
      approved_sample_count: 0,
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "admin_added_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Admin manually added word: ${label} (${sign_type}, ${gesture_type || "static"})`,
    // });

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
// The same MediaPipe landmark extraction pipeline is triggered via the ML service
// Bypasses user sample cap — admin can upload as many as needed
// Triggers word activation if threshold is met
const adminUploadSamples = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });

    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const { file_url, landmark_url, sample_count } = req.body;

    if (!file_url) {
      return res.status(400).json({ message: "File URL is required" });
    }

    const newCount = parseInt(sample_count) || 1;

    // Inside uploadSamples, after validating the sample cap, change the create call:
    const sample = await GestureSample.create({
      word_id: word.id,
      submitted_by: req.user.id,
      file_url,
      landmark_url: landmark_url || null,
      sample_count: newCount,
      status: "pending",
      is_validated: true,
      // NEW: store landmarks or sequence
      landmarks:
        word.gesture_type === "static" ? req.body.landmarks || null : null,
      sequence:
        word.gesture_type === "motion" ? req.body.sequence || null : null,
    });

    // Update total samples count
    await word.update({
      total_samples: (word.total_samples || 0) + newCount,
    });

    // Check if word should now be activated
    const activated = await checkAndActivateWord(word, req.user.id);

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "admin_uploaded_samples",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Admin uploaded ${newCount} gesture sample(s) for word: ${word.label}. Word activated: ${activated}`,
    // });

    return res.status(201).json({
      message: activated
        ? `Samples uploaded and word "${word.label}" is now active`
        : `Samples uploaded. ${getActivationThreshold(word.gesture_type || "static") - (word.approved_sample_count + newCount)} more approved samples needed to activate this word.`,
      sample,
      activated,
      approved_sample_count: word.approved_sample_count + newCount,
    });
  } catch (err) {
    console.error("Admin upload samples error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/words/:id/samples ───────────────────────────────
// User uploads gesture samples — enforces per-user per-word cap based on gesture_type
const uploadSamples = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });

    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    if (word.is_locked) {
      return res.status(403).json({
        message:
          "Submissions for this word are currently locked by the administrator.",
        locked: true,
      });
    }

    const {
      file_url,
      landmark_url,
      sample_count,
      landmarks,
      sequence,
      images,
    } = req.body;

    // DEBUG: Log incoming motion gesture data
    console.log("=== UPLOAD SAMPLES DEBUG ===");
    console.log("word_id:", req.params.id);
    console.log("gesture_type:", word.gesture_type);
    console.log("sample_count from client:", sample_count);
    console.log("landmarks array:", Array.isArray(landmarks), landmarks ? landmarks.length : "N/A");
    console.log("sequence array:", Array.isArray(sequence), sequence ? sequence.length : "N/A");
    console.log("images array:", Array.isArray(images), images ? (Array.isArray(images[0]) ? "nested (motion)" : "flat (static)") : "N/A");
    if (sequence && Array.isArray(sequence)) {
      console.log("sequence[0] type:", typeof sequence[0], Array.isArray(sequence[0]) ? "(is array)" : "(not array)");
      console.log("sequence structure:", sequence.length > 0 ? (Array.isArray(sequence[0]) ? `Batch of ${sequence.length} sequences` : `Single sequence with ${sequence.length} frames`) : "empty");
    }

    // Either a file_url or direct landmark data must be provided
    const hasLandmarkData =
      (landmarks && Array.isArray(landmarks) && landmarks.length > 0) ||
      (sequence && Array.isArray(sequence) && sequence.length > 0);

    if (!file_url && !hasLandmarkData) {
      console.log("ERROR: No landmark data provided");
      return res.status(400).json({
        message:
          "Either file_url or landmark data (landmarks/sequence) is required",
      });
    }

    // For motion gestures: sample_count is the number of sequences in the batch
    // sequence structure: List<List<List<Float>>> = batch of sequences, each sequence has frames
    const isMotionBatch = sequence && Array.isArray(sequence) && sequence.length > 0 && Array.isArray(sequence[0]) && Array.isArray(sequence[0][0]);

    // Derive sample count: if landmark data provided directly, count from the array
    let newCount = parseInt(sample_count) || 0;
    if (newCount <= 0) {
      if (isMotionBatch) {
        // Motion batch: each element is a complete sequence
        newCount = sequence.length;
      } else if (landmarks) {
        // Static batch: each element is a single landmark
        newCount = landmarks.length;
      } else if (sequence) {
        // Single sequence (fallback): count frames
        newCount = sequence.length;
      }
    }

    if (newCount <= 0) {
      return res
        .status(400)
        .json({ message: "sample_count must be greater than 0" });
    }

    const totalCap = getSampleCap(word);
    const perUserCap = getPerUserCap(word.gesture_type || "static");

    // Use live DB counts — word.total_samples can be stale
    const [totalSamples, userTotal] = await Promise.all([
      GestureSample.count({ where: { word_id: word.id } }),
      getUserSampleCount(req.user.id, word.id),
    ]);

    // ── 1. Total cap across all users ─────────────────────────
    if (totalSamples >= totalCap) {
      return res.status(400).json({
        message: `The sample limit of ${totalCap} for "${word.label}" has already been reached (${totalSamples}/${totalCap}). No more submissions are accepted for this word.`,
        limit_reached: true,
      });
    }

    const totalRemaining = totalCap - totalSamples;
    if (totalSamples + newCount > totalCap) {
      return res.status(400).json({
        message: `Adding ${newCount} samples would exceed the ${totalCap}-sample limit for "${word.label}". Only ${totalRemaining} more sample${totalRemaining !== 1 ? "s" : ""} can be collected in total.`,
        remaining: totalRemaining,
      });
    }

    // ── 2. Per-user cap ───────────────────────────────────────
    if (userTotal >= perUserCap) {
      return res.status(400).json({
        message: `You have already contributed the maximum of ${perUserCap} samples for "${word.label}". Other users can still contribute up to the word's total limit.`,
        user_limit_reached: true,
      });
    }

    const userRemaining = perUserCap - userTotal;
    if (userTotal + newCount > perUserCap) {
      return res.status(400).json({
        message: `Adding ${newCount} samples would exceed your personal limit of ${perUserCap} for "${word.label}". You can still add up to ${userRemaining} more sample${userRemaining !== 1 ? "s" : ""}.`,
        remaining: userRemaining,
        user_limit_reached: false,
      });
    }

    // When landmark data is sent directly (no file upload), create one record per sample
    // so the admin gallery shows individual entries rather than one batched record.
    if (hasLandmarkData) {
      const hasImages = Array.isArray(images) && images.length > 0;

      // Check if this is a motion batch (List<List<List<Float>>>) or single sequence (List<List<Float>>)
      // Motion batch: sequence[0][0] exists and is an array (batch of sequences)
      // Single sequence: sequence[0] is an array of landmarks (one sequence with frames)
      const isMotionBatch = sequence && Array.isArray(sequence) &&
        sequence.length > 0 && Array.isArray(sequence[0]) &&
        Array.isArray(sequence[0][0]);

      console.log("isMotionBatch:", isMotionBatch);

      if (isMotionBatch) {
        // MOTION BATCH: Each sequence[idx] is a complete sequence (array of frames)
        // images[idx] should be an array of base64 strings for that sequence's frames
        console.log("Processing MOTION BATCH with", sequence.length, "sequences");

        const records = sequence.map((seq, idx) => {
          // seq is one complete sequence: array of frames (each frame is 126 floats)
          const frameImages = hasImages && Array.isArray(images[idx]) ? images[idx] : [];
          console.log(`  Sequence ${idx}: ${seq.length} frames, ${frameImages.length} images`);

          // Save each frame image to disk and join with '|'
          const imageUrls = frameImages.map((base64, i) => saveImage(base64, i));
          const file_url = imageUrls.join("|");

          return {
            word_id: word.id,
            submitted_by: req.user.id,
            file_url: file_url,
            landmarks: null,
            sequence: seq,  // This is one complete sequence (array of frames)
            sample_count: seq.length,  // Number of frames in this sequence
            status: "pending",
            is_validated: true,
          };
        });

        console.log("Creating", records.length, "motion sample records");
        await GestureSample.bulkCreate(records);
      } else if (sequence && Array.isArray(sequence) && sequence.length > 0) {
        // SINGLE SEQUENCE (fallback): The entire sequence array is ONE sample
        // This handles the case where client sends one sequence at a time
        console.log("Processing SINGLE SEQUENCE with", sequence.length, "frames");

        const frameImages = hasImages && Array.isArray(images) && !Array.isArray(images[0]) ? images : [];
        const imageUrls = frameImages.map((base64, i) => saveImage(base64, i));
        const file_url = imageUrls.join("|");

        const record = {
          word_id: word.id,
          submitted_by: req.user.id,
          file_url: file_url,
          landmarks: null,
          sequence: sequence,  // One complete sequence
          sample_count: sequence.length,
          status: "pending",
          is_validated: true,
        };

        console.log("Creating 1 motion sample record");
        await GestureSample.create(record);
      } else {
        // STATIC: each sample is a single landmark set
        console.log("Processing STATIC batch with", landmarks.length, "samples");

        const records = landmarks.map((lm, i) => ({
          word_id: word.id,
          submitted_by: req.user.id,
          file_url:
            hasImages && images[i]
              ? saveImage(images[i], i)
              : `landmark_direct_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          landmarks: lm,
          sequence: null,
          sample_count: 1,
          status: "pending",
          is_validated: true,
        }));
        await GestureSample.bulkCreate(records);
      }
    } else {
      // Old style: single file upload (not landmark data)
      console.log("Processing FILE UPLOAD with sample_count:", newCount);

      await GestureSample.create({
        word_id: word.id,
        submitted_by: req.user.id,
        file_url,
        landmark_url: landmark_url || null,
        sample_count: newCount,
        status: "pending",
        is_validated: true,
      });
    }

    console.log("=== END UPLOAD SAMPLES DEBUG ===");

    await word.update({ total_samples: (word.total_samples || 0) + newCount });

    return res.status(201).json({
      message: "Samples uploaded successfully",
      user_total: userTotal + newCount,
      user_remaining: perUserCap - (userTotal + newCount),
      total_remaining: totalCap - (totalSamples + newCount),
    });
  } catch (err) {
    console.error("Upload samples error:", err);
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

    const word = await Word.findOne({ where: { id: req.params.id } });
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
    const approvedBeforeCount = userSamples.filter(
      (s) => s.status === "approved",
    ).length;

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
    const cap = getSampleCap(word.gesture_type || "static");
    const activated = await checkAndActivateWord(word, req.user.id);

    await sendSubmissionNotification(
      user_id,
      word.label,
      totalSubmitted,
      totalSubmitted,
      cap,
    );

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "approved_submission",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Approved submission for word: ${word.label} — ${totalApproved} total approved samples. Activated: ${activated}`,
    // });

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

    const cap = getSampleCap(word.gesture_type || "static");
    await sendSubmissionNotification(
      user_id,
      word.label,
      0,
      userSamples.length,
      cap,
    );

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "rejected_submission",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Rejected submission for word: ${word.label}. Reason: ${reason || "No reason provided"}`,
    // });

    return res
      .status(200)
      .json({ message: "Submission rejected and user notified" });
  } catch (err) {
    console.error("Reject submission error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/lock ─────────────────────────────────
const lockWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    await word.update({ is_locked: true });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "locked_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Locked submissions for word: ${word.label}`,
    // });

    return res
      .status(200)
      .json({ message: "Word locked. No further submissions allowed." });
  } catch (err) {
    console.error("Lock word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/unlock ───────────────────────────────
const unlockWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    await word.update({ is_locked: false });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "unlocked_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Unlocked submissions for word: ${word.label}`,
    // });

    return res
      .status(200)
      .json({ message: "Word unlocked. Submissions are now allowed." });
  } catch (err) {
    console.error("Unlock word error:", err);
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

    if (word.submitted_by) {
      await Notification.create({
        user_id: word.submitted_by,
        title: "Word Approved",
        message: `Your submitted word "${word.label}" has been approved. It will appear in the app after the next model update.`,
        type: "word_approved",
        is_read: false,
        delivered: false,
      });
    }

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "approved_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Approved word: ${word.label}`,
    // });

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

    if (word.submitted_by) {
      await Notification.create({
        user_id: word.submitted_by,
        title: "Word Rejected",
        message: reason
          ? `Your submitted word "${word.label}" was rejected. Reason: ${reason}`
          : `Your submitted word "${word.label}" was rejected. Please review the terms and conditions and gesture collection instructions before submitting again.`,
        type: "word_rejected",
        is_read: false,
        delivered: false,
      });
    }

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "rejected_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Rejected word: ${word.label}. Reason: ${reason || "No reason provided"}`,
    // });

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
      hands_count,
      sign_type,
      category,
      filipino_translation,
      sample_limit,
    } = req.body;

    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    // Validate sample_limit when provided
    if (sample_limit !== undefined && sample_limit !== null) {
      const parsed = parseInt(sample_limit);
      if (isNaN(parsed) || parsed < 1) {
        return res
          .status(400)
          .json({ message: "sample_limit must be a positive integer" });
      }
    }

    const updatedLabel = label || word.label;
    const updatedNormalized = normalizeLabel(updatedLabel);

    await word.update({
      label: updatedLabel,
      normalized_label: updatedNormalized,
      description: description ?? word.description,
      hands_count: hands_count || word.hands_count,
      sign_type: sign_type || word.sign_type,
      category: category || word.category,
      filipino_translation:
        filipino_translation !== undefined
          ? filipino_translation
          : word.filipino_translation,
      sample_limit:
        sample_limit !== undefined
          ? sample_limit === null
            ? null
            : parseInt(sample_limit)
          : word.sample_limit,
    });

    // Sync label and description to word bank if word is approved
    if (word.status === "approved") {
      await WordBank.update(
        {
          label: updatedLabel,
          description: description ?? word.description,
          hands_count: hands_count || word.hands_count,
          category: category || word.category,
        },
        { where: { word_id: word.id } },
      );
    }

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "updated_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Updated word: ${word.label}`,
    // });

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

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "deleted_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Deleted word: ${word.label} — all associated gesture samples and word bank entry removed`,
    // });

    await word.destroy();

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
        { model: User, as: "submitter", attributes: ["id", "username"] },
      ],
      order: [["created_at", "DESC"]],
    });

    console.log(`GET /api/words/${req.params.id}/samples`);
    console.log(`  Word: ${word.label} (${word.gesture_type})`);
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
      total_samples: word.total_samples,
      approved_sample_count: word.approved_sample_count,
      is_active: word.is_active,
      is_locked: word.is_locked,
      gesture_type: word.gesture_type,
      activation_threshold: getActivationThreshold(
        word.gesture_type || "static",
      ),
      sample_cap: getSampleCap(word.gesture_type || "static"),
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
    const cap = getSampleCap(word.gesture_type || "static");

    return res.status(200).json({
      count,
      remaining: cap - count,
      limit_reached: count >= cap,
      cap,
      gesture_type: word.gesture_type,
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

    const [count] = await GestureSample.update(
      { status: "approved" },
      { where: { word_id: word.id, status: "pending" } },
    );

    const totalApproved = await getApprovedSampleCount(word.id);
    const activated = await checkAndActivateWord(word, req.user.id);

    await word.update({ approved_sample_count: totalApproved });

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "approved_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Approved all ${count} pending samples for word: ${word.label}. Activated: ${activated}`,
    // });

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

// ── PATCH /api/words/:id/samples/reject-all ──────────────────
// Reject ALL pending samples for a word regardless of submitter
const rejectAllSamplesForWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
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

    // await ActivityLog.create({
    //   user_id: req.user.id,
    //   action: "rejected_word",
    //   target_type: "word",
    //   target_id: word.id,
    //   details: `Rejected all ${count} pending samples for word: ${word.label}`,
    // });

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

    if (word.gesture_type !== "motion") {
      return res
        .status(400)
        .json({ message: "Only available for motion gestures" });
    }

    const samples = await GestureSample.findAll({
      where: { word_id: word.id, status: "approved" },
      include: [
        { model: User, as: "submitter", attributes: ["id", "username"] },
      ],
      order: [["created_at", "ASC"]],
    });

    console.log(`GET /api/words/${req.params.id}/motion-sequences`);
    console.log(`  Word: ${word.label}, gesture_type: ${word.gesture_type}`);
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

    if (word.gesture_type !== "motion") {
      return res
        .status(400)
        .json({ message: "Only available for motion gestures" });
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

    const wb = await WordBank.findOne({ where: { word_id: word.id } });
    if (wb) await wb.update({ image_url: thumbnail_url });

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
      const ext = (req.body.video_ext || "mp4").replace(/[^a-z0-9]/gi, "");
      const videosDir = path.join(__dirname, "../../uploads/videos");
      if (!fs.existsSync(videosDir))
        fs.mkdirSync(videosDir, { recursive: true });
      const filename = `gesture_${word.id}_${Date.now()}.${ext}`;
      const filepath = path.join(videosDir, filename);
      fs.writeFileSync(filepath, Buffer.from(req.body.video_base64, "base64"));
      videoUrl = `/uploads/videos/${filename}`;
    }

    if (!videoUrl)
      return res
        .status(400)
        .json({ message: "Either video_url or video_base64 is required" });

    await word.update({ video_url: videoUrl });

    const wb = await WordBank.findOne({ where: { word_id: word.id } });
    if (wb) await wb.update({ video_url: videoUrl });

    return res
      .status(200)
      .json({ message: "Video updated", video_url: videoUrl });
  } catch (err) {
    console.error("Set video error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  getAllWords,
  getWordStats,
  getWordById,
  submitWord,
  adminAddWord,
  adminUploadSamples,
  approveWord,
  rejectWord,
  updateWord,
  deleteWord,
  uploadSamples,
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
  lockWord,
  unlockWord,
  getUserSampleCountForWord,
  setThumbnail,
  setVideo,
};
