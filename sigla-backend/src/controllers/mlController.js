const { GestureSample, Word } = require("../models/index.js");
const { Op } = require("sequelize");

/**
 * GET /api/ml/dataset
 * Returns all approved gesture samples grouped by word label.
 * Format: { "LABEL": [ { "features": [...] }, ... ] } for static gestures,
 *         { "LABEL": [ { "sequence": [[...], ...] }, ... ] } for motion gestures.
 */
const getApprovedDataset = async (req, res) => {
  try {
    // Fetch all training-eligible samples:
    // - "approved" samples (admin-reviewed) for any word
    // - "pending" samples that passed MediaPipe validation (is_validated=true)
    //   but only for words the admin has approved (status="approved" or is_active=true)
    const samples = await GestureSample.findAll({
      where: {
        [Op.or]: [
          { status: "approved" },
          { status: "pending", is_validated: true },
        ],
      },
      include: [
        {
          model: Word,
          as: "word",
          attributes: ["label"],
          required: true,
          where: {
            [Op.or]: [{ status: "approved" }, { is_active: true }],
          },
        },
      ],
      order: [["created_at", "ASC"]],
    });

    if (!samples.length) {
      return res.status(404).json({ message: "No approved samples found" });
    }

    // Group samples by word label. Every sample is a motion sequence (30×126).
    const dataset = {};

    for (const sample of samples) {
      const label = sample.word.label;
      if (!dataset[label]) dataset[label] = [];

      if (sample.sequence && Array.isArray(sample.sequence)) {
        dataset[label].push({ sequence: sample.sequence });
      } else {
        console.warn(`Sample ${sample.id} has no embedded sequence, skipping`);
      }
    }

    // Remove any labels that ended up with no valid samples
    Object.keys(dataset).forEach((label) => {
      if (dataset[label].length === 0) delete dataset[label];
    });

    if (Object.keys(dataset).length === 0) {
      return res.status(404).json({ message: "No valid sample data found" });
    }

    res.json(dataset);
  } catch (err) {
    console.error("Error fetching ML dataset:", err);
    res.status(500).json({ message: "Server error" });
  }
};
const getWordSamplesForVideo = async (req, res) => {
  try {
    const { wordId } = req.params;
    const samples = await GestureSample.findAll({
      where: { word_id: wordId, status: "approved" },
      attributes: ["file_url"],
      limit: 30,
      order: [["created_at", "ASC"]],
    });
    res.json(samples);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = { getApprovedDataset, getWordSamplesForVideo };
