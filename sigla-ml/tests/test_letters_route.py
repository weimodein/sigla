import os

# Importing app.main pulls in the Supabase client, which insists on credentials
# at import time. These routes never reach Supabase (everything is stubbed), so
# harmless placeholders keep the test independent of anyone's .env.
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")

from fastapi.testclient import TestClient

import app.routers.model as model_router
from app.main import app


def test_extract_without_hand_track_is_unchanged(monkeypatch):
    monkeypatch.setattr(model_router, "extract_motion_landmarks", lambda b, n: [[0.0] * 147] * 30)
    called = []
    monkeypatch.setattr(model_router, "extract_hand_track", lambda b, n: called.append(1))
    r = TestClient(app).post("/extract-landmarks", files={"file": ("a.mp4", b"x", "video/mp4")})
    assert r.status_code == 200
    assert set(r.json()) == {"type", "sequence"}
    assert called == []


def test_extract_with_hand_track(monkeypatch):
    monkeypatch.setattr(model_router, "extract_motion_landmarks", lambda b, n: [[0.0] * 147] * 30)
    monkeypatch.setattr(model_router, "extract_hand_track",
                        lambda b, n: {"version": 1, "frames": [{"t_ms": 0, "hand": [0.0] * 63}]})
    r = TestClient(app).post("/extract-landmarks?hand_track=true",
                             files={"file": ("a.mp4", b"x", "video/mp4")})
    assert r.status_code == 200
    assert r.json()["hand_track"]["version"] == 1


def test_extract_with_hand_track_but_no_hand_is_422(monkeypatch):
    monkeypatch.setattr(model_router, "extract_motion_landmarks", lambda b, n: [[0.0] * 147] * 30)
    monkeypatch.setattr(model_router, "extract_hand_track", lambda b, n: None)
    r = TestClient(app).post("/extract-landmarks?hand_track=true",
                             files={"file": ("a.mp4", b"x", "video/mp4")})
    assert r.status_code == 422


def test_train_passes_model_kind(monkeypatch):
    seen = {}

    def fake_train(**kw):
        seen.update(kw)
        return {"accuracy": 1.0, "total_classes": 2, "tflite_url": "u", "h5_url": None,
                "trained_labels": ["A", "B"]}

    monkeypatch.setattr(model_router, "train", fake_train)
    r = TestClient(app).post("/train", json={"version_number": "9.9.9-letters", "model_id": 1,
                                             "word_labels": ["A", "B"], "model_kind": "letters"})
    assert r.status_code == 200
    assert seen["model_kind"] == "letters"


def test_extract_only_hand_track_skips_the_window_extraction(monkeypatch):
    """Letters only need the track: the 30-frame window costs ~34 s per clip and is not used."""
    def must_not_run(b, n):
        raise AssertionError("extract_motion_landmarks must not run for only_hand_track")

    monkeypatch.setattr(model_router, "extract_motion_landmarks", must_not_run)
    monkeypatch.setattr(model_router, "extract_hand_track",
                        lambda b, n: {"version": 1, "frames": [{"t_ms": 0, "hand": [0.0] * 63}]})
    r = TestClient(app).post("/extract-landmarks?only_hand_track=true",
                             files={"file": ("a.mp4", b"x", "video/mp4")})
    assert r.status_code == 200
    body = r.json()
    assert body["sequence"] is None
    assert body["hand_track"]["version"] == 1


def test_extract_only_hand_track_without_a_hand_is_422(monkeypatch):
    monkeypatch.setattr(model_router, "extract_hand_track", lambda b, n: None)
    r = TestClient(app).post("/extract-landmarks?only_hand_track=true",
                             files={"file": ("a.mp4", b"x", "video/mp4")})
    assert r.status_code == 422
