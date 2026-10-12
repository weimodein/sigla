"""
Words-model experiment (Phase 0, offline only): leave-one-signer-out on the
word classes, comparing the current LSTM with the ideas that helped letters.

Nothing here touches production. It reads a pickled copy of /api/ml/dataset
(made once with fetch_approved_samples) so every variant sees the same data.

Per test signer g:
  * the other three signers train; one of them (v) is the early-stopping /
    tuning signer, so nothing is ever chosen on g;
  * the network is scored on g directly (no refit on all three), so the
    number is honest and comparable across variants;
  * the linear model is tuned (C) on v, then refitted on all three signers.

Variants (--variants):
  linear       logistic regression on per-clip summary features
  conv         Conv1D on the 147 coordinates
  conv_dist    Conv1D on coordinates + per-frame pairwise hand distances
  lstm         the production LSTM (train.py build_motion_model), unchanged
  lstm_dist    the production LSTM on coordinates + distances
  <net>_refit  refit that network on all three training signers for the
               epochs it chose (what production does); needs <net> first

Each finished (variant, signer) is saved to --out-dir and skipped on re-run,
so the run can be stopped at any time and resumed. --deadline HH:MM stops a
training cleanly (unsaved) when the clock passes it.

    venv/Scripts/python.exe tools/words_experiment.py --data dataset.pkl \
        --out-dir words_exp --variants linear conv conv_dist lstm --deadline 06:30
    venv/Scripts/python.exe tools/words_experiment.py --out-dir words_exp --report
"""

import argparse
import datetime as dt
import json
import os
import pickle
import sys
import time
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# train.py imports the Supabase client for model uploads, which needs secrets
# this offline experiment must never use. A stub keeps uploads impossible.
import types  # noqa: E402


def _no_upload(*_args, **_kwargs):
    raise RuntimeError("words_experiment.py is offline; uploads are disabled")


sys.modules["app.utils.supabase_client"] = types.SimpleNamespace(
    upload_file=_no_upload, BUCKET_MODELS="models")

from app.utils.preprocessor import (  # noqa: E402
    _load_real_sequences,
    mirror_sequence,
    prepare_motion_dataset,
)

POINTS = 21
_IU = np.triu_indices(POINTS, 1)
BLEND_WEIGHTS = (0.3, 0.5, 0.7)      # weight on the linear model; 0.7 was the letters value
LINEAR_CS = (0.01, 0.1, 1.0)


# ── features ────────────────────────────────────────────────────────────────

def hand_distances(x: np.ndarray) -> np.ndarray:
    """[..., 147] -> [..., 420]: every pairwise 3D distance between the 21 points
    of each hand. Stored hands are already wrist-centred and size-scaled per
    frame, so these are rotation-invariant hand-shape numbers. A missing hand
    (all zeros) gives zeros."""
    out = []
    for h in range(2):
        p = x[..., h * 63:(h + 1) * 63].reshape(*x.shape[:-1], POINTS, 3)
        d = np.linalg.norm(p[..., _IU[0], :] - p[..., _IU[1], :], axis=-1)
        out.append(d)
    return np.concatenate(out, axis=-1).astype("float32")


def with_distances(x: np.ndarray) -> np.ndarray:
    return np.concatenate([x, hand_distances(x)], axis=-1)


def summary_features(x: np.ndarray) -> np.ndarray:
    """[N, 30, 147] -> [N, 4 x 567]: mean of each third of the window (keeps the
    order of the movement) plus the std over the whole window."""
    f = with_distances(x)
    thirds = np.array_split(np.arange(f.shape[1]), 3)
    parts = [f[:, t].mean(axis=1) for t in thirds] + [f.std(axis=1)]
    return np.concatenate(parts, axis=1)


# ── models ──────────────────────────────────────────────────────────────────

def build_conv(n_classes: int, n_features: int):
    """Conv1D like the letters J/Z model: plain TFLite builtins, no Flex ops."""
    from tensorflow import keras
    reg = keras.regularizers.l2(2e-4)
    model = keras.Sequential([
        keras.layers.Input(shape=(30, n_features)),
        keras.layers.Conv1D(128, 5, padding="same", activation="relu", kernel_regularizer=reg),
        keras.layers.Dropout(0.3),
        keras.layers.Conv1D(128, 5, padding="same", activation="relu", kernel_regularizer=reg),
        keras.layers.MaxPool1D(2),
        keras.layers.Conv1D(128, 3, padding="same", activation="relu", kernel_regularizer=reg),
        keras.layers.GlobalAveragePooling1D(),
        keras.layers.Dropout(0.4),
        keras.layers.Dense(64, activation="relu", kernel_regularizer=reg),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(n_classes, activation="softmax"),
    ], name="words_conv")
    model.compile(optimizer=keras.optimizers.Adam(learning_rate=0.0005),
                  loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return model


def build_lstm(n_classes: int, n_features: int):
    """The production LSTM; only the input width changes for lstm_dist."""
    import app.services.train as T
    old = T.FEATURE_SIZE
    T.FEATURE_SIZE = n_features
    try:
        return T.build_motion_model(n_classes, arch="lstm")
    finally:
        T.FEATURE_SIZE = old


class Deadline(Exception):
    pass


def deadline_callback(deadline):
    from tensorflow import keras

    class Stop(keras.callbacks.Callback):
        def on_epoch_end(self, epoch, logs=None):
            if deadline and dt.datetime.now() >= deadline:
                self.model.stop_training = True
                self.model._hit_deadline = True
    return Stop()


# ── one fold ────────────────────────────────────────────────────────────────

def split_signers(words: dict, signers: list, test: str):
    """Dataset dicts for the three training signers and for the test signer."""
    def keep(want):
        return {k: [s for s in v if str(s.get("session_id")).strip().casefold() in want]
                for k, v in words.items()}
    return keep({s for s in signers if s != test}), keep({test})


def real_arrays(dataset: dict, labels: list):
    real, groups = _load_real_sequences(dataset, with_groups=True)
    xs, ys, gs = [], [], []
    for i, lab in enumerate(labels):
        for s, g in zip(real.get(lab, []), groups.get(lab, [])):
            xs.append(s)
            ys.append(i)
            gs.append(g)
    return np.stack(xs).astype("float32"), np.array(ys), np.array(gs)


def run_network(variant, train_ds, test_x, labels, val_signer_index, seed, deadline):
    from tensorflow import keras
    from sklearn.utils.class_weight import compute_class_weight
    from app.services.train import set_global_seed

    set_global_seed(seed)
    X_tr, y_tr, X_va, y_va, label_map, real_counts = prepare_motion_dataset(
        train_ds, fold=val_signer_index, group_by_session=True, random_state=seed)
    assert [label_map[i] for i in range(len(label_map))] == labels, "label order drifted"

    feat = with_distances if variant.endswith("_dist") else (lambda a: a)
    X_tr, X_va, X_te = feat(X_tr), feat(X_va), feat(test_x)
    build = build_conv if variant.startswith("conv") else build_lstm
    model = build(len(labels), X_tr.shape[-1])

    present = np.array(sorted(real_counts), dtype=np.int64)
    real_y = np.concatenate([np.full(real_counts[c], c) for c in present])
    cw = compute_class_weight("balanced", classes=present, y=real_y)

    t0 = time.time()
    hist = model.fit(
        X_tr, y_tr, validation_data=(X_va, y_va), epochs=200, batch_size=32,
        class_weight={int(c): float(w) for c, w in zip(present, cw)},
        callbacks=[keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=20,
                                                 restore_best_weights=True),
                   deadline_callback(deadline)],
        verbose=0)
    if getattr(model, "_hit_deadline", False):
        keras.backend.clear_session()
        raise Deadline()
    out = {
        "p_test": model.predict(X_te, verbose=0),
        "p_val": model.predict(X_va, verbose=0),
        "y_val": y_va,
        "epochs": int(np.argmax(hist.history["val_accuracy"]) + 1),
        "epochs_run": len(hist.history["val_accuracy"]),
        "seconds": time.time() - t0,
    }
    keras.backend.clear_session()
    return out


def run_refit(variant, train_ds, test_x, labels, epochs, seed, deadline):
    """What production does: refit on ALL three training signers for the epoch
    count the base variant chose on its tuning signer, then score the test
    signer. Puts the network on the same training data as the linear model."""
    from tensorflow import keras
    from sklearn.utils.class_weight import compute_class_weight
    from app.services.train import set_global_seed

    set_global_seed(seed)
    X_tr, y_tr, _, _, label_map, real_counts = prepare_motion_dataset(
        train_ds, train_all=True, random_state=seed)
    assert [label_map[i] for i in range(len(label_map))] == labels, "label order drifted"

    feat = with_distances if "_dist" in variant else (lambda a: a)
    X_tr, X_te = feat(X_tr), feat(test_x)
    build = build_conv if variant.startswith("conv") else build_lstm
    model = build(len(labels), X_tr.shape[-1])

    present = np.array(sorted(real_counts), dtype=np.int64)
    real_y = np.concatenate([np.full(real_counts[c], c) for c in present])
    cw = compute_class_weight("balanced", classes=present, y=real_y)

    t0 = time.time()
    model.fit(X_tr, y_tr, epochs=epochs, batch_size=32,
              class_weight={int(c): float(w) for c, w in zip(present, cw)},
              callbacks=[deadline_callback(deadline)], verbose=0)
    if getattr(model, "_hit_deadline", False):
        keras.backend.clear_session()
        raise Deadline()
    out = {"p_test": model.predict(X_te, verbose=0), "epochs": epochs,
           "seconds": time.time() - t0}
    keras.backend.clear_session()
    return out


def fit_linear(x, y, C, n_classes):
    from sklearn.linear_model import LogisticRegression
    xm = np.concatenate([x, np.stack([mirror_sequence(s) for s in x])])
    ym = np.tile(y, 2)
    f = summary_features(xm)
    mu, sd = f.mean(0), f.std(0) + 1e-6
    lr = LogisticRegression(C=C, max_iter=2000).fit((f - mu) / sd, ym)

    def predict(xx):
        p = np.zeros((len(xx), n_classes), dtype="float32")
        p[:, lr.classes_] = lr.predict_proba((summary_features(xx) - mu) / sd)
        return p
    return predict


def run_linear(train_x, train_y, train_g, test_x, val_signer, n_classes):
    t0 = time.time()
    tr, va = train_g != val_signer, train_g == val_signer
    scores = {}
    for C in LINEAR_CS:
        p = fit_linear(train_x[tr], train_y[tr], C, n_classes)(train_x[va])
        scores[C] = float((p.argmax(1) == train_y[va]).mean())
    best = max(LINEAR_CS, key=lambda c: (scores[c], -c))
    predict = fit_linear(train_x, train_y, best, n_classes)
    return {"p_test": predict(test_x), "C": best, "val_scores": scores,
            "seconds": time.time() - t0}


# ── report ──────────────────────────────────────────────────────────────────

def load_results(out_dir):
    meta = json.load(open(os.path.join(out_dir, "meta.json")))
    res = {}
    for name in os.listdir(out_dir):
        if name.endswith(".npz"):
            variant, signer = name[:-4].split("__")
            res.setdefault(variant, {})[signer] = dict(np.load(os.path.join(out_dir, name)))
    return meta, res


def score(meta, per_signer):
    labels = meta["labels"]
    folds, true, pred = {}, [], []
    for s, r in sorted(per_signer.items()):
        y, p = meta["y_test"][s], r["p_test"].argmax(1)
        folds[s] = round(float((p == np.array(y)).mean()), 4)
        true += list(y)
        pred += list(p)
    true, pred = np.array(true), np.array(pred)
    recall = {labels[i]: round(float((pred[true == i] == i).mean()), 4)
              for i in range(len(labels)) if (true == i).any()}
    conf = Counter((labels[t], labels[p]) for t, p in zip(true, pred) if t != p)
    return {
        "mean_signer_accuracy": round(float(np.mean(list(folds.values()))), 4),
        "per_signer": folds,
        "worst_classes": sorted(recall.items(), key=lambda kv: kv[1])[:10],
        "classes_below_70": sum(v < 0.7 for v in recall.values()),
        "top_confusions": [f"{n}x {t} -> {p}" for (t, p), n in conf.most_common(10)],
        "per_class_recall": recall,
    }


def report(out_dir):
    meta, res = load_results(out_dir)
    signers = meta["signers"]
    table = {}
    for v, per in res.items():
        if set(per) == set(signers):
            table[v] = score(meta, per)
    if "linear" in res and set(res["linear"]) == set(signers):
        for v in [k for k in table if k != "linear"]:
            for w in BLEND_WEIGHTS:
                table[f"{v}+linear@{w}"] = score(meta, {
                    s: {"p_test": w * res["linear"][s]["p_test"] + (1 - w) * res[v][s]["p_test"]}
                    for s in signers})
    partial = {v: sorted(per) for v, per in res.items() if set(per) != set(signers)}
    print(f"{'variant':<24} {'mean':>6}  " + "  ".join(f"{s[-2:]:>5}" for s in signers)
          + "  <70%")
    for v, r in sorted(table.items(), key=lambda kv: -kv[1]["mean_signer_accuracy"]):
        print(f"{v:<24} {r['mean_signer_accuracy'] * 100:5.1f}%  "
              + "  ".join(f"{r['per_signer'][s] * 100:5.1f}" for s in signers)
              + f"  {r['classes_below_70']:>4}")
    if partial:
        print("unfinished:", partial)
    json.dump(table, open(os.path.join(out_dir, "report.json"), "w"), indent=1)
    print(f"wrote {os.path.join(out_dir, 'report.json')}")


# ── main ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", help="pickle of fetch_approved_samples()")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--variants", nargs="+", default=["linear", "conv", "conv_dist", "lstm"],
                    choices=("linear", "conv", "conv_dist", "lstm", "lstm_dist",
                             "conv_refit", "conv_dist_refit", "lstm_refit", "lstm_dist_refit"))
    ap.add_argument("--deadline", help="HH:MM; stop cleanly when passed (next day if earlier than now)")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    if args.report:
        report(args.out_dir)
        return 0

    deadline = None
    if args.deadline:
        hh, mm = map(int, args.deadline.split(":"))
        now = dt.datetime.now()
        deadline = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if deadline <= now:
            deadline += dt.timedelta(days=1)
        print(f"[exp] deadline {deadline:%Y-%m-%d %H:%M}", flush=True)

    dataset = pickle.load(open(args.data, "rb"))
    # Words only: the 26 single-letter classes still have 30x147 windows in the
    # same table and would turn this into a 109-class problem.
    words = {k: [s for s in v if s.get("sequence")] for k, v in dataset.items() if len(k) > 1}
    words = {k: v for k, v in words.items() if v}
    labels = sorted(words)
    signers = sorted({str(s.get("session_id")).strip().casefold()
                      for v in words.values() for s in v})
    print(f"[exp] {len(labels)} words, {sum(map(len, words.values()))} samples, "
          f"signers {signers}", flush=True)

    os.makedirs(args.out_dir, exist_ok=True)
    folds = {}
    for i, test in enumerate(signers):
        train_ds, test_ds = split_signers(words, signers, test)
        tx, ty, _ = real_arrays(test_ds, labels)
        rx, ry, rg = real_arrays(train_ds, labels)
        others = [s for s in signers if s != test]
        vi = i % len(others)
        folds[test] = dict(train_ds=train_ds, tx=tx, ty=ty, rx=rx, ry=ry, rg=rg,
                           vi=vi, val=others[vi])
    json.dump({"labels": labels, "signers": signers,
               "val_signer": {s: f["val"] for s, f in folds.items()},
               "y_test": {s: f["ty"].tolist() for s, f in folds.items()}},
              open(os.path.join(args.out_dir, "meta.json"), "w"))

    for variant in args.variants:
        for i, test in enumerate(signers):
            path = os.path.join(args.out_dir, f"{variant}__{test}.npz")
            if os.path.exists(path):
                continue
            f = folds[test]
            print(f"[exp] {dt.datetime.now():%H:%M} {variant} test={test} val={f['val']} ...",
                  flush=True)
            try:
                if variant.endswith("_refit"):
                    base = os.path.join(args.out_dir, f"{variant[:-6]}__{test}.npz")
                    if not os.path.exists(base):
                        print(f"[exp]   skipped: needs {os.path.basename(base)} first")
                        continue
                    r = run_refit(variant, f["train_ds"], f["tx"], labels,
                                  int(np.load(base)["epochs"]), seed=42 + i,
                                  deadline=deadline)
                elif variant == "linear":
                    r = run_linear(f["rx"], f["ry"], f["rg"], f["tx"], f["val"], len(labels))
                    r["val_scores"] = json.dumps(r["val_scores"])
                else:
                    r = run_network(variant, f["train_ds"], f["tx"], labels, f["vi"],
                                    seed=42 + i, deadline=deadline)
            except Deadline:
                print("[exp] deadline reached; this fold is not saved. Re-run to resume.")
                return 0
            acc = float((r["p_test"].argmax(1) == f["ty"]).mean())
            np.savez(path, **r)
            extra = {k: r[k] for k in ("epochs", "epochs_run", "C") if k in r}
            print(f"[exp]   {test}: {acc * 100:.1f}%  ({r['seconds'] / 60:.1f} min) {extra}",
                  flush=True)
    report(args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
