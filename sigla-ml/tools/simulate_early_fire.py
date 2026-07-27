"""
Offline early-fire simulator — replays stored samples through the live streak /
early-exit logic from sigla-mobile PredictionService.kt.

WHY THIS EXISTS
---------------
test.py evaluates the model on a full, peak-centred 30-frame window. Live
inference does something quite different: it feeds a GROWING buffer to the model
every MOTION_SLIDE_INTERVAL frames and fires as soon as a confidence streak is
satisfied — often long before the gesture has finished. A model can score well in
test.py and still fire the wrong word live, because it committed to a prediction
while it had only seen a shared opening movement.

That blind spot is exactly how two real bugs survived in PredictionService.kt:

  1. The streak counter double-incremented for conf >= EARLY_EXIT_THRESHOLD,
     because the 0.95 tier and the 0.60 tier were independent `if`s and 0.95 also
     clears 0.60. MOTION_EARLY_STREAK=10 was really reached in 5 cycles.
  2. Past BUFFER_FILL_MS both the stride branch and the time branch ran inference
     in the same processFrame, doubling the streak rate again (~4x total).

Run with --legacy-bugs to reproduce the pre-fix behaviour and diff the two.

USAGE
    python tools/simulate_early_fire.py --model models/1.0.27
    python tools/simulate_early_fire.py --model models/1.0.27 --legacy-bugs
    python tools/simulate_early_fire.py --model models/1.0.27 --compare

Requires the backend to be reachable (same ML_API_KEY / BACKEND_URL as training)
because it pulls the real stored samples via preprocessor.fetch_approved_samples.
"""

import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.preprocessor import (  # noqa: E402
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
    center_on_peak_velocity,
    fetch_approved_samples,
    normalize_sequence,
)

# ── Constants mirrored from PredictionService.kt ──────────────────────────────
# Keep these in sync with the Kotlin file; they are the thing under test.
MIN_MOTION_FRAMES     = 8
MOTION_SLIDE_INTERVAL = 2
MOTION_THRESHOLD      = 0.60
MOTION_EARLY_CONF     = 0.60
MOTION_EARLY_STREAK   = 10
EARLY_EXIT_THRESHOLD  = 0.95
EARLY_EXIT_STREAK     = 10
BUFFER_CAPACITY       = 90

# The live buffer forces a run once it has been filling for BUFFER_FILL_MS and holds
# a full window. Frames arrive at roughly FRAME_INTERVAL_MS apart on device (~15fps
# effective after MainActivity's frame skip), so we express the fallback in frames.
BUFFER_FILL_MS   = 1500
FRAME_INTERVAL_MS = 66  # ~15 fps


def load_model(model_dir: str):
    """Load the Keras model + label map for a model version directory."""
    import tensorflow as tf

    h5_path = os.path.join(model_dir, "sign_model_motion.h5")
    lbl_path = os.path.join(model_dir, "labels_motion.json")
    if not os.path.exists(h5_path):
        raise SystemExit(f"No model at {h5_path}")
    if not os.path.exists(lbl_path):
        raise SystemExit(f"No labels at {lbl_path}")

    # We evaluate the .h5 rather than the .tflite for the same reason test.py does:
    # the LSTM's TFLite build uses Select-TF (Flex) ops that Python's tf.lite
    # Interpreter does not register. Identical weights either way.
    model = tf.keras.models.load_model(h5_path)
    with open(lbl_path) as f:
        raw = json.load(f)
    labels = [raw[str(i)] for i in range(len(raw))]
    return model, labels


def extract_motion_window(frames: list) -> np.ndarray:
    """Port of PredictionService.extractMotionWindow — pads short buffers, else
    peak-centres. Delegates to the shared Python implementation so the simulator
    cannot drift from training."""
    n = len(frames)
    if n < SEQUENCE_LENGTH:
        padded = list(frames) + [frames[-1]] * (SEQUENCE_LENGTH - n)
        return np.array(padded[:SEQUENCE_LENGTH], dtype=np.float32)
    return center_on_peak_velocity(np.array(frames, dtype=np.float32))


class Simulator:
    """Faithful port of PredictionService.processFrame / runAndMaybeFire."""

    def __init__(self, model, labels, legacy_bugs: bool = False):
        self.model = model
        self.labels = labels
        self.legacy = legacy_bugs

    def _predict(self, buffer: list):
        window = extract_motion_window(buffer)
        probs = self.model.predict(window[np.newaxis, ...], verbose=0)[0]
        idx = int(np.argmax(probs))
        return idx, float(probs[idx])

    def run(self, sequence: np.ndarray):
        """Replay one sample frame-by-frame.

        Returns (fired_idx, confidence, fire_frame) or (None, None, None) if the
        gesture ended without ever firing.
        """
        buffer = []
        streak = 0
        streak_label = -1
        frames_since_run = 0
        buf_start_frame = 0

        for i, frame in enumerate(sequence):
            buffer.append(frame)
            if len(buffer) > BUFFER_CAPACITY:
                buffer.pop(0)

            frames_since_run += 1
            elapsed_ms = (i - buf_start_frame) * FRAME_INTERVAL_MS
            force_run = elapsed_ms >= BUFFER_FILL_MS and len(buffer) >= SEQUENCE_LENGTH
            slide_run = (
                len(buffer) >= MIN_MOTION_FRAMES
                and frames_since_run >= MOTION_SLIDE_INTERVAL
            )

            runs = []
            if self.legacy:
                # BUG 2: the two branches were independent `if`s, so both could run
                # inference on the same frame once past BUFFER_FILL_MS.
                if slide_run:
                    frames_since_run = 0
                    runs.append(False)
                if force_run:
                    runs.append(True)
            else:
                if force_run:
                    frames_since_run = 0
                    runs.append(True)
                elif slide_run:
                    frames_since_run = 0
                    runs.append(False)

            for force in runs:
                idx, conf = self._predict(buffer)

                if self.legacy:
                    # BUG 1: both tiers incremented, so a >=0.95 frame counted twice.
                    if conf >= EARLY_EXIT_THRESHOLD:
                        streak = streak + 1 if streak_label == idx else 1
                        streak_label = idx
                        if streak >= EARLY_EXIT_STREAK or force:
                            return idx, conf, i
                    if conf >= MOTION_EARLY_CONF:
                        streak = streak + 1 if streak_label == idx else 1
                        streak_label = idx
                        if streak >= MOTION_EARLY_STREAK:
                            return idx, conf, i
                    else:
                        streak, streak_label = 0, -1
                else:
                    # Fixed: count the streak exactly once, tiers mutually exclusive.
                    if conf >= MOTION_EARLY_CONF:
                        streak = streak + 1 if streak_label == idx else 1
                        streak_label = idx
                    else:
                        streak, streak_label = 0, -1

                    if conf >= EARLY_EXIT_THRESHOLD:
                        if streak >= EARLY_EXIT_STREAK or force:
                            return idx, conf, i
                    elif conf >= MOTION_EARLY_CONF:
                        if streak >= MOTION_EARLY_STREAK:
                            return idx, conf, i

                if force and conf >= MOTION_THRESHOLD:
                    return idx, conf, i

        return None, None, None


def evaluate(sim: Simulator, dataset: dict, labels: list) -> dict:
    """Replay every stored sample; report early-fire accuracy and fire point."""
    total = correct = fired = 0
    fire_points = []
    confusions = {}

    label_to_idx = {lab: i for i, lab in enumerate(labels)}

    for label, samples in dataset.items():
        if label not in label_to_idx:
            print(f"  [skip] '{label}' is not a class in this model")
            continue
        true_idx = label_to_idx[label]

        for sample in samples:
            seq = sample.get("sequence")
            if not seq or len(seq[0]) != FEATURE_SIZE:
                continue
            arr = normalize_sequence(np.array(seq, dtype=np.float32))
            total += 1

            idx, conf, frame = sim.run(arr)
            if idx is None:
                continue
            fired += 1
            fire_points.append(frame)
            if idx == true_idx:
                correct += 1
            else:
                key = (label, labels[idx])
                confusions[key] = confusions.get(key, 0) + 1

    return {
        "total": total,
        "fired": fired,
        "correct": correct,
        "accuracy": correct / fired if fired else 0.0,
        "coverage": fired / total if total else 0.0,
        "mean_fire_frame": float(np.mean(fire_points)) if fire_points else 0.0,
        "confusions": confusions,
    }


def report(title: str, r: dict) -> None:
    print(f"\n=== {title} ===")
    print(f"  samples replayed : {r['total']}")
    print(f"  fired            : {r['fired']}  ({r['coverage'] * 100:.1f}% coverage)")
    print(f"  correct          : {r['correct']}")
    print(f"  early-fire acc   : {r['accuracy'] * 100:.1f}%")
    print(f"  mean fire frame  : {r['mean_fire_frame']:.1f} / {SEQUENCE_LENGTH}")
    if r["confusions"]:
        print("  top confusions (true -> predicted):")
        for (t, p), n in sorted(r["confusions"].items(), key=lambda kv: -kv[1])[:10]:
            print(f"    {n:>3}x  {t} -> {p}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", default="models/1.0.27", help="model version directory")
    ap.add_argument("--legacy-bugs", action="store_true",
                    help="reproduce the pre-fix double-increment / double-inference behaviour")
    ap.add_argument("--compare", action="store_true",
                    help="run both fixed and legacy and print the delta")
    args = ap.parse_args()

    model, labels = load_model(args.model)
    print(f"Loaded {args.model} — {len(labels)} classes")

    dataset = fetch_approved_samples()

    if args.compare:
        fixed = evaluate(Simulator(model, labels, legacy_bugs=False), dataset, labels)
        legacy = evaluate(Simulator(model, labels, legacy_bugs=True), dataset, labels)
        report("LEGACY (with bugs)", legacy)
        report("FIXED", fixed)
        d_acc = (fixed["accuracy"] - legacy["accuracy"]) * 100
        d_fire = fixed["mean_fire_frame"] - legacy["mean_fire_frame"]
        print("\n=== DELTA (fixed - legacy) ===")
        print(f"  early-fire accuracy : {d_acc:+.1f} pp")
        print(f"  mean fire frame     : {d_fire:+.1f} frames (later = more evidence seen)")
    else:
        sim = Simulator(model, labels, legacy_bugs=args.legacy_bugs)
        mode = "LEGACY (with bugs)" if args.legacy_bugs else "FIXED"
        report(mode, evaluate(sim, dataset, labels))


if __name__ == "__main__":
    main()
