"""
Words model "conv_linear": a Conv1D network blended with a linear model on
per-clip summary features, packed into ONE Keras model with the same contract
as the LSTM it replaces — input [B, 30, 147], output [B, n_classes] softmax —
so the app needs no change and Manage Model can revert to an LSTM version.

Why (tools/words_experiment.py, leave-one-signer-out, 83 words, 2026-10-13):
  production LSTM                     76.6%   shown-and-wrong 16.6%
  Conv1D + linear @0.7, sharpened     86.2%   shown-and-wrong  8.1%
The linear model works on rotation-invariant hand-point distances and
generalises to new signers better; the network adds what the linear model
misses. The blend's raw probabilities are soft (rarely above the app's 0.80
bar), so the output is sharpened with a temperature: softmax(log(p) / T).
That changes confidence, never the top word.

Select with MODEL_ARCH=conv_linear (train.py). MODEL_ARCH=lstm restores the
previous model exactly.
"""

import os

import numpy as np
import tensorflow as tf

SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))
FEATURE_SIZE = int(os.getenv("FEATURE_SIZE", 147))

LINEAR_WEIGHT = float(os.getenv("WORDS_LINEAR_WEIGHT", 0.7))
TEMPERATURE = float(os.getenv("WORDS_TEMPERATURE", 0.35))
LINEAR_CS = (0.01, 0.1, 1.0)

POINTS = 21
_IU = np.triu_indices(POINTS, 1)
# Frames of each third of the window: the summary keeps the order of the movement.
_THIRDS = [t.tolist() for t in np.array_split(np.arange(SEQUENCE_LENGTH), 3)]


@tf.keras.utils.register_keras_serializable(package="sigla")
class WordsSummary(tf.keras.layers.Layer):
    """[B, 30, 147] -> [B, 4 x 567]. Per frame: the 147 coordinates plus every
    pairwise 3D distance between the 21 points of each hand (420; stored hands
    are already wrist-centred and size-scaled, so these describe hand shape
    whatever the rotation; a missing hand gives zeros). Per clip: the mean of
    each third of the window and the std over the whole window."""

    def call(self, x):
        dists = []
        for h in range(2):
            p = tf.reshape(x[..., h * 63:(h + 1) * 63], (-1, SEQUENCE_LENGTH, POINTS, 3))
            d = tf.gather(p, _IU[0], axis=2) - tf.gather(p, _IU[1], axis=2)
            dists.append(tf.sqrt(tf.reduce_sum(tf.square(d), axis=-1) + 1e-12))
        f = tf.concat([x] + dists, axis=-1)
        parts = [tf.reduce_mean(tf.gather(f, t, axis=1), axis=1) for t in _THIRDS]
        mean = tf.reduce_mean(f, axis=1, keepdims=True)
        parts.append(tf.sqrt(tf.reduce_mean(tf.square(f - mean), axis=1) + 1e-12))
        return tf.concat(parts, axis=-1)


@tf.keras.utils.register_keras_serializable(package="sigla")
class Sharpen(tf.keras.layers.Layer):
    """Probabilities -> softmax(log(p) / T). T < 1 raises the top score; the
    order of the classes, and so the predicted word, never changes."""

    def __init__(self, temperature=TEMPERATURE, **kwargs):
        super().__init__(**kwargs)
        self.temperature = float(temperature)

    def call(self, p):
        return tf.nn.softmax(tf.math.log(p + 1e-9) / self.temperature, axis=-1)

    def get_config(self):
        return {**super().get_config(), "temperature": self.temperature}


# ── "Not a sign" class (tools/build_none_windows.py) ─────────────────────────
#
# Trained as one more class, then DROPPED from the exported model's output: the
# app keeps its exact contract (one probability per word, words-only labels
# file), and when a window is "not a sign" every word's probability is low, so
# the app's existing 0.80 bar shows nothing. Any app version runs it.
#
# Off unless WORDS_NONE_WINDOWS points at a local .npz — the windows never go
# into the shared database.
NONE_LABEL = "_none"
NONE_WINDOWS = os.getenv("WORDS_NONE_WINDOWS", "").strip()
NONE_PER_WORD = float(os.getenv("WORDS_NONE_PER_WORD", 3.0))  # cap, in average-word sizes


def load_none_samples(path: str, max_n: int, seed: int = 42) -> list:
    """Up to max_n none windows as dataset samples, spread evenly over signers."""
    z = np.load(path, allow_pickle=True)
    windows, signers = z["windows"], z["signer"]
    rng = np.random.default_rng(seed)
    groups = sorted(set(signers.tolist()))
    per = max(1, max_n // max(len(groups), 1))
    picked = []
    for g in groups:
        idx = np.where(signers == g)[0]
        picked += rng.choice(idx, size=min(per, len(idx)), replace=False).tolist()
    print(f"[train] none class: {len(picked)} of {len(windows)} windows from {path} "
          f"({', '.join(f'{g}={min(per, int((signers == g).sum()))}' for g in groups)})")
    # Plain lists, like samples from /api/ml/dataset: _load_real_sequences tests
    # `if not sequence`, which a numpy array cannot answer.
    return [{"sequence": windows[i].tolist(), "session_id": str(signers[i]),
             "sample_id": f"none-{i}"} for i in picked]


@tf.keras.utils.register_keras_serializable(package="sigla")
class DropLastClass(tf.keras.layers.Layer):
    """[B, n+1] -> [B, n]: removes the trailing none-class probability WITHOUT
    renormalising, so a confident "not a sign" leaves every word low."""

    def call(self, p):
        return p[:, :-1]


def drop_none(model: tf.keras.Model) -> tf.keras.Model:
    inp = tf.keras.Input(shape=(SEQUENCE_LENGTH, FEATURE_SIZE), name="frames")
    return tf.keras.Model(inp, DropLastClass()(model(inp)), name="sigla_motion_model")


def build_conv(n_classes: int) -> tf.keras.Model:
    """Conv1D like the letters J/Z model: plain TFLite builtins, no Flex ops."""
    keras = tf.keras
    reg = keras.regularizers.l2(2e-4)
    model = keras.Sequential([
        keras.layers.Input(shape=(SEQUENCE_LENGTH, FEATURE_SIZE)),
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
    print(f"[train] architecture: conv_linear (Conv1D part) — {model.count_params():,} params")
    return model


def _mirror(x: np.ndarray) -> np.ndarray:
    from app.utils.preprocessor import mirror_sequence
    return np.stack([mirror_sequence(s) for s in x])


def _summary(x: np.ndarray, batch: int = 256) -> np.ndarray:
    """WordsSummary in batches: all clips at once peaks at 1-2 GB, too much for
    a small server."""
    layer = WordsSummary()
    return np.concatenate([layer(tf.constant(x[i:i + batch])).numpy()
                           for i in range(0, len(x), batch)])


def fit_linear(x: np.ndarray, y: np.ndarray, n_classes: int, C: float) -> tf.keras.Model:
    """Softmax regression on WordsSummary, fitted with scikit-learn on the real
    clips plus their mirror images, stored as Keras layers so it exports inside
    the same .tflite."""
    from sklearn.linear_model import LogisticRegression

    xm = np.concatenate([x, _mirror(x)]).astype("float32")
    ym = np.tile(y, 2)
    feats = _summary(xm)
    mu, sd = feats.mean(0), feats.std(0) + 1e-6
    lr = LogisticRegression(C=C, max_iter=2000).fit((feats - mu) / sd, ym)

    w = np.zeros((feats.shape[1], n_classes), dtype="float32")
    b = np.full(n_classes, -30.0, dtype="float32")     # a class never seen can never win
    for k, c in enumerate(lr.classes_):
        w[:, c], b[c] = lr.coef_[k], lr.intercept_[k]

    inp = tf.keras.Input(shape=(SEQUENCE_LENGTH, FEATURE_SIZE))
    h = WordsSummary()(inp)
    h = tf.keras.layers.Normalization(mean=mu, variance=sd ** 2)(h)
    out = tf.keras.layers.Dense(n_classes, activation="softmax")(h)
    model = tf.keras.Model(inp, out, name="words_linear")
    model.layers[-1].set_weights([w, b])
    return model


def choose_C(x, y, groups, held_out, n_classes) -> tuple[float, dict]:
    """Pick the linear model's C on the held-out signer (never on the data the
    final model is scored on); ties go to the stronger regularisation."""
    tr, va = groups != held_out, groups == held_out
    scores = {}
    for C in LINEAR_CS:
        p = fit_linear(x[tr], y[tr], n_classes, C).predict(x[va], verbose=0)
        scores[C] = float((p.argmax(1) == y[va]).mean())
    best = max(LINEAR_CS, key=lambda c: (scores[c], -c))
    print(f"[train] linear C on held-out signer {held_out}: "
          + ", ".join(f"C={c}: {s:.3f}" for c, s in scores.items()) + f" -> {best}")
    return best, scores


def compose(linear: tf.keras.Model, conv: tf.keras.Model,
            weight: float = LINEAR_WEIGHT, temperature: float = TEMPERATURE) -> tf.keras.Model:
    inp = tf.keras.Input(shape=(SEQUENCE_LENGTH, FEATURE_SIZE), name="frames")
    blend = tf.keras.layers.Add()([
        tf.keras.layers.Rescaling(weight)(linear(inp)),
        tf.keras.layers.Rescaling(1.0 - weight)(conv(inp)),
    ])
    out = Sharpen(temperature)(blend)
    return tf.keras.Model(inp, out, name="sigla_motion_model")


def real_arrays(motion_dataset: dict, label_map: dict):
    """The deduplicated, normalised, peak-centred real clips (no augmentation)
    as arrays, with each clip's signer, in label_map's class order."""
    from app.utils.preprocessor import _load_real_sequences
    real, groups = _load_real_sequences(motion_dataset, with_groups=True)
    xs, ys, gs = [], [], []
    for i in range(len(label_map)):
        lab = label_map[i]
        for s, g in zip(real.get(lab, []), groups.get(lab, [])):
            xs.append(s)
            ys.append(i)
            gs.append(g)
    return np.stack(xs).astype("float32"), np.array(ys), np.array(gs)


def verify_tflite(tflite_path: str, model: tf.keras.Model, x: np.ndarray,
                  max_drift: float = 1e-3) -> float:
    """Run the exported model in the plain TFLite interpreter (no Flex ops) and
    compare with Keras on real clips. Raises instead of shipping a mismatch."""
    interp = tf.lite.Interpreter(model_path=tflite_path)
    interp.allocate_tensors()
    inp, out = interp.get_input_details()[0], interp.get_output_details()[0]
    if list(inp["shape"]) != [1, SEQUENCE_LENGTH, FEATURE_SIZE]:
        raise ValueError(f"exported input shape {list(inp['shape'])} != [1, 30, 147]")
    got = []
    for row in x:
        interp.set_tensor(inp["index"], row[None].astype("float32"))
        interp.invoke()
        got.append(interp.get_tensor(out["index"])[0])
    expected = model.predict(x, verbose=0)
    drift = float(np.max(np.abs(np.array(got) - expected)))
    same_top = float(np.mean(np.array(got).argmax(1) == expected.argmax(1)))
    print(f"[train] TFLite check on {len(x)} real clips: max drift {drift:.2e}, "
          f"same top word {same_top * 100:.1f}%")
    if drift > max_drift or same_top < 1.0:
        raise ValueError(f"TFLite output differs from Keras (drift {drift:.2e}, "
                         f"top-word agreement {same_top:.3f}); not shipping it")
    return drift
