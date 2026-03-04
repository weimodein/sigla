const { Op } = require("sequelize");
const {
  Word,
  GestureSample,
  User,
  Notification,
  ActivityLog,
  Dictionary,
} = require("../models/index.js");

// ── GET /api/words ────────────────────────────────────────────
// Get all words with filters
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
// Word counts for admin dashboard
const getWordStats = async (req, res) => {
  try {
    const [total, pending, approved, rejected, fsl, asl] = await Promise.all([
      Word.count(),
      Word.count({ where: { status: "pending" } }),
      Word.count({ where: { status: "approved" } }),
      Word.count({ where: { status: "rejected" } }),
      Word.count({ where: { sign_type: "FSL" } }),
      Word.count({ where: { sign_type: "ASL" } }),
    ]);

    return res
      .status(200)
      .json({ total, pending, approved, rejected, fsl, asl });
  } catch (err) {
    console.error("Get word stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/words/:id ────────────────────────────────────────
// Get a single word by ID
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
        { model: GestureSample, as: "samples" },
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
// User submits a new word
const submitWord = async (req, res) => {
  try {
    const { label, description, hands_count, sign_type, category } = req.body;

    if (!label || !sign_type) {
      return res
        .status(400)
        .json({ message: "Label and sign type are required" });
    }

    // Check if word already exists with same label and sign_type
    const existing = await Word.findOne({
      where: {
        label: { [Op.iLike]: label },
        sign_type,
        status: { [Op.in]: ["pending", "approved"] },
      },
    });

    if (existing) {
      return res.status(409).json({
        message: "This word already exists or is pending approval",
        word_id: existing.id,
      });
    }

    const word = await Word.create({
      label,
      description: description || null,
      hands_count: hands_count || 1,
      sign_type,
      category: category || "word",
      submitted_by: req.user.id,
      status: "pending",
    });

    // Notify admins — in a real system you'd query all admins
    // For now log the activity
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

// ── PATCH /api/words/:id/approve ──────────────────────────────
// Admin approves a pending word
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

    // Add to dictionary automatically
    await Dictionary.create({
      word_id: word.id,
      label: word.label,
      description: word.description,
      sign_type: word.sign_type,
      category: word.category,
      hands_count: word.hands_count,
    });

    // Notify the user who submitted
    if (word.submitted_by) {
      await Notification.create({
        user_id: word.submitted_by,
        title: "Word Approved",
        message: `Your submitted word "${word.label}" has been approved and added to the dictionary.`,
        type: "word_approved",
      });
    }

    // Log activity
    await ActivityLog.create({
      user_id: req.user.id,
      action: "approved_word",
      target_type: "word",
      target_id: word.id,
      details: `Approved word: ${word.label}`,
    });

    return res
      .status(200)
      .json({ message: "Word approved and added to dictionary" });
  } catch (err) {
    console.error("Approve word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/words/:id/reject ───────────────────────────────
// Admin rejects a pending word
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

    // Notify the user who submitted
    if (word.submitted_by) {
      await Notification.create({
        user_id: word.submitted_by,
        title: "Word Rejected",
        message: reason
          ? `Your submitted word "${word.label}" was rejected. Reason: ${reason}`
          : `Your submitted word "${word.label}" was rejected.`,
        type: "word_rejected",
      });
    }

    // Log activity
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

    await word.update({
      label: label || word.label,
      description: description ?? word.description,
      hands_count: hands_count || word.hands_count,
      sign_type: sign_type || word.sign_type,
      category: category || word.category,
    });

    // If word is approved, sync changes to dictionary
    if (word.status === "approved") {
      await Dictionary.update(
        { label, description, hands_count, sign_type, category },
        { where: { word_id: word.id } },
      );
    }

    // Log activity
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
// Admin deletes a word
const deleteWord = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });

    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    // Log before deleting
    await ActivityLog.create({
      user_id: req.user.id,
      action: "deleted_word",
      target_type: "word",
      target_id: word.id,
      details: `Deleted word: ${word.label}`,
    });

    // Cascade deletes gesture_samples and dictionary entry automatically
    await word.destroy();

    return res.status(200).json({ message: "Word deleted successfully" });
  } catch (err) {
    console.error("Delete word error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/words/:id/samples ───────────────────────────────
// User uploads gesture samples for a word
const uploadSamples = async (req, res) => {
  try {
    const word = await Word.findOne({ where: { id: req.params.id } });

    if (!word) {
      return res.status(404).json({ message: "Word not found" });
    }

    const { file_url, sample_count } = req.body;

    if (!file_url) {
      return res.status(400).json({ message: "File URL is required" });
    }

    // Check total samples don't exceed 300
    const currentTotal = word.total_samples || 0;
    const newCount = parseInt(sample_count) || 0;

    if (currentTotal + newCount > 300) {
      return res.status(400).json({
        message: `Cannot exceed 300 samples. Current: ${currentTotal}, Trying to add: ${newCount}`,
      });
    }

    const sample = await GestureSample.create({
      word_id: word.id,
      submitted_by: req.user.id,
      file_url,
      sample_count: newCount,
    });

    // Update total samples on word
    await word.update({ total_samples: currentTotal + newCount });

    return res.status(201).json({
      message: "Samples uploaded successfully",
      sample,
      total_samples: currentTotal + newCount,
    });
  } catch (err) {
    console.error("Upload samples error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── GET /api/words/:id/samples ────────────────────────────────
// Get all gesture samples for a word
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

    return res.status(200).json({ samples, total_samples: word.total_samples });
  } catch (err) {
    console.error("Get samples error:", err);
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
};
