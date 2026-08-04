const { GestureSample, Word } = require("../models/index.js");
const { Op } = require("sequelize");

/**
 * GET /api/ml/dataset
 * Returns all approved gesture samples grouped by word label. Every gesture is
 * motion; the static "features" format is no longer produced.
 * Format: { "LABEL": [ { sequence: [[...147], x30], sample_id, file_url,
 *                        submitted_by }, ... ] }
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

    // Group samples by word label. Every sample is a motion sequence (30×147).
    const dataset = {};

    for (const sample of samples) {
      const label = sample.word.label;
      if (!dataset[label]) dataset[label] = [];

      if (sample.sequence && Array.isArray(sample.sequence)) {
        // sample_id / file_url identify the source clip. They used to be dropped
        // here, which left the ML service unable to record WHICH samples landed in
        // which split — so a reported metric could not be reproduced or audited,
        // and a grouped (per-signer / per-session) split was impossible to build
        // even in principle. submitted_by is included for the same reason: it is
        // the grouping key a StratifiedGroupKFold will need once a second signer
        // contributes. Consumers ignore unknown keys, so this is additive.
        dataset[label].push({
          sequence: sample.sequence,
          sample_id: sample.id,
          file_url: sample.file_url,
          submitted_by: sample.submitted_by,
        });
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
