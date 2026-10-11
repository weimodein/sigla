import numpy as np
import pytest

from app.utils import letters as L
from tests._letter_synth import synth_hand, synth_track


def _hold_window(track):
    held = [f["t_ms"] for f in track if f["hand"] is not None
            and abs(np.asarray(f["hand"])[1] - np.asarray(track[16]["hand"])[1]) < 1e-2]
    return min(held), max(held)


def test_select_hand_picks_larger_extent():
    small = (np.asarray(synth_hand(1, (0.3, 0.5, 0.0))).reshape(21, 3))
    big = small.copy()
    big[:, :2] = (big[:, :2] - big[0, :2]) * 2 + big[0, :2]
    out = L.select_hand([small.reshape(-1).tolist(), big.reshape(-1).tolist()], 640, 480)
    expect = big.copy()
    expect[:, 0] *= 640 / 480
    expect[:, 2] *= 640 / 480
    assert np.allclose(out, expect.reshape(-1))


def test_select_hand_none_without_hands_or_size():
    assert L.select_hand([], 640, 480) is None
    assert L.select_hand([synth_hand(1, (0.5, 0.5, 0))], 0, 480) is None


def test_find_hold_returns_only_the_hold():
    track = synth_track(3)
    hold = L.find_hold(track)
    assert hold is not None
    lo, hi = _hold_window(track)
    assert all(lo <= f["t_ms"] <= hi for f in hold)
    assert hold[-1]["t_ms"] - hold[0]["t_ms"] >= 600


def test_static_samples_spaced_and_capped():
    s = L.static_samples(synth_track(4))
    assert 5 <= len(s) <= L.STATIC_MAX_SAMPLES
    assert all(len(h) == L.FLOATS for h in s)


def test_segmenter_finds_raise_and_lower_of_a_static_clip():
    segs = L.motion_segments(synth_track(5))
    assert len(segs) == 2
    assert all(a.shape == (L.MOTION_FRAMES, L.FLOATS) for a in segs)


def test_segmenter_drops_segment_with_too_many_missing_frames():
    track = synth_track(6)
    # The raise starts moving at frame 7; blank 4 of its later frames, so the
    # movement keeps going but more than 25 % of its frames have no hand.
    for f in track[9:16:2]:
        f["hand"] = None
    segs = L.motion_segments(track)
    assert len(segs) == 1            # only the lower survives


def test_single_take_cuts_the_j_movement():
    track = synth_track(7, kind="J")
    take = L.find_single_take(track)
    assert take is not None
    trace_start = track[6 + 10 + 8]["t_ms"]
    trace_end = track[6 + 10 + 8 + 16]["t_ms"]
    assert take.sign.start_ms <= trace_start
    assert take.sign.end_ms >= trace_end - 100
    assert take.sign.end_ms - take.sign.start_ms <= L.SEGMENT_CONFIG["max_ms"]
    assert L.segment_array(take.sign).shape == (L.MOTION_FRAMES, L.FLOATS)


def test_resample_is_linear():
    a = [0.0] * L.FLOATS
    b = [1.0] * L.FLOATS
    out = L.resample([(0, a), (310, b)], 0, 310)
    assert out.shape == (L.MOTION_FRAMES, L.FLOATS)
    assert np.allclose(out[:, 0], np.linspace(0, 1, L.MOTION_FRAMES), atol=1e-6)
