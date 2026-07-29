"""
EXPERIMENT (not wired into the pipeline): does slot canonicalization help?

Background. The 147-float vector has two hand slots. Which physical hand lands in
which slot is decided by MediaPipe's detection order, which is arbitrary and can
change frame to frame. For two-handed signs that means the same gesture can be
presented to the model in two different arrangements.

Canonicalization forces a consistent assignment. It was tried once before using
CHIRALITY (the 2D cross-product of wrist->index-MCP and wrist->pinky-MCP): it fixed
two-handed signs but regressed one-handed ones via false-positive second-hand
detections, so it was reverted on both the Python and Kotlin sides.

This script tests two variants offline, against the stored dataset, WITHOUT touching
the deployed model:

  chirality  - the reverted implementation (preprocessor.canonicalize_slots)
  posewrist  - assign slots by proximity to the pose LEFT/RIGHT wrist keypoints.
               Pose wrists are anatomically left/right and shoulder-normalised, so
               they are a more reliable identity signal than per-frame chirality.

Reported per variant: how often it swaps, and cross-validated per-class recall so a
gain on two-handed words can be weighed against any regression on one-handed ones.

    venv/Scripts/python.exe tools/exp_slot_canon.py --folds 5
"""

import argparse
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.preprocessor import (  # noqa: E402
    FEATURE_SIZE,
    _POSE_BASE,
    canonicalize_slots,
    fetch_approved_samples,
    prepare_motion_dataset,
)

_POSE_LWRIST = 5
_POSE_RWRIST = 6


def _hand_centroid(frame: np.ndarray, base: int):
    """Mean (x, y) of a hand block's 21 landmarks, or None when absent."""
    block = frame[base:base + 63]
    if not np.any(block):
        return None
    xs = block[0::3]
    ys = block[1::3]
    return float(np.mean(xs)), float(np.mean(ys))


def canonicalize_by_pose_wrist(seq: np.ndarray) -> np.ndarray:
    """Put the hand nearest the pose RIGHT wrist in slot 0.

    One decision per sequence, taken from the frame where the two hand centroids are
    furthest apart (identity is least ambiguous there) — same structure as the
    chirality version, different signal.

    Hand blocks are wrist-centred by normalize_frame, so their absolute position is
    gone; the centroid is therefore only meaningful RELATIVE to the pose wrists,
    which is what this compares. Sequences without two hands AND a pose block are
    returned unchanged.
    """
    best_sep = -1.0
    swap = False

    for frame in seq:
        c0 = _hand_centroid(frame, 0)
        c1 = _hand_centroid(frame, 63)
        if c0 is None or c1 is None:
            continue
        if not np.any(frame[_POSE_BASE:_POSE_BASE + 21]):
            continue

        lw = (float(frame[_POSE_BASE + _POSE_LWRIST * 3]),
              float(frame[_POSE_BASE + _POSE_LWRIST * 3 + 1]))
        rw = (float(frame[_POSE_BASE + _POSE_RWRIST * 3]),
              float(frame[_POSE_BASE + _POSE_RWRIST * 3 + 1]))

        sep = abs(c0[0] - c1[0]) + abs(c0[1] - c1[1])
        if sep <= best_sep:
            continue
        best_sep = sep

        # Does slot0 sit closer to the LEFT pose wrist than slot1 does? If so the
        # slots are the wrong way round under "slot0 = right hand".
        d0_r = (c0[0] - rw[0]) ** 2 + (c0[1] - rw[1]) ** 2
        d0_l = (c0[0] - lw[0]) ** 2 + (c0[1] - lw[1]) ** 2
        d1_r = (c1[0] - rw[0]) ** 2 + (c1[1] - rw[1]) ** 2
        d1_l = (c1[0] - lw[0]) ** 2 + (c1[1] - lw[1]) ** 2
        swap = (d0_l < d0_r) and (d1_r < d1_l)

    if not swap:
        return seq
    out = seq.copy()
    out[:, 0:63], out[:, 63:126] = seq[:, 63:126].copy(), seq[:, 0:63].copy()
    return out


VARIANTS = {
    "baseline":  lambda s: s,
    "chirality": canonicalize_slots,
    "posewrist": canonicalize_by_pose_wrist,
}


def apply_variant(dataset: dict, name: str) -> dict:
    fn = VARIANTS[name]
    out = {}
    for label, samples in dataset.items():
        new = []
        for s in samples:
            seq = s.get("sequence")
            if not seq or len(seq[0]) != FEATURE_SIZE:
                continue
            arr = fn(np.array(seq, dtype=np.float32))
            new.append({**s, "sequence": arr.tolist()})
        if new:
            out[label] = new
    return out


def swap_rate(dataset: dict, name: str):
    """How many sequences does this variant actually reorder?"""
    fn = VARIANTS[name]
    per_label = defaultdict(lambda: [0, 0])
    for label, samples in dataset.items():
        for s in samples:
            seq = s.get("sequence")
            if not seq or len(seq[0]) != FEATURE_SIZE:
                continue
            arr = np.array(seq, dtype=np.float32)
            per_label[label][1] += 1
            if not np.array_equal(fn(arr), arr):
                per_label[label][0] += 1
    return per_label


def run_cv(dataset: dict, folds: int, epochs: int):
    from tensorflow import keras
    from sklearn.utils.class_weight import compute_class_weight
    from app.services.train import build_motion_model

    accs = []
    recalls = defaultdict(list)
    confusions = defaultdict(int)

    for fold in range(folds):
        X_tr, y_tr, X_va, y_va, label_map = prepare_motion_dataset(
            dataset, fold=fold, n_splits=folds, random_state=42
        )
        if len(X_va) == 0:
            continue
        model = build_motion_model(len(label_map))
        cw = compute_class_weight("balanced", classes=np.unique(y_tr), y=y_tr)
        model.fit(
            X_tr, y_tr, validation_data=(X_va, y_va), epochs=epochs, batch_size=32,
            class_weight=dict(enumerate(cw)),
            callbacks=[keras.callbacks.EarlyStopping(
                monitor="val_accuracy", patience=20, restore_best_weights=True)],
            verbose=0,
        )
        pred = np.argmax(model.predict(X_va, verbose=0), axis=1)
        keras.backend.clear_session()

        accs.append(float((y_va == pred).mean()))
        for i, lab in label_map.items():
            m = y_va == i
            if m.sum():
                recalls[lab].append(float((pred[m] == i).mean()))
        for t, p in zip(y_va, pred):
            if t != p:
                confusions[(label_map[int(t)], label_map[int(p)])] += 1

    return accs, recalls, confusions


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--out", default="exp_slot_canon.json")
    args = ap.parse_args()

    raw = fetch_approved_samples()
    raw = {k: [s for s in v if "sequence" in s] for k, v in raw.items()}
    raw = {k: v for k, v in raw.items() if v}

    print("=" * 66)
    print("SWAP RATES — how many sequences each variant actually reorders")
    print("=" * 66)
    for name in ("chirality", "posewrist"):
        rates = swap_rate(raw, name)
        total_sw = sum(v[0] for v in rates.values())
        total_n = sum(v[1] for v in rates.values())
        print(f"\n  {name}: {total_sw}/{total_n} sequences swapped")
        for lab in sorted(rates):
            sw, n = rates[lab]
            if sw:
                print(f"      {lab:<20} {sw:>3}/{n}")

    results = {}
    for name in VARIANTS:
        print(f"\n{'=' * 66}")
        print(f"CROSS-VALIDATING: {name}  ({args.folds} folds)")
        print("=" * 66, flush=True)
        ds = apply_variant(raw, name)
        accs, recalls, conf = run_cv(ds, args.folds, args.epochs)
        if not accs:
            print("  no folds produced validation data")
            continue
        results[name] = {
            "accuracy_mean": float(np.mean(accs)),
            "accuracy_std": float(np.std(accs)),
            "per_class_recall": {k: v for k, v in recalls.items()},
            "confusions": {f"{t} -> {p}": n for (t, p), n in conf.items()},
        }
        print(f"  accuracy {np.mean(accs) * 100:.1f}% +/- {np.std(accs) * 100:.1f}%")

    # Comparison table — the whole point is regression vs gain, per class.
    print(f"\n{'=' * 66}")
    print("PER-CLASS RECALL BY VARIANT (mean across folds)")
    print("=" * 66)
    names = [n for n in VARIANTS if n in results]
    print(f"  {'word':<20} " + "".join(f"{n:>12}" for n in names) + "   verdict")
    labels = sorted(results[names[0]]["per_class_recall"])
    for lab in labels:
        vals = [float(np.mean(results[n]["per_class_recall"][lab])) * 100 for n in names]
        base = vals[0]
        cells = "".join(f"{v:>11.1f}%" for v in vals)
        best = max(vals[1:]) if len(vals) > 1 else base
        if best > base + 1e-9:
            verdict = f"  +{best - base:.1f} improved"
        elif best < base - 1e-9:
            verdict = f"  {best - base:.1f} REGRESSED"
        else:
            verdict = "   unchanged"
        print(f"  {lab:<20} {cells}{verdict}")

    print()
    for n in names:
        r = results[n]
        print(f"  {n:<10} overall {r['accuracy_mean'] * 100:5.1f}% +/- {r['accuracy_std'] * 100:.1f}%")

    with open(args.out, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nWrote {args.out}")
    print("\nShip a variant ONLY if it improves the two-handed words with no")
    print("regression elsewhere — the previous attempt fixed two-handed signs and")
    print("broke one-handed ones, which is why it was reverted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
