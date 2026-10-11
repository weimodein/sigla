"""Letters models: a per-frame hand-shape classifier (static letters) and a
Conv1D movement classifier (J, Z, _none), exported together as ONE .tflite with
two signatures so the backend keeps storing "the letters model".

Design: docs-internal/specs/2026-10-11-letters-accuracy-design.md
"""
from __future__ import annotations

import os
import tempfile
from collections import Counter
from dataclasses import dataclass

import numpy as np
import tensorflow as tf
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix,
                             f1_score, precision_score, recall_score)

from app.utils import letters as L

EPS = 1e-6
SEED = int(os.getenv("TRAIN_SEED", 42))
STATIC_EPOCHS = int(os.getenv("LETTERS_STATIC_EPOCHS", 60))
MOTION_EPOCHS = int(os.getenv("LETTERS_MOTION_EPOCHS", 50))
STATIC_AUG_COPIES = int(os.getenv("LETTERS_STATIC_AUG_COPIES", 2))
MOTION_AUG_COPIES = int(os.getenv("LETTERS_MOTION_AUG_COPIES", 3))


# ── models ──────────────────────────────────────────────────────────────────

@tf.keras.utils.register_keras_serializable(package="sigla")
class WristNormalize(tf.keras.layers.Layer):
    """[B, 21, 3] -> minus the wrist, divided by the largest 2D wrist distance."""

    def call(self, x):
        rel = x - x[:, 0:1, :]
        size = tf.reduce_max(tf.norm(rel[..., :2], axis=-1), axis=-1)
        return rel / (size[:, None, None] + EPS)


@tf.keras.utils.register_keras_serializable(package="sigla")
class SequenceNormalize(tf.keras.layers.Layer):
    """[B, T, 21, 3] -> minus FRAME 0's wrist, divided by FRAME 0's hand size,
    so the path of the movement survives."""

    def call(self, x):
        rel = x - x[:, 0:1, 0:1, :]
        size0 = tf.reduce_max(tf.norm(rel[:, 0, :, :2], axis=-1), axis=-1)
        return rel / (size0[:, None, None, None] + EPS)


def build_static_model(n_classes: int) -> tf.keras.Model:
    inp = tf.keras.Input(shape=(L.FLOATS,), name="landmarks")
    x = tf.keras.layers.Reshape((L.POINTS, 3))(inp)
    x = WristNormalize()(x)
    x = tf.keras.layers.Flatten()(x)
    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    x = tf.keras.layers.Dense(64, activation="relu")(x)
    out = tf.keras.layers.Dense(n_classes, activation="softmax")(x)
    return tf.keras.Model(inp, out, name="sigla_letters_static")


def build_motion_model(n_classes: int) -> tf.keras.Model:
    """Conv1D, not LSTM: plain TFLite builtins, no Flex ops."""
    inp = tf.keras.Input(shape=(L.MOTION_FRAMES, L.FLOATS), name="frames")
    x = tf.keras.layers.Reshape((L.MOTION_FRAMES, L.POINTS, 3))(inp)
    x = SequenceNormalize()(x)
    x = tf.keras.layers.Reshape((L.MOTION_FRAMES, L.FLOATS))(x)
    x = tf.keras.layers.Conv1D(64, 5, padding="same", activation="relu")(x)
    x = tf.keras.layers.Conv1D(64, 5, padding="same", activation="relu")(x)
    x = tf.keras.layers.MaxPool1D(2)(x)
    x = tf.keras.layers.Conv1D(128, 3, padding="same", activation="relu")(x)
    x = tf.keras.layers.GlobalMaxPool1D()(x)
    x = tf.keras.layers.Dense(64, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    out = tf.keras.layers.Dense(n_classes, activation="softmax")(x)
    return tf.keras.Model(inp, out, name="sigla_letters_motion")


# ── augmentation ────────────────────────────────────────────────────────────

def _pts(a):
    return np.asarray(a, dtype="float32").reshape(*np.shape(a)[:-1], L.POINTS, 3)


def mirror(a):
    """Left/right flip. Normalisation subtracts the wrist, so -x is enough."""
    p = _pts(a).copy()
    p[..., 0] = -p[..., 0]
    return p.reshape(np.shape(a))


def rotate_scale_noise(a, rng, max_deg=15.0, scale=0.10, noise=0.004):
    """One rotation (xy, about the first wrist), scale and Gaussian noise. A
    sequence gets the same rotation and scale in every frame."""
    p = _pts(a).copy()
    origin = p.reshape(-1, L.POINTS, 3)[0, 0].copy()
    theta = np.deg2rad(rng.uniform(-max_deg, max_deg))
    s = 1.0 + rng.uniform(-scale, scale)
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], dtype="float32")
    rel = p - origin
    rel[..., :2] = rel[..., :2] @ rot.T
    out = origin + rel * s + rng.normal(0, noise, size=p.shape).astype("float32")
    return out.astype("float32").reshape(np.shape(a))


def time_warp(seq, rng, amount=0.2):
    """Smooth monotonic speed change. seq is [T, 63]."""
    t = seq.shape[0]
    u = np.linspace(0.0, 1.0, t)
    amp = rng.uniform(-amount, amount)
    warped = np.clip(u + amp * np.sin(2 * np.pi * u) / (2 * np.pi), 0.0, 1.0)
    pos = warped * (t - 1)
    base = np.arange(t)
    return np.stack([np.interp(pos, base, seq[:, j]) for j in range(seq.shape[1])], axis=1).astype("float32")


def augment_static(x, y, rng, copies=STATIC_AUG_COPIES):
    parts = [x, mirror(x)]
    for _ in range(copies):
        for base in (x, mirror(x)):
            parts.append(np.stack([rotate_scale_noise(r, rng) for r in base]))
    return np.concatenate(parts).astype("float32"), np.tile(y, len(parts))


def augment_motion(x, y, rng, copies=MOTION_AUG_COPIES):
    xs, ys = [], []
    for seq, lab in zip(x, y):
        xs += [seq, mirror(seq)]
        ys += [lab, lab]
        for _ in range(copies):
            a = rotate_scale_noise(time_warp(seq, rng), rng)
            xs.append(mirror(a) if rng.random() < 0.5 else a)
            ys.append(lab)
    return np.stack(xs).astype("float32"), np.asarray(ys)


# ── data ────────────────────────────────────────────────────────────────────

@dataclass
class LetterSample:
    label: str
    group: str
    frames: list


@dataclass
class Part:
    x: np.ndarray
    y: np.ndarray
    clip: np.ndarray    # index into the sample list; -1 for _none movements
    group: np.ndarray


@dataclass
class LetterData:
    labels: list
    static_labels: list
    motion_labels: list
    static: Part
    motion: Part


def build_dataset(samples: list, labels: list) -> LetterData:
    labels = sorted(labels)
    static_labels = [l for l in labels if l not in L.MOTION_LETTERS]
    motion_labels = [L.NONE_LABEL] + [l for l in labels if l in L.MOTION_LETTERS]
    s = ([], [], [], [])
    m = ([], [], [], [])
    for i, smp in enumerate(samples):
        if smp.label not in labels:
            continue
        if smp.label in L.MOTION_LETTERS:
            take = L.find_single_take(smp.frames)
            if take is None:
                continue
            for part, v in zip(m, (L.segment_array(take.sign), motion_labels.index(smp.label), i, smp.group)):
                part.append(v)
            for r in take.rest:
                for part, v in zip(m, (L.segment_array(r), 0, -1, smp.group)):
                    part.append(v)
        else:
            for h in L.static_samples(smp.frames):
                for part, v in zip(s, (h, static_labels.index(smp.label), i, smp.group)):
                    part.append(v)
            for seg in L.motion_segments(smp.frames):
                for part, v in zip(m, (seg, 0, -1, smp.group)):
                    part.append(v)

    def make(p, shape):
        return Part(np.asarray(p[0], "float32").reshape((-1,) + shape),
                    np.asarray(p[1], "int64"), np.asarray(p[2], "int64"), np.asarray(p[3], dtype=object))

    return LetterData(labels, static_labels, motion_labels,
                      make(s, (L.FLOATS,)), make(m, (L.MOTION_FRAMES, L.FLOATS)))


# ── fitting ─────────────────────────────────────────────────────────────────

def _fit(model, x, y, val, epochs, class_weight=None) -> int:
    tf.keras.utils.set_random_seed(SEED)
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    callbacks = ([tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=6, restore_best_weights=True)]
                 if val is not None else [])
    hist = model.fit(x, y, validation_data=val, epochs=epochs, batch_size=64, shuffle=True,
                     verbose=0, callbacks=callbacks, class_weight=class_weight)
    if val is not None:
        return int(np.argmin(hist.history["val_loss"])) + 1
    return epochs


def _balanced(y, n) -> dict:
    counts = np.bincount(y, minlength=n)
    present = [i for i in range(n) if counts[i] > 0]
    return {i: len(y) / (len(present) * counts[i]) for i in present}


def fit_pair(data: LetterData, train_s, train_m, val_s=None, val_m=None,
             static_epochs=None, motion_epochs=None):
    """Trains the static model (always) and the motion model (when the training
    rows hold at least two motion classes). With validation masks, epochs are
    chosen by early stopping and returned; without, the given counts are used."""
    static_epochs = static_epochs or STATIC_EPOCHS
    motion_epochs = motion_epochs or MOTION_EPOCHS
    rng = np.random.default_rng(SEED)
    S, M = data.static, data.motion

    ax, ay = augment_static(S.x[train_s], S.y[train_s], rng)
    sval = (S.x[val_s], S.y[val_s]) if val_s is not None and val_s.any() else None
    static_model = build_static_model(len(data.static_labels))
    s_ep = _fit(static_model, ax, ay, sval, static_epochs)

    motion_model, m_ep = None, 0
    if len(data.motion_labels) > 1 and train_m.any() and len(set(M.y[train_m].tolist())) > 1:
        bx, by = augment_motion(M.x[train_m], M.y[train_m], rng)
        mval = (M.x[val_m], M.y[val_m]) if val_m is not None and val_m.any() else None
        motion_model = build_motion_model(len(data.motion_labels))
        m_ep = _fit(motion_model, bx, by, mval, motion_epochs,
                    class_weight=_balanced(by, len(data.motion_labels)))
    return static_model, motion_model, s_ep, m_ep


# ── evaluation ──────────────────────────────────────────────────────────────

def predict_clips(data: LetterData, static_model, motion_model, mask_s, mask_m):
    """Clip-level labels: a static clip's letter is the majority vote over its
    hold frames (as live voting does); a J/Z clip is its one movement."""
    true, pred = [], []
    S, M = data.static, data.motion
    if mask_s.any():
        guesses = static_model.predict(S.x[mask_s], verbose=0).argmax(1)
        clips, ys = S.clip[mask_s], S.y[mask_s]
        for c in np.unique(clips):
            sel = clips == c
            vote = Counter(guesses[sel].tolist()).most_common(1)[0][0]
            true.append(data.static_labels[int(ys[sel][0])])
            pred.append(data.static_labels[vote])
    real = mask_m & (M.clip >= 0)
    if real.any():
        guesses = (np.zeros(real.sum(), int) if motion_model is None
                   else motion_model.predict(M.x[real], verbose=0).argmax(1))
        true += [data.motion_labels[int(i)] for i in M.y[real]]
        pred += [data.motion_labels[int(i)] for i in guesses]
    return true, pred


def none_false_alarm(data: LetterData, motion_model, mask_m):
    """Share of non-letter movements the motion model calls a letter."""
    sel = mask_m & (data.motion.clip < 0)
    if motion_model is None or not sel.any():
        return None
    return float((motion_model.predict(data.motion.x[sel], verbose=0).argmax(1) != 0).mean())


def letter_report(true: list, pred: list) -> dict:
    names = sorted(set(true) | set(pred))
    cm = confusion_matrix(true, pred, labels=names)
    confusions = sorted(((int(cm[i, j]), names[i], names[j]) for i in range(len(names))
                         for j in range(len(names)) if i != j and cm[i, j] > 0), reverse=True)
    per_letter = {}
    for name in sorted(set(true)):
        idx = [k for k, t in enumerate(true) if t == name]
        per_letter[name] = round(sum(pred[k] == name for k in idx) / len(idx), 4)
    return {
        "accuracy": round(float(accuracy_score(true, pred)), 4),
        "precision": round(float(precision_score(true, pred, average="weighted", zero_division=0)), 4),
        "recall": round(float(recall_score(true, pred, average="weighted", zero_division=0)), 4),
        "f1_score": round(float(f1_score(true, pred, average="weighted", zero_division=0)), 4),
        "classification_report": classification_report(true, pred, zero_division=0),
        "top_confusions": "\n".join(f"  {t} -> predicted as {p}: {c}" for c, t, p in confusions[:10])
                          or "  (none - every clip classified correctly)",
        "per_letter": per_letter,
    }


# ── export ──────────────────────────────────────────────────────────────────

def _scatter(src_labels: list, labels: list, none_last: bool) -> np.ndarray:
    n = len(labels) + (1 if none_last else 0)
    m = np.zeros((len(src_labels), n), dtype="float32")
    for i, l in enumerate(src_labels):
        m[i, len(labels) if l == L.NONE_LABEL else labels.index(l)] = 1.0
    return m


def export_tflite(data: LetterData, static_model, motion_model) -> bytes:
    """One .tflite, two signatures (spec "Two letter models in one file"):
    static(landmarks[1,63]) -> probabilities[1,N]; motion(frames[1,32,63]) ->
    probabilities[1,N+1], last column _none."""
    n = len(data.labels)
    s_scatter = tf.constant(_scatter(data.static_labels, data.labels, none_last=False))
    m_scatter = tf.constant(_scatter(data.motion_labels, data.labels, none_last=True))

    # ExportArchive, not tf.saved_model.save on a tf.Module: converting that
    # SavedModel to TFLite produced NaN for Keras 3 models (the SavedModel itself
    # ran fine), while ExportArchive's output matches Keras exactly.
    import keras

    archive = keras.export.ExportArchive()
    archive.track(static_model)
    archive.add_endpoint(
        name="static",
        fn=lambda landmarks: {"probabilities": tf.matmul(static_model(landmarks, training=False), s_scatter)},
        input_signature=[tf.TensorSpec([1, L.FLOATS], tf.float32, name="landmarks")],
    )
    if motion_model is not None:
        archive.track(motion_model)
        motion_fn = lambda frames: {"probabilities": tf.matmul(motion_model(frames, training=False), m_scatter)}  # noqa: E731
    else:
        # No motion letters trained: everything is "not a letter".
        motion_fn = lambda frames: {"probabilities": tf.one_hot([n], n + 1) + 0.0 * tf.reduce_sum(frames)}  # noqa: E731
    archive.add_endpoint(
        name="motion",
        fn=motion_fn,
        input_signature=[tf.TensorSpec([1, L.MOTION_FRAMES, L.FLOATS], tf.float32, name="frames")],
    )
    with tempfile.TemporaryDirectory() as d:
        archive.write_out(d)
        conv = tf.lite.TFLiteConverter.from_saved_model(d, signature_keys=["static", "motion"])
        return conv.convert()


def tflite_probs(tflite_bytes: bytes, signature: str, x: np.ndarray) -> np.ndarray:
    runner = tf.lite.Interpreter(model_content=tflite_bytes).get_signature_runner(signature)
    key = "landmarks" if signature == "static" else "frames"
    return np.stack([runner(**{key: row[None, ...].astype("float32")})["probabilities"][0] for row in x])


def verify_tflite(tflite_bytes: bytes, data: LetterData, static_model, motion_model, n: int = 32) -> None:
    """The .tflite must predict like Keras, or the version must not ship."""
    xs = data.static.x[:n]
    want = static_model.predict(xs, verbose=0) @ _scatter(data.static_labels, data.labels, False)
    got = tflite_probs(tflite_bytes, "static", xs)
    if not np.allclose(want, got, atol=1e-3) or not (want.argmax(1) == got.argmax(1)).all():
        raise RuntimeError(f"static TFLite does not match Keras (max diff {np.abs(want - got).max():.4f})")
    if motion_model is not None and len(data.motion.x):
        xm = data.motion.x[:n]
        want = motion_model.predict(xm, verbose=0) @ _scatter(data.motion_labels, data.labels, True)
        got = tflite_probs(tflite_bytes, "motion", xm)
        if not np.allclose(want, got, atol=1e-3) or not (want.argmax(1) == got.argmax(1)).all():
            raise RuntimeError(f"motion TFLite does not match Keras (max diff {np.abs(want - got).max():.4f})")


# ── leave-one-signer-out (the honest number) ────────────────────────────────

def leave_one_signer_out(samples: list, labels: list) -> dict:
    """For each signer: choose epochs on one other signer, refit on every
    other signer, score the held-out signer's clips. Every clip is scored once,
    by a model that never saw its signer."""
    data = build_dataset(samples, labels)
    groups = sorted(set(data.static.group.tolist()) | set(data.motion.group.tolist()))
    folds, all_true, all_pred = [], [], []
    for g in groups:
        others = [o for o in groups if o != g]
        v = others[SEED % len(others)]
        tr_s, tr_m = data.static.group != g, data.motion.group != g
        val_s, val_m = data.static.group == v, data.motion.group == v
        _, _, se, me = fit_pair(data, tr_s & ~val_s, tr_m & ~val_m, val_s, val_m)
        s, m, _, _ = fit_pair(data, tr_s, tr_m, static_epochs=se, motion_epochs=max(me, 1))
        t, p = predict_clips(data, s, m, ~tr_s, ~tr_m)
        folds.append({
            "signer": g,
            "clips": len(t),
            "accuracy": round(float(np.mean([a == b for a, b in zip(t, p)])) if t else 0.0, 4),
            "none_false_alarm": none_false_alarm(data, m, ~tr_m),
        })
        all_true += t
        all_pred += p
    return {
        "folds": folds,
        "mean_accuracy": round(float(np.mean([f["accuracy"] for f in folds])), 4),
        "report": letter_report(all_true, all_pred),
    }
