"""
Leave-One-Signer-Out (LOSO) evaluation — the honest "works on an unseen person" metric.

For each distinct signer, train a fresh model on ALL OTHER signers and evaluate on the
held-out signer's real clips. Reports per-signer accuracy and the average. This is the
metric that matters for a deployable app: it directly measures generalization to a person
the model has never seen.

NOTE: this trains one model per signer, so it is slower than a normal train. It is a
DIAGNOSTIC you run on demand — it does not touch the deployed model.

Usage (from sigla-ml/, with the venv active and the backend reachable):
    python loso_eval.py
"""
import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix

from app.utils.preprocessor import (
    fetch_approved_samples,
    list_signers,
    prepare_loso_split,
)
from app.services.train import build_motion_model


def _train_and_eval(X_train, y_train, X_test, y_test, num_classes):
    from tensorflow import keras
    model = build_motion_model(num_classes)
    cb = [keras.callbacks.EarlyStopping(monitor="loss", patience=15, restore_best_weights=True)]
    model.fit(X_train, y_train, epochs=200, batch_size=32, callbacks=cb, verbose=0)
    preds = np.argmax(model.predict(X_test, verbose=0), axis=1)
    return preds


def main():
    dataset = fetch_approved_samples()
    signers = list_signers(dataset)
    print(f"Distinct signers: {len(signers)} -> {signers}")
    if len(signers) < 2:
        print("Need at least 2 distinct signers for LOSO. Collect clips from more people.")
        return

    labels = sorted(dataset.keys())
    per_signer_acc = {}
    all_true, all_pred = [], []

    for holdout in signers:
        X_tr, y_tr, X_te, y_te, label_map = prepare_loso_split(dataset, holdout)
        if X_te.shape[0] == 0:
            print(f"[signer {holdout}] no clips — skipping")
            continue
        preds = _train_and_eval(X_tr, y_tr, X_te, y_te, len(labels))
        acc = accuracy_score(y_te, preds)
        per_signer_acc[holdout] = (acc, X_te.shape[0])
        all_true.extend(y_te.tolist())
        all_pred.extend(preds.tolist())
        print(f"[held-out signer {holdout}] accuracy = {acc*100:5.1f}%  "
              f"({int((preds==y_te).sum())}/{X_te.shape[0]} clips)")

    if not per_signer_acc:
        print("No signer had held-out clips — cannot compute LOSO.")
        return

    # Weighted average across all held-out clips = overall unseen-signer accuracy.
    total_correct = sum(int(round(a*n)) for a, n in per_signer_acc.values())
    total_clips   = sum(n for _, n in per_signer_acc.values())
    print("\n" + "=" * 50)
    print(f"LOSO overall unseen-signer accuracy: {total_correct/total_clips*100:5.1f}% "
          f"({total_correct}/{total_clips})")
    print("=" * 50)

    # Confusion matrix across all held-out predictions.
    label_map = {i: l for i, l in enumerate(labels)}
    cm = confusion_matrix(all_true, all_pred, labels=list(range(len(labels))))
    print("\nLOSO confusion matrix (row = true, col = predicted):")
    for i, row in enumerate(cm):
        print(f"{i:>2} {label_map[i][:14]:<14}" + "".join(f"{v:>5}" for v in row))
    print("\nLegend:")
    for i, l in enumerate(labels):
        print(f"  {i:>2} = {l}")


if __name__ == "__main__":
    main()
