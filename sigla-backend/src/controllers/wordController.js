const { Op } = require("sequelize");
const {
  Word,
  GestureSample,
  User,
  Notification,
  ActivityLog,
  Word,
  sequelize,
} = require("../models/index.js");

// ── Helper: normalize word label ──────────────────────────────
// Converts to lowercase and strips unnecessary punctuation
const normalizeLabel = (label) =>
  label
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();

// ── Helper: get total samples submitted by user for a word ────
const getUserSampleCount = async (userId, wordId) => {
  const result = await GestureSample.count({
    where: { submitted_by: userId, word_id: wordId },
  });
  return result;
};

// ── Helper: get total approved samples for a word ─────────────
const getApprovedSampleCount = async (wordId) => {
  const result = await GestureSample.count({
    where: { word_id: wordId, status: "approved" },
  });
  return result;
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
    if (category) where.category = category;
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
    const [total, pending, approved, rejected, active, locked] =
      await Promise.all([
        Word.count(),
        Word.count({ where: { status: "pending" } }),
        Word.count({ where: { status: "approved" } }),
        Word.count({ where: { status: "rejected" } }),
        Word.count({ where: { is_active: true } }),
        Word.count({ where: { is_locked: true } }),
      ]);

    return res
      .status(200)
      .json({ total, pending, approved, rejected, active, locked });
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
// User submits a new word — normalizes label before checking
const submitWord = async (req, res) => {
  try {
    const { label, description, hands_count, sign_type, category } = req.body;

    if (!label || !sign_type) {
      return res
        .status(400)
        .json({ message: "Label and sign type are required" });
    }

    // Normalize label — lowercase + strip punctuation
    const normalized = normalizeLabel(label);

    // Check if normalized word already exists
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
      category: category || "word",
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
      details: `Submitted word: ${label} (${sign_type})`,
    });

    return res.status(201).json({
      message: "Word submitted successfully. Waiting for admin approval.",
      word,
    });
  } catch (err) {
    console.error("Submit word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/words/:id/samples ───────────────────────────────
// User uploads gesture samples — enforces per-user per-word 300 limit
const uploadSamples = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });

    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    // Block if word is locked by admin
    if (word.is_locked) {
      return res.status(403).json({
        message:
          "Submissions for this word are currently locked by the administrator.",
        locked: true,
      });
    }

    const { file_url, sample_count } = req.body;

    if (!file_url) {
      return res.status(400).json({ message: "File URL is required" });
    }

    const newCount = parseInt(sample_count) || 0;

    // Check per-user per-word 300 sample limit
    const userTotal = await getUserSampleCount(req.user.id, word.id);

    if (userTotal >= 300) {
      return res.status(400).json({
        message: `You have already reached the maximum of 300 samples for "${word.label}". You may still contribute to other words.`,
        limit_reached: true,
      });
    }

    if (userTotal + newCount > 300) {
      return res.status(400).json({
        message: `Adding ${newCount} samples would exceed your 300 sample limit for "${word.label}". You can still add up to ${300 - userTotal} more samples.`,
        remaining: 300 - userTotal,
      });
    }

    // Check if user already had an approved submission for this word
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
      sample_count: newCount,
      status: "pending",
      is_validated: true,
    });

    // Update total samples count on word
    await word.update({ total_samples: (word.total_samples || 0) + newCount });

    return res.status(201).json({
      message: "Samples uploaded successfully",
      sample,
      user_total: userTotal + newCount,
      remaining: 300 - (userTotal + newCount),
    });
  } catch (err) {
    console.error("Upload samples error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/samples/:sampleId/approve ────────────
// Admin approves individual gesture sample
const approveSample = async (req, res) => {
  try {
    const sample = await GestureSample.findOne({
      where: { id: req.params.sampleId, word_id: req.params.id },
    });

    if (!sample) {
      return res.status(404).json({ message: "Sample not found" });
    }

    await sample.update({ status: "approved" });

    // Check if word should now be auto-activated (200 approved samples)
    const word = await Word.findOne({ where: { id: req.params.id } });
    const approvedCount = await getApprovedSampleCount(word.id);

    if (approvedCount >= 200 && !word.is_active) {
      await word.update({
        is_active: true,
        approved_sample_count: approvedCount,
      });
    } else {
      await word.update({ approved_sample_count: approvedCount });
    }

    return res
      .status(200)
      .json({ message: "Sample approved", approved_count: approvedCount });
  } catch (err) {
    console.error("Approve sample error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/samples/:sampleId/reject ─────────────
// Admin rejects individual gesture sample
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
// Admin approves all samples from a specific user for a word
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
    const approvedCount = await getApprovedSampleCount(word.id);

    if (approvedCount >= 200 && !word.is_active) {
      await word.update({
        is_active: true,
        approved_sample_count: approvedCount,
      });
    } else {
      await word.update({ approved_sample_count: approvedCount });
    }

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
// Admin rejects all samples from a specific user for a word
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
// Admin approves entire submission — checks 200 sample threshold
// Sends appropriate notification based on outcome
const approveSubmission = async (req, res) => {
  try {
    const word = await Word.findOne({
      where: { id: req.params.id },
      include: [{ model: GestureSample, as: "samples" }],
    });

    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const { user_id } = req.body; // which user's submission is being reviewed

    // Get total and approved count for this user's submission
    const userSamples = await GestureSample.findAll({
      where: { word_id: word.id, submitted_by: user_id },
    });

    const totalSubmitted = userSamples.length;
    const approvedCount = userSamples.filter(
      (s) => s.status === "approved",
    ).length;

    // Approve remaining pending samples from this user
    await GestureSample.update(
      { status: "approved" },
      { where: { word_id: word.id, submitted_by: user_id, status: "pending" } },
    );

    // Recalculate total approved for the word
    const totalApproved = await getApprovedSampleCount(word.id);

    // Auto-activate word if 200 threshold reached
    if (totalApproved >= 200 && !word.is_active) {
      await word.update({
        status: "approved",
        is_active: true,
        approved_sample_count: totalApproved,
        reviewed_by: req.user.id,
        reviewed_at: new Date(),
      });

      // Add to word bank if not already there
      const existing = await WordBank.findOne({
        where: { word_id: word.id },
      });
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
    } else {
      await word.update({ approved_sample_count: totalApproved });
    }

    // Send notification to user
    const userTotal = await getUserSampleCount(user_id, word.id);
    await sendSubmissionNotification(
      user_id,
      word.label,
      approvedCount + (totalSubmitted - approvedCount),
      totalSubmitted,
      300,
    );

    await ActivityLog.create({
      user_id: req.user.id,
      action: "approved_submission",
      target_type: "word",
      target_id: word.id,
      details: `Approved submission for word: ${word.label} — ${totalApproved} total approved samples`,
    });

    return res.status(200).json({
      message: "Submission approved",
      total_approved: totalApproved,
      is_active: totalApproved >= 200,
    });
  } catch (err) {
    console.error("Approve submission error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/reject-submission ────────────────────
// Admin rejects entire submission — notifies user
const rejectSubmission = async (req, res) => {
  try {
    const { user_id, reason } = req.body;

    const word = await Word.findOne({ where: { id: req.params.id } });

    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    // Reject all pending samples from this user
    const userSamples = await GestureSample.findAll({
      where: { word_id: word.id, submitted_by: user_id },
    });

    await GestureSample.update(
      { status: "rejected" },
      { where: { word_id: word.id, submitted_by: user_id, status: "pending" } },
    );

    // If word has no approved samples at all — mark as rejected
    const totalApproved = await getApprovedSampleCount(word.id);
    if (totalApproved === 0) {
      await word.update({
        status: "rejected",
        reviewed_by: req.user.id,
        reviewed_at: new Date(),
      });
    }

    // Notify user — all rejected
    await sendSubmissionNotification(
      user_id,
      word.label,
      0,
      userSamples.length,
      300,
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
// Admin locks a word — prevents further sample submissions
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
// Admin unlocks a word — re-enables sample submissions
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
// Admin approves a pending word (manual approval)
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
// Admin rejects a pending word (manual rejection)
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
// Admin edits a word
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

    // Sync changes to word bank if word is approved
    if (word.status === "approved") {
      await WordBank.update(
        { label: updatedLabel, description, hands_count, sign_type, category },
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
// Admin deletes a word — cascades to gesture samples and word bank entry
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

    // Cascade deletes gesture_samples and word bank entry via DB constraints
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
    });
  } catch (err) {
    console.error("Get samples error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/words/:id/user-sample-count ─────────────────────
// Check how many samples the current user has submitted for a word
const getUserSampleCountForWord = async (req, res) => {
  try {
    const count = await getUserSampleCount(req.user.id, req.params.id);
    return res.status(200).json({
      count,
      remaining: 300 - count,
      limit_reached: count >= 300,
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
