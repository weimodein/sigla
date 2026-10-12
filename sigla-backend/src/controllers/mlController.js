const { GestureSample, Word } = require("../models/index.js");
const { datasetEntry, isExportable, datasetQueryOptions } = require("../utils/mlDataset");

/**
 * GET /api/ml/dataset
 * Returns all approved gesture samples grouped by word label. Every gesture is
 * motion; the static "features" format is no longer produced.
 * Format: { "LABEL": [ { sequence: [[...147], x30], sample_id, file_url,
 *                        submitted_by }, ... ] }
 */
const getApprovedDataset = async (req, res) => {
  const withTrack = req.query.hand_track === "1";
  try {
    // Fetch all training-eligible samples:
    // - "approved" samples (admin-reviewed) for any word
    // - "pending" samples, but only for words the admin has approved
    //   (status="approved" or is_active=true)
    //
    // Each export selects only what its consumer reads (see datasetQueryOptions):
    // words training never loads a hand track, and ?hand_track=1 returns just the
    // letter rows that have one.
    const query = datasetQueryOptions(withTrack);
    const samples = await GestureSample.findAll({
      attributes: query.attributes,
      where: query.where,
      include: [
        {
          model: Word,
          as: "word",
          attributes: ["label"],
          required: true,
          where: query.wordWhere,
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

      if (isExportable(sample, withTrack)) {
        // sample_id / file_url identify the source clip. They used to be dropped
        // here, which left the ML service unable to record WHICH samples landed in
        // which split — so a reported metric could not be reproduced or audited,
        // and a grouped (per-signer / per-session) split was impossible to build
        // even in principle. submitted_by is included for the same reason: it is
        // the grouping key a StratifiedGroupKFold will need once a second signer
        // contributes. Consumers ignore unknown keys, so this is additive.
        // session_id is the grouping key that comment anticipates. submitted_by turned
        // out to be useless for it in practice — it records the uploading ADMIN, so it
        // is 1 for 1664 of 1726 samples across all four signers.
        dataset[label].push(datasetEntry(sample, withTrack));
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

module.exports = { getApprovedDataset };
