const test = require("node:test");
const assert = require("node:assert");
const { datasetEntry, extractUrl, isExportable } = require("../src/utils/mlDataset");

const sample = {
  id: 5, sequence: [[0]], file_url: "f", submitted_by: 1, session_id: "signer-01",
  hand_track: { version: 1, frames: [] },
};

test("dataset entry omits hand_track unless asked", () => {
  assert.deepStrictEqual(Object.keys(datasetEntry(sample, false)).sort(),
    ["file_url", "sample_id", "sequence", "session_id", "submitted_by"]);
});

test("dataset entry includes hand_track when asked and present", () => {
  assert.deepStrictEqual(datasetEntry(sample, true).hand_track, { version: 1, frames: [] });
  assert.ok(!("hand_track" in datasetEntry({ ...sample, hand_track: null }, true)));
});

test("extract url asks letters for the track only, and leaves every other word alone", () => {
  assert.strictEqual(extractUrl("http://ml", "letters"), "http://ml/extract-landmarks?only_hand_track=true");
  assert.strictEqual(extractUrl("http://ml", "words"), "http://ml/extract-landmarks");
  assert.strictEqual(extractUrl("http://ml", undefined), "http://ml/extract-landmarks");
});

test("a sample with only a hand track is exported only when the track is asked for", () => {
  const trackOnly = { ...sample, sequence: null };
  assert.strictEqual(isExportable(trackOnly, true), true);
  assert.strictEqual(isExportable(trackOnly, false), false);   // the words/LSTM export is unchanged
  assert.strictEqual(isExportable({ ...trackOnly, hand_track: null }, true), false);
  assert.strictEqual(isExportable(sample, false), true);       // an ordinary word sample
  assert.strictEqual(isExportable({ ...sample, sequence: "not an array" }, false), false);
});

// ── what the dataset query asks the database for ────────────────────────────
// The full export is ~268 MB (every word's 30x147 windows). Letters training needs
// only the letter rows that carry a track, and words training never needs a track,
// so each export now selects exactly what its consumer reads.
const { Op } = require("sequelize");
const { datasetQueryOptions } = require("../src/utils/mlDataset");

test("letters export (hand_track=1): only letter rows with a track, without the old windows", () => {
  const o = datasetQueryOptions(true);
  assert.deepStrictEqual(o.attributes, { exclude: ["sequence"] });
  assert.ok(o.wordWhere[Op.and].some((c) => c.vocabulary === "letters"), "must restrict to letter words");
  const literals = o.where[Op.and].filter((c) => typeof c.val === "string").map((c) => c.val);
  assert.ok(literals.some((v) => /hand_track" IS NOT NULL/.test(v)), "must require a track");
});

test("words export (default): never loads tracks, and skips rows with no window", () => {
  const o = datasetQueryOptions(false);
  assert.deepStrictEqual(o.attributes, { exclude: ["hand_track"] });
  assert.ok(!JSON.stringify(o.wordWhere[Op.and] ?? o.wordWhere).includes("letters"), "must not be limited to letters");
  const literals = o.where[Op.and].filter((c) => typeof c.val === "string").map((c) => c.val);
  assert.ok(literals.some((v) => /sequence" IS NOT NULL/.test(v)), "must require a window");
});

test("both exports keep the same eligibility rules as before", () => {
  for (const withTrack of [true, false]) {
    const o = datasetQueryOptions(withTrack);
    const statusRule = o.where[Op.and].find((c) => c[Op.or]);
    assert.deepStrictEqual(statusRule[Op.or], [{ status: "approved" }, { status: "pending" }]);
    const wordRule = [].concat(o.wordWhere[Op.and] ?? o.wordWhere).find((c) => c[Op.or]);
    assert.deepStrictEqual(wordRule[Op.or], [{ status: "approved" }, { is_active: true }]);
  }
});
