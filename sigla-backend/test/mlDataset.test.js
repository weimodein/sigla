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
