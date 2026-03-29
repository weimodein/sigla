const { Op } = require("sequelize");
const {
  Word,
  GestureSample,
  WordBank,
  User,
  Notification,
  ActivityLog,
} = require("../models/index.js");

// ── Sample cap and activation thresholds per gesture type ─────
// Static gestures: 100 samples per user, 100 needed to activate
// Motion gestures: 150 samples per user, 150 needed to activate
const SAMPLE_CAP = { static: 100, motion: 150 };
const ACTIVATION_THRESHOLD = { static: 100, motion: 150 };

// ── Helper: normalize word label ──────────────────────────────
const normalizeLabel = (label) =>
  label
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();

// ── Helper: get sample cap for a word based on gesture_type ───
const getSampleCap = (gestureType) =>
  SAMPLE_CAP[gestureType] || SAMPLE_CAP.static;

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

// ── Helper: auto-activate word and add to word bank ───────────
const checkAndActivateWord = async (word, reviewerId = null) => {
  const threshold = getActivationThreshold(word.gesture_type || "static");
  const approvedCount = await getApprovedSampleCount(word.id);

  if (approvedCount >= threshold && !word.is_active) {
    await word.update({
      is_active: true,
      status: "approved",
      approved_sample_count: approvedCount,
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
    });

    // Add to word bank if not already there
    const existing = await WordBank.findOne({ where: { word_id: word.id } });
    if (!existing) {
      await WordBank.create({
        word_id: word.id,
        label: word.label,
        description: word.description,
        sign_type: word.sign_type,
        category: word.category,
        hands_count: word.hands_count,
      });
    }

    return true;
  }

  await word.update({ approved_sample_count: approvedCount });
  return false;
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
          attributes: ["id", "username", "name"],
        },
        { model: User, as: "reviewer", attributes: ["id", "username", "name"] },
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
        Word.sum("total_samples"), // sum of all total_samples
      ]);

    return res.status(200).json({
      total,
      pending,
      approved,
      rejected,
      active,
      locked,
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
          attributes: ["id", "username", "name"],
        },
        { model: User, as: "reviewer", attributes: ["id", "username", "name"] },
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
      return res.status(409).json({
        message: "This word already exists or is pending approval",
        word_id: existing.id,
        existing: true,
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

    await ActivityLog.create({
      user_id: req.user.id,
      action: "submitted_word",
      target_type: "word",
      target_id: word.id,
      details: `Submitted word: ${label} (${sign_type}, ${gesture_type || "static"})`,
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
      submitted_by: req.user.id,
      status: "approved",
      is_locked: false,
      is_active: false,
      approved_sample_count: 0,
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    });

    await ActivityLog.create({
      user_id: req.user.id,
      action: "admin_added_word",
      target_type: "word",
      target_id: word.id,
      details: `Admin manually added word: ${label} (${sign_type}, ${gesture_type || "static"})`,
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

    // Create sample record — auto-approved since uploaded by admin
    const sample = await GestureSample.create({
      word_id: word.id,
      submitted_by: req.user.id,
      file_url,
      landmark_url: landmark_url || null,
      sample_count: newCount,
      status: "approved",
      is_validated: true,
    });

    // Update total samples count
    await word.update({
      total_samples: (word.total_samples || 0) + newCount,
    });

    // Check if word should now be activated
    const activated = await checkAndActivateWord(word, req.user.id);

    await ActivityLog.create({
      user_id: req.user.id,
      action: "admin_uploaded_samples",
      target_type: "word",
      target_id: word.id,
      details: `Admin uploaded ${newCount} gesture sample(s) for word: ${word.label}. Word activated: ${activated}`,
    });

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

    const { file_url, landmark_url, sample_count } = req.body;

    if (!file_url) {
      return res.status(400).json({ message: "File URL is required" });
    }

    const newCount = parseInt(sample_count) || 0;
    const cap = getSampleCap(word.gesture_type || "static");
    const userTotal = await getUserSampleCount(req.user.id, word.id);

    // Enforce per-user per-word sample cap based on gesture type
    if (userTotal >= cap) {
      return res.status(400).json({
        message: `You have already reached the maximum of ${cap} samples for "${word.label}". You may still contribute to other words.`,
        limit_reached: true,
      });
    }

    if (userTotal + newCount > cap) {
      return res.status(400).json({
        message: `Adding ${newCount} samples would exceed your ${cap} sample limit for "${word.label}". You can still add up to ${cap - userTotal} more samples.`,
        remaining: cap - userTotal,
      });
    }

    // Block if user already had an approved submission for this word
    const approvedSubmission = await GestureSample.findOne({
      where: {
        submitted_by: req.user.id,
        word_id: word.id,
        status: "approved",
      },
    });

    if (approvedSubmission) {
      return res.status(403).json({
        message: `Your previous submission for "${word.label}" was already approved. You cannot add more samples to this word.`,
        already_approved: true,
      });
    }

    const sample = await GestureSample.create({
      word_id: word.id,
      submitted_by: req.user.id,
      file_url,
      landmark_url: landmark_url || null,
      sample_count: newCount,
      status: "pending",
      is_validated: true,
    });

    await word.update({ total_samples: (word.total_samples || 0) + newCount });

    return res.status(201).json({
      message: "Samples uploaded successfully",
      sample,
      user_total: userTotal + newCount,
      remaining: cap - (userTotal + newCount),
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
    const { user_id } = req.body;

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

    await ActivityLog.create({
      user_id: req.user.id,
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
    const { user_id, reason } = req.body;

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

    await ActivityLog.create({
      user_id: req.user.id,
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

// ── PATCH /api/words/:id/lock ─────────────────────────────────
const lockWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    await word.update({ is_locked: true });

    await ActivityLog.create({
      user_id: req.user.id,
      action: "locked_word",
      target_type: "word",
      target_id: word.id,
      details: `Locked submissions for word: ${word.label}`,
    });

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

    await ActivityLog.create({
      user_id: req.user.id,
      action: "unlocked_word",
      target_type: "word",
      target_id: word.id,
      details: `Unlocked submissions for word: ${word.label}`,
    });

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
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    });

    const existing = await WordBank.findOne({ where: { word_id: word.id } });
    if (!existing) {
      await WordBank.create({
        word_id: word.id,
        label: word.label,
        description: word.description,
        sign_type: word.sign_type,
        category: word.category,
        hands_count: word.hands_count,
      });
    }

    if (word.submitted_by) {
      await Notification.create({
        user_id: word.submitted_by,
        title: "Word Approved",
        message: `Your submitted word "${word.label}" has been approved and added to the word bank.`,
        type: "word_approved",
        is_read: false,
        delivered: false,
      });
    }

    await ActivityLog.create({
      user_id: req.user.id,
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

    await ActivityLog.create({
      user_id: req.user.id,
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
    const { label, description, hands_count, sign_type, category } = req.body;

    const word = await Word.findOne({ where: { id: req.params.id } });
    if (!word) {
      return res.status(404).json({ message: "Word not found" });
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

    await ActivityLog.create({
      user_id: req.user.id,
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

    await ActivityLog.create({
      user_id: req.user.id,
      action: "deleted_word",
      target_type: "word",
      target_id: word.id,
      details: `Deleted word: ${word.label} — all associated gesture samples and word bank entry removed`,
    });

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
  approveSample,
  rejectSample,
  approveAllSamplesByUser,
  rejectAllSamplesByUser,
  approveSubmission,
  rejectSubmission,
  lockWord,
  unlockWord,
  getUserSampleCountForWord,
};
