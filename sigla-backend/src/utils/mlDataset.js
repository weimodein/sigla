// Pure helpers for the ML service contract, kept out of the controllers so they
// can be tested without a database. Letters design:
// docs-internal/specs/2026-10-11-letters-accuracy-design.md

// One /api/ml/dataset row. hand_track is large and only the letters pipeline
// reads it, so it is sent only when the caller asks (?hand_track=1).
function datasetEntry(sample, withTrack) {
  const entry = {
    sequence: sample.sequence,
    sample_id: sample.id,
    file_url: sample.file_url,
    submitted_by: sample.submitted_by,
    session_id: sample.session_id,
  };
  if (withTrack && sample.hand_track) entry.hand_track = sample.hand_track;
  return entry;
}

const { Op, literal } = require("sequelize");

// What /api/ml/dataset asks the database for. The full export was ~268 MB (every
// word's 30x147 window), close to V8's ~512 MB string limit on the server, yet each
// consumer reads only part of it: letters training wants just the letter rows that
// carry a track (no windows), and words training never reads a track. So each export
// selects exactly that. Eligibility (sample and word status) is unchanged.
function datasetQueryOptions(withTrack) {
  const statusOk = { [Op.or]: [{ status: "approved" }, { status: "pending" }] };
  const wordEligible = { [Op.or]: [{ status: "approved" }, { is_active: true }] };
  if (withTrack) {
    return {
      attributes: { exclude: ["sequence"] },
      where: { [Op.and]: [statusOk, literal('"GestureSample"."hand_track" IS NOT NULL')] },
      wordWhere: { [Op.and]: [{ vocabulary: "letters" }, wordEligible] },
    };
  }
  return {
    attributes: { exclude: ["hand_track"] },
    where: { [Op.and]: [statusOk, literal('"GestureSample"."sequence" IS NOT NULL')] },
    wordWhere: { [Op.and]: [wordEligible] },
  };
}

// Letter words need only the one-hand track (the 30-frame window is unused for
// letters and is the slow part: ~34 s per clip against ~7 s); every other word
// is extracted exactly as before.
function extractUrl(baseUrl, vocabulary) {
  return `${baseUrl}/extract-landmarks${vocabulary === "letters" ? "?only_hand_track=true" : ""}`;
}

// Whether /api/ml/dataset includes this sample. An ordinary sample needs its
// 30-frame sequence. A letter sample may have only a hand track, and is exported
// only when the caller asked for tracks, so the words/LSTM export is unchanged.
function isExportable(sample, withTrack) {
  if (Array.isArray(sample.sequence)) return true;
  return Boolean(withTrack && sample.hand_track);
}

module.exports = { datasetEntry, extractUrl, isExportable, datasetQueryOptions };
