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

// Letter words also need the one-hand track; every other word does not.
function extractUrl(baseUrl, vocabulary) {
  return `${baseUrl}/extract-landmarks${vocabulary === "letters" ? "?hand_track=true" : ""}`;
}

module.exports = { datasetEntry, extractUrl };
