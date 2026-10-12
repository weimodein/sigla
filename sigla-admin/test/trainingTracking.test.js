import test from "node:test";
import assert from "node:assert";
import { STALL_TIMEOUT_MS, progressSignature, isStalled } from "../src/utils/trainingTracking.js";

const words = (epoch, status = "training") => ({ row: { status }, progress: { stage: "training_final_model", current_epoch: epoch, current_batch: 3, progress: 40 } });

test("the signature changes when the run does something, and not otherwise", () => {
  const sig = (w, l) => progressSignature(w.row, w.progress, l?.row ?? null, l?.progress ?? null);
  assert.strictEqual(sig(words(5)), sig(words(5)));                       // nothing happened
  assert.notStrictEqual(sig(words(5)), sig(words(6)));                    // next epoch
  assert.notStrictEqual(sig(words(5)), sig(words(5, "trained")));         // status changed
  const a = { row: { status: "training" }, progress: { stage: "preparing_data", progress: 8 } };
  assert.notStrictEqual(sig(words(5)), sig(words(5), a));                 // the alphabet half started reporting
  assert.doesNotThrow(() => progressSignature(null, null, null, null));   // no progress yet (ML restarting / not started)
});

test("a run is stalled only after the timeout passes with no change", () => {
  assert.strictEqual(isStalled(1_000 + STALL_TIMEOUT_MS, 1_000), false);       // exactly at the limit
  assert.strictEqual(isStalled(1_001 + STALL_TIMEOUT_MS, 1_000), true);        // just over
  assert.strictEqual(isStalled(5_000, 1_000), false);
});

test("a healthy run is never given up on, however long it takes", () => {
  // 6 hours of training, a new epoch every 25 s, polled every 5 s.
  let now = 0, lastChange = 0, last = null, epoch = 0;
  for (let t = 0; t < 6 * 3600 * 1000; t += 5000) {
    now = t;
    if (t % 25_000 === 0) epoch += 1;
    const sig = progressSignature({ status: "training" }, { stage: "selecting_model", current_epoch: epoch }, null, null);
    if (sig !== last) { last = sig; lastChange = now; }
    assert.strictEqual(isStalled(now, lastChange), false, `stalled at ${t / 60000} min`);
  }
});

test("a stuck run (same report forever) is given up on after the timeout", () => {
  let lastChange = 0, last = null, gaveUpAt = null;
  for (let t = 0; t < 3 * 3600 * 1000 && gaveUpAt === null; t += 5000) {
    const sig = progressSignature({ status: "training" }, null, null, null);   // server restarted: stays "training", reports nothing
    if (sig !== last) { last = sig; lastChange = t; }
    if (isStalled(t, lastChange)) gaveUpAt = t;
  }
  assert.ok(gaveUpAt !== null && gaveUpAt > STALL_TIMEOUT_MS && gaveUpAt <= STALL_TIMEOUT_MS + 5000);
});

test("the timeout is 30 minutes", () => {
  assert.strictEqual(STALL_TIMEOUT_MS, 30 * 60 * 1000);
});
