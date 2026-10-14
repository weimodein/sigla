"""The conv_linear words model: same contract as the LSTM (the app is
unchanged), features identical to the experiment that justified it, and an
export the plain TFLite interpreter can run and check."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
tf = pytest.importorskip("tensorflow")

from app.services import words_blend as W  # noqa: E402

N_CLASSES = 4


def _clips(n, seed=0):
    rng = np.random.default_rng(seed)
    x = rng.normal(0, 0.3, size=(n, 30, 147)).astype("float32")
    x[: n // 4, :, 63:126] = 0.0          # some clips with no second hand
    y = np.arange(n) % N_CLASSES
    x[:, :, 0] += y[:, None] * 0.5        # make the classes learnable
    return x, y


def _numpy_summary(x):
    """The exact feature recipe from tools/words_experiment.py."""
    iu = np.triu_indices(21, 1)
    d = []
    for h in range(2):
        p = x[..., h * 63:(h + 1) * 63].reshape(*x.shape[:-1], 21, 3)
        d.append(np.linalg.norm(p[..., iu[0], :] - p[..., iu[1], :], axis=-1))
    f = np.concatenate([x] + d, axis=-1)
    thirds = np.array_split(np.arange(f.shape[1]), 3)
    return np.concatenate([f[:, t].mean(axis=1) for t in thirds] + [f.std(axis=1)], axis=1)


def test_summary_matches_experiment_features():
    x, _ = _clips(8)
    got = W.WordsSummary()(tf.constant(x)).numpy()
    assert got.shape == (8, 4 * 567)
    np.testing.assert_allclose(got, _numpy_summary(x), atol=1e-4)


def test_sharpen_keeps_the_top_word_and_raises_confidence():
    p = np.array([[0.40, 0.30, 0.20, 0.10], [0.1, 0.2, 0.3, 0.4]], dtype="float32")
    s = W.Sharpen(0.35)(tf.constant(p)).numpy()
    assert (s.argmax(1) == p.argmax(1)).all()
    assert (s.max(1) > p.max(1)).all()
    np.testing.assert_allclose(s.sum(1), 1.0, atol=1e-5)


def test_blend_keeps_the_lstm_contract_and_exports_without_flex(tmp_path):
    x, y = _clips(40)
    linear = W.fit_linear(x, y, N_CLASSES, C=0.1)
    conv = W.build_conv(N_CLASSES)
    model = W.compose(linear, conv)
    assert model.input_shape == (None, 30, 147)
    assert model.output_shape == (None, N_CLASSES)

    # Saved like train.py does, and loadable again.
    h5 = str(tmp_path / "m.h5")
    model.save(h5)
    reloaded = tf.keras.models.load_model(h5)
    np.testing.assert_allclose(reloaded.predict(x[:4], verbose=0),
                               model.predict(x[:4], verbose=0), atol=1e-5)

    from app.services.train import convert_to_tflite
    path = convert_to_tflite(model, h5)
    # verify_tflite uses tf.lite.Interpreter, which has no Flex delegate: if the
    # export needed Select-TF ops this would fail to allocate.
    W.verify_tflite(path, model, x[:8])


def test_dropping_the_none_class_keeps_word_probabilities_unrenormalised(tmp_path):
    x, y = _clips(40)
    model = W.compose(W.fit_linear(x, y, N_CLASSES, C=0.1), W.build_conv(N_CLASSES))
    full = model.predict(x[:4], verbose=0)
    shipped = W.drop_none(model)
    out = shipped.predict(x[:4], verbose=0)
    assert out.shape == (4, N_CLASSES - 1)
    np.testing.assert_allclose(out, full[:, :-1], atol=1e-6)   # same values, last one gone

    h5 = str(tmp_path / "m.h5")
    shipped.save(h5)
    from app.services.train import convert_to_tflite
    W.verify_tflite(convert_to_tflite(shipped, h5), shipped, x[:8])


def test_none_samples_are_spread_over_signers(tmp_path):
    p = tmp_path / "none.npz"
    signer = np.array(["s1"] * 30 + ["s2"] * 10)
    np.savez(p, windows=np.zeros((40, 30, 147), np.float32), signer=signer)
    got = W.load_none_samples(str(p), max_n=20)
    sessions = [s["session_id"] for s in got]
    assert isinstance(got[0]["sequence"], list)   # what _load_real_sequences expects
    assert sessions.count("s1") == 10 and sessions.count("s2") == 10


def test_linear_model_learns_and_unseen_class_never_wins():
    x, y = _clips(40)
    keep = y != 3                          # class 3 never seen
    p = W.fit_linear(x[keep], y[keep], N_CLASSES, C=1.0).predict(x, verbose=0)
    assert (p.argmax(1) != 3).all()
    assert (p.argmax(1)[keep] == y[keep]).mean() > 0.9
