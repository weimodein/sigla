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
