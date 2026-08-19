"""
Honest accuracy measurement via stratified K-fold cross-validation.

WHY THIS EXISTS
---------------
train.py reports `max(history.history["val_accuracy"])` -- the maximum over 200
epochs on the SAME split that EarlyStopping(restore_best_weights=True) used to
select the weights. That is an optimistic maximum by construction: it is the best
epoch on the selection set, not performance on unseen data. test.py then re-derives
the identical split (same random_state=42) and reports it again as "evaluation".

So there is currently no number in the pipeline that measures generalization.

This script provides one. Each fold trains from scratch and predicts a held-out
portion the model never saw, so every sample is scored exactly once. It reports
per-class recall as mean +/- std across folds -- the spread matters as much as the
mean: at ~20 samples/class a 3-point difference between two runs is usually noise,
and without the std you cannot tell whether a change (e.g. Stage 2's augmentation
fixes) actually helped.

Why K-fold instead of a 3-way train/val/test split: a 60/20/20 split would cost
~4 real training sequences per class (16.8 -> 12.6 at 206 samples / 10 classes),
and training data is the binding constraint on accuracy here. K-fold keeps every
sample in training for most folds.

CAVEATS (read before trusting the number)
-----------------------------------------
* Single signer. All samples come from one person in one session, so this measures
  "accuracy for this signer" and overstates performance for anyone else. Swap
  KFold for StratifiedGroupKFold grouped on session_id once a second signer exists.
* Trains K models. Slow -- roughly K x a normal training run.

USAGE
    venv/Scripts/python.exe tools/cross_validate.py                # 5 folds
    venv/Scripts/python.exe tools/cross_validate.py --folds 5 --repeats 2
    venv/Scripts/python.exe tools/cross_validate.py --out cv_baseline.json
"""

import argparse
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.preprocessor import (  # noqa: E402
    fetch_approved_samples,
    prepare_motion_dataset,
)


def run_fold(motion_dataset, fold, n_splits, seed, epochs, quiet=True,
             group_by_session=False):
    """Train one fold from scratch; return (y_true, y_pred, label_map)."""
    from tensorflow import keras
    from app.services.train import build_motion_model, set_global_seed
    from sklearn.utils.class_weight import compute_class_weight

    # Seed per fold so the whole run is reproducible while folds stay independent.
    # Without this, weight init varied run to run and a re-run of the SAME config
    # could differ by as much as a real improvement would.
    set_global_seed(seed * 1000 + fold)

    X_tr, y_tr, X_va, y_va, label_map, real_counts = prepare_motion_dataset(
        motion_dataset, fold=fold, n_splits=n_splits, random_state=seed,
        group_by_session=group_by_session,
    )
    if len(X_va) == 0:
        return None, None, label_map

    model = build_motion_model(len(label_map))

    # Match train.py: weight from real pre-augmentation counts, not augmented labels.
    classes_present = np.array(sorted(real_counts.keys()), dtype=np.int64)
    real_labels = np.concatenate([
        np.full(real_counts[c], c, dtype=np.int64) for c in classes_present
    ])
    cw = compute_class_weight("balanced", classes=classes_present, y=real_labels)

    model.fit(
        X_tr, y_tr,
        validation_data=(X_va, y_va),
        epochs=epochs,
        batch_size=32,
        class_weight={int(c): float(w) for c, w in zip(classes_present, cw)},
        callbacks=[keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=20, restore_best_weights=True)],
        verbose=0 if quiet else 1,
    )
    y_pred = np.argmax(model.predict(X_va, verbose=0), axis=1)
    keras.backend.clear_session()
    return y_va, y_pred, label_map


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--repeats", type=int, default=1,
                    help="repeat the whole K-fold with a different seed each time")
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--out", default=None, help="write results as JSON")
    ap.add_argument("--group-by-session", action="store_true",
                    help="hold out whole signers per fold (leave-one-signer-out) using "
                         "gesture_samples.session_id. This is the number that reflects "
                         "how the model performs for a NEW signer; the ungrouped "
                         "default overstates it.")
    args = ap.parse_args()

    dataset = fetch_approved_samples()
    motion_dataset = {k: [s for s in v if "sequence" in s] for k, v in dataset.items()}
    motion_dataset = {k: v for k, v in motion_dataset.items() if v}

    if len(motion_dataset) < 2:
        print(f"Need >=2 classes, found {len(motion_dataset)}")
        return 1

    per_fold_acc = []
    recall_runs = defaultdict(list)      # label -> [recall per fold]
    confusion = defaultdict(int)         # (true, pred) -> count
    label_map = {}

    total = args.folds * args.repeats
    done = 0
    for rep in range(args.repeats):
        seed = 42 + rep
        for fold in range(args.folds):
            done += 1
            print(f"[cv] fold {done}/{total} (repeat {rep + 1}, fold {fold}) ...",
                  flush=True)
            y_true, y_pred, label_map = run_fold(
                motion_dataset, fold, args.folds, seed, args.epochs,
                group_by_session=args.group_by_session,
            )
            if y_true is None:
                print("[cv]   skipped - no validation samples in this fold")
                continue

            per_fold_acc.append(float((y_true == y_pred).mean()))

            for i, lab in label_map.items():
                mask = y_true == i
                if mask.sum():
                    recall_runs[lab].append(float((y_pred[mask] == i).mean()))
            for t, p in zip(y_true, y_pred):
                if t != p:
                    confusion[(label_map[int(t)], label_map[int(p)])] += 1

    if not per_fold_acc:
        print("No folds produced validation data.")
        return 1

    acc_mean, acc_std = float(np.mean(per_fold_acc)), float(np.std(per_fold_acc))

    print()
    print("=" * 62)
    print(f"CROSS-VALIDATED ACCURACY  {acc_mean * 100:.1f}% +/- {acc_std * 100:.1f}%"
          f"   ({len(per_fold_acc)} folds)")
    print("=" * 62)
    print()
    print("Per-class recall (mean +/- std across folds):")
    print(f"  {'word':<20} {'recall':>8}  {'std':>6}")
    print(f"  {'-' * 20} {'-' * 8}  {'-' * 6}")

    rows = sorted(recall_runs.items(), key=lambda kv: np.mean(kv[1]))
    for lab, vals in rows:
        m, s = np.mean(vals) * 100, np.std(vals) * 100
        mark = "  <-- weakest" if m < acc_mean * 100 - 10 else ""
        print(f"  {lab:<20} {m:>7.1f}%  {s:>5.1f}{mark}")

    if confusion:
        print()
        print("Top confusions (true -> predicted, summed over folds):")
        for (t, p), n in sorted(confusion.items(), key=lambda kv: (-kv[1], kv[0]))[:10]:
            print(f"  {n:>3}x  {t} -> {p}")

    print()
    if args.group_by_session:
        print("NOTE: SIGNER-GROUPED folds -- each fold held out a whole signer, so this")
        print("      estimates accuracy for a NEW signer. Expect it BELOW the ungrouped")
        print("      number; that gap is the real generalization cost, not a regression.")
    else:
        print("NOTE: ungrouped folds -- the same signer appears in both train and test,")
        print("      so this overstates performance for a new user. Re-run with")
        print("      --group-by-session for a generalization estimate.")

    if args.out:
        with open(args.out, "w") as f:
            json.dump({
                "accuracy_mean": acc_mean,
                "accuracy_std": acc_std,
                "folds": len(per_fold_acc),
                "per_fold_accuracy": per_fold_acc,
                "per_class_recall": {k: v for k, v in recall_runs.items()},
                "confusions": {f"{t} -> {p}": n for (t, p), n in confusion.items()},
            }, f, indent=2)
        print(f"\nWrote {args.out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
