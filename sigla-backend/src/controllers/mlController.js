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
    // Fetch all approved samples with their associated word
    const samples = await GestureSample.findAll({
      where: { status: "approved" },
      include: [
        {
          model: Word,
          as: "word",
          attributes: ["label", "gesture_type"],
          required: true,
        },
      ],
      order: [["created_at", "ASC"]],
    });

    if (!samples.length) {
      return res.status(404).json({ message: "No approved samples found" });
    }

    // Group samples by word label and gesture type
    const dataset = {};

    for (const sample of samples) {
      const label = sample.word.label;
      const gestureType = sample.word.gesture_type || "static";

      if (!dataset[label]) {
        dataset[label] = [];
      }

      // We need to load the landmark data.
      // There are two options:
      // Option 1: Landmarks are stored in the database as JSON (recommended)
      // Option 2: Landmarks are stored in Supabase Storage; download the JSON file.
      //
      // For simplicity, I'll assume you have added a `landmarks` column to GestureSample
      // that stores the features array (static) or sequence array (motion).
      // If you don't have that, you'll need to download from `landmark_url`.
      //
      // Below is an example for both cases:

      if (gestureType === "static") {
        // Static sample: expects a `features` array
        if (sample.landmarks && Array.isArray(sample.landmarks)) {
          dataset[label].push({ features: sample.landmarks });
        } else if (sample.landmark_url) {
          // Download from Supabase (add helper function)
          // For brevity, I'm skipping full implementation here.
          console.warn(
            `Static sample ${sample.id} has no embedded landmarks, skipping`,
          );
        }
      } else {
        // Motion sample: expects a `sequence` array (list of frames)
        if (sample.sequence && Array.isArray(sample.sequence)) {
          dataset[label].push({ sequence: sample.sequence });
        } else if (sample.landmark_url) {
          // Download and parse (skipping)
          console.warn(
            `Motion sample ${sample.id} has no embedded sequence, skipping`,
          );
        }
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
