"""
Pose A/B — does the 21-float pose block (features 126..146) actually help?

Trains two models on the SAME honest split (real clips split before augmentation,
seed 42, identical to train.py) and evaluates both on the same real held-out clips:
  A) full 147 features (hands + pose)
  B) the same data sliced to the first 126 features (hands only)
Slicing is a faithful simulation of the old pipeline: pose normalization never
touches hand indices, so X[:, :, :126] is byte-identical to what the 126-feature
pipeline would produce.

NOTE: LOSO would be the better metric, but the dataset currently has one signer,
so the held-out-clip split is the best honest comparison available.

Usage (from sigla-ml/, venv active, backend reachable):
    python pose_ab_eval.py
"""
import numpy as np
from sklearn.metrics import accuracy_score

from app.utils.preprocessor import fetch_approved_samples, prepare_motion_dataset_split
from app.services.train import build_motion_model


def _train_eval(X_tr, y_tr, X_te, y_te, num_classes, tag):
    from tensorflow import keras
    from sklearn.utils.class_weight import compute_class_weight

    model = build_motion_model(num_classes, feature_size=X_tr.shape[2])
    cw = compute_class_weight("balanced", classes=np.unique(y_tr), y=y_tr)
    cb = [keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=20,
                                        restore_best_weights=True)]
    model.fit(X_tr, y_tr, validation_data=(X_te, y_te), epochs=200, batch_size=32,
              callbacks=cb, class_weight=dict(enumerate(cw)), verbose=0)
    preds = np.argmax(model.predict(X_te, verbose=0), axis=1)
    acc = accuracy_score(y_te, preds)
    print(f"[{tag}] held-out accuracy = {acc*100:5.1f}%  ({int((preds == y_te).sum())}/{len(y_te)})")
    return preds, acc


def main():
    dataset = fetch_approved_samples()
    X_tr, y_tr, X_te, y_te, label_map = prepare_motion_dataset_split(dataset, seed=42)
    if X_te.shape[0] == 0:
        print("Held-out test set is empty — cannot A/B. Collect more clips per word.")
        return
    num_classes = len(label_map)

    print("\n--- A: 147 features (hands + pose) ---")
    preds_a, acc_a = _train_eval(X_tr, y_tr, X_te, y_te, num_classes, "147 hands+pose")

    print("\n--- B: 126 features (hands only, same clips) ---")
    preds_b, acc_b = _train_eval(X_tr[:, :, :126], y_tr, X_te[:, :, :126], y_te,
                                 num_classes, "126 hands-only")

    print("\n" + "=" * 60)
    print(f"147 (pose): {acc_a*100:5.1f}%   126 (no pose): {acc_b*100:5.1f}%   "
          f"delta: {(acc_a-acc_b)*100:+.1f} pts")
    print("=" * 60)
    print("\nPer-class breakdown (true label: 147-correct / 126-correct / clips):")
    for i in sorted(label_map.keys()):
        mask = y_te == i
        if not mask.any():
            continue
        ca = int((preds_a[mask] == i).sum())
        cb_ = int((preds_b[mask] == i).sum())
        print(f"  {label_map[i]:<20} {ca:>2} / {cb_:>2} / {int(mask.sum())}")
    print("\nCaveat: single-seed comparison on a small held-out set; treat small "
          "deltas (<~3 pts) as noise. On-device A/B is the final word.")


if __name__ == "__main__":
    main()
