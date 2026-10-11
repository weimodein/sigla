import numpy as np
import pytest

tf = pytest.importorskip("tensorflow")

from app.services import letters_train as LT
from app.utils import letters as L
from tests._letter_synth import synth_track


def _samples():
    out = []
    for g in ("s1", "s2", "s3"):
        for k in range(4):
            out.append(LT.LetterSample("A", g, synth_track(1)))
            out.append(LT.LetterSample("B", g, synth_track(2)))
            out.append(LT.LetterSample("J", g, synth_track(3, kind="J")))
    return out


@pytest.fixture(scope="module")
def trained():
    data = LT.build_dataset(_samples(), ["A", "B", "J"])
    s, m, _, _ = LT.fit_pair(
        data, np.ones(len(data.static.y), bool), np.ones(len(data.motion.y), bool),
        static_epochs=8, motion_epochs=8)
    return data, s, m


def test_build_dataset_shapes():
    data = LT.build_dataset(_samples(), ["A", "B", "J"])
    assert data.labels == ["A", "B", "J"]
    assert data.static_labels == ["A", "B"]
    assert data.motion_labels == [L.NONE_LABEL, "J"]
    assert data.static.x.shape[1:] == (L.FLOATS,)
    assert data.motion.x.shape[1:] == (L.MOTION_FRAMES, L.FLOATS)
    assert (data.motion.y == 1).sum() == 12          # one J per J clip
    assert (data.motion.y == 0).sum() > 0             # raises/lowers as _none


def test_export_has_two_signatures_and_zero_columns(trained):
    data, s, m = trained
    b = LT.export_tflite(data, s, m)
    interp = tf.lite.Interpreter(model_content=b)
    assert set(interp.get_signature_list()) == {"static", "motion"}
    p = LT.tflite_probs(b, "static", data.static.x[:3])
    assert p.shape == (3, 3)
    assert np.allclose(p[:, 2], 0.0)                  # J is motion-only
    q = LT.tflite_probs(b, "motion", data.motion.x[:3])
    assert q.shape == (3, 4)                          # A, B, J, _none
    assert np.allclose(q[:, :2], 0.0)                 # A, B are static-only
    LT.verify_tflite(b, data, s, m)


def test_clip_predictions_and_report(trained):
    data, s, m = trained
    t, p = LT.predict_clips(data, s, m, np.ones(len(data.static.y), bool),
                            np.ones(len(data.motion.y), bool))
    assert len(t) == len(p) == 36
    rep = LT.letter_report(t, p)
    assert {"accuracy", "precision", "recall", "f1_score",
            "classification_report", "top_confusions", "per_letter"} <= set(rep)


def test_letter_features_match_numpy():
    rng = np.random.default_rng(0)
    x = rng.normal(0.5, 0.1, size=(4, L.FLOATS)).astype("float32")
    got = LT.LetterFeatures()(x).numpy()
    assert got.shape == (4, L.FLOATS + 210)
    p = x.reshape(-1, 21, 3)
    rel = p - p[:, :1]
    size = np.linalg.norm(rel[..., :2], axis=-1).max(1)
    norm = rel / size[:, None, None]
    assert np.allclose(got[:, :L.FLOATS], norm.reshape(4, -1), atol=1e-4)
    iu = np.triu_indices(21, 1)
    want = np.linalg.norm(norm[:, :, None] - norm[:, None], axis=-1)[:, iu[0], iu[1]]
    assert np.allclose(got[:, L.FLOATS:], want, atol=1e-4)


def test_fit_static_returns_a_blended_softmax_model():
    data = LT.build_dataset(_samples(), ["A", "B", "J"])
    model, _ = LT.fit_static(data, np.ones(len(data.static.y), bool), None, epochs=4)
    p = model.predict(data.static.x[:5], verbose=0)
    assert p.shape == (5, 2)
    assert np.allclose(p.sum(1), 1.0, atol=1e-4)
    # the blend is 0.7 linear + 0.3 network, so both branches must be inside it
    assert {l.name for l in model.layers} >= {"static_linear", "static_mlp"}
