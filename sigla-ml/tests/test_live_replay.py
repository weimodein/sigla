"""The live-replay copy of PredictionService's firing rules."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import live_replay as R  # noqa: E402


def _stream(n_hand=60, seed=0):
    """Idle, then a moving two-hand + pose signer, then the tail the replay adds."""
    rng = np.random.default_rng(seed)
    idle = np.zeros((8, 147), np.float32)
    t = np.linspace(0, 2 * np.pi, n_hand)
    sign = rng.normal(0, 0.05, (n_hand, 147)).astype(np.float32)
    sign[:, 126:] += 0.5                                   # pose present
    sign[:, 126 + 15] += np.sin(t).astype(np.float32)      # left pose wrist moves
    frames = np.concatenate([idle, sign])
    hands = np.array([0] * 8 + [2] * n_hand, np.int8)
    return frames, hands


def _probs(k, top):
    p = np.full(5, (1 - top) / 4, np.float32)
    p[k] = top
    return p


def test_confident_model_fires_once_the_buffer_is_peak_centrable():
    frames, hands = _stream()
    r = R.replay_clip(frames, hands, lambda w, key: _probs(3, 0.99))
    assert r["pred"] == 3
    assert r["how"] == "live"
    # First 8 frames are idle; the 36-frame evidence gate opens on hand frame 36.
    assert r["frame"] >= 8 + R.MIN_COMPLETE_GESTURE_FRAMES - 1


def test_unsure_model_never_fires():
    frames, hands = _stream()
    r = R.replay_clip(frames, hands, lambda w, key: _probs(3, 0.40))
    assert r["pred"] is None


def test_short_confident_sign_fires_on_the_end_of_gesture_flush():
    frames, hands = _stream(n_hand=26)                     # never reaches 36 frames
    r = R.replay_clip(frames, hands, lambda w, key: _probs(1, 0.85))
    assert r["pred"] == 1
    assert r["how"] == "end"


def test_window_collection_walks_every_window_without_firing():
    frames, hands = _stream()
    wins = R.clip_windows(frames, hands)
    assert len(wins) > 10
    assert all(w.shape == (30, 147) for w in wins.values())
