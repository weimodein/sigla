"""
Python side of the Kotlin<->Python parity guard.

WHY THIS EXISTS
---------------
The feature pipeline is implemented twice: once in Python (app/utils/preprocessor.py,
used for training) and once in Kotlin (PredictionService.kt / HandLandmarkHelper.kt,
used for live inference). If they diverge numerically, the model is trained on one
representation and served another -- which does not crash, it just quietly degrades
accuracy in a way no metric in the pipeline can see.

FeatureParityTest.kt already pins the Kotlin side. This file pins the SAME cases on
the Python side, against the SAME expected values, so a change to either language
fails a test instead of silently shifting the contract.

If a test here fails after editing preprocessor.py, the pipelines have diverged. Fix
the divergence -- do NOT update the constants to match, unless the identical change
was deliberately made in Kotlin too (which also requires a retrain AND an app
release, because a deployed model expects the old layout).

Run:  venv/Scripts/python.exe -m pytest tests/ -v
"""

import numpy as np
import pytest

from app.utils.preprocessor import (
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
    _POSE_BASE,
    _POSE_LSHOULDER,
    _POSE_RSHOULDER,
    center_on_peak_velocity,
    frame_velocity,
    normalize_frame,
    peak_velocity_index,
)
from app.services.extract import _POSE_KEYPOINTS


# ── Fixture construction ─────────────────────────────────────────────────────
# Mirrors FeatureParityTest.makeSequence / tools/gen_parity_fixtures._make_sequence
# exactly. Deterministic arithmetic, no RNG, so both languages build byte-identical
# inputs without shipping multi-hundred-KB float dumps.

def make_sequence(n: int, peak_at: int, pose: bool, slot: int) -> np.ndarray:
    seq = np.zeros((n, FEATURE_SIZE), dtype=np.float32)
    for i in range(n):
        for k in range(FEATURE_SIZE):
            seq[i, k] = np.float32(((i * 31 + k * 7) % 97) * 0.0001)
        if not pose:
            seq[i, 126:147] = 0.0
        if slot == 0:
            seq[i, 63:126] = 0.0
        else:
            seq[i, 0:63] = 0.0

    if pose:
        for j in (126 + 5 * 3, 126 + 5 * 3 + 1, 126 + 6 * 3, 126 + 6 * 3 + 1):
            seq[peak_at, j] = seq[peak_at - 1, j] + 5.0
    else:
        base = slot * 63
        for i in (4, 8, 12, 16, 20):
            seq[peak_at, base + i * 3] = seq[peak_at - 1, base + i * 3] + 5.0
    return seq


def make_entry_spike(n: int, entry_at: int, sign_at: int) -> np.ndarray:
    """Big spike at entry (the hand-raise) + smaller real one at the sign."""
    seq = np.zeros((n, FEATURE_SIZE), dtype=np.float32)
    for i in range(n):
        for k in range(FEATURE_SIZE):
            seq[i, k] = np.float32(((i * 31 + k * 7) % 97) * 0.0001)
        seq[i, 63:126] = 0.0
    for j in (126 + 5 * 3, 126 + 5 * 3 + 1, 126 + 6 * 3, 126 + 6 * 3 + 1):
        seq[entry_at, j] = seq[entry_at - 1, j] + 5.0   # hand-raise: LARGER
        seq[sign_at,  j] = seq[sign_at - 1,  j] + 2.0   # actual sign: smaller
    return seq


# ── Layout constants ─────────────────────────────────────────────────────────

def test_layout_constant_parity():
    """Mirrors FeatureParityTest.layoutConstantParity. These are a wire contract
    with the deployed app -- a mismatch mislabels every prediction."""
    assert FEATURE_SIZE == 147
    assert SEQUENCE_LENGTH == 30
    assert _POSE_BASE == 126
    assert _POSE_LSHOULDER == 1
    assert _POSE_RSHOULDER == 2
    assert _POSE_KEYPOINTS == [0, 11, 12, 13, 14, 15, 16]


# ── Window selection ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("n,peak_at,pose,slot,expected", [
    (45, 30, True,  0, 29),
    (45, 12, False, 0, 13),
    # Left-hand-only: all data in slot 1. The OLD velocity signal read hand slot 0
    # only, saw zero velocity everywhere, and defaulted to n/2 = 20. Pinning 24
    # keeps that blindness from returning.
    (40, 25, False, 1, 24),
    (17,  9, True,  0, 10),
])
def test_window_selection_parity(n, peak_at, pose, slot, expected):
    """Same four cases pinned in FeatureParityTest.windowSelectionParity."""
    assert peak_velocity_index(make_sequence(n, peak_at, pose, slot)) == expected


def test_peak_search_ignores_entry_spike():
    """Source clips are 'raise, sign, lower' and the hand-raise is a BIGGER velocity
    spike than the sign (measured: 0.4844 at f2 vs 0.2098 at f16). A plain argmax
    centres on the entry and cuts off the gesture -- which is what made
    GOOD MORNING / GOOD AFTERNOON / I'M FINE mutually confusable."""
    frames = make_entry_spike(40, entry_at=2, sign_at=20)
    assert peak_velocity_index(frames) == 20


def test_peak_search_ignores_exit_spike():
    """The 'lower' end of raise-sign-lower must not win either."""
    frames = make_entry_spike(40, entry_at=37, sign_at=18)
    assert peak_velocity_index(frames) == 20


def test_exactly_sequence_length_is_identity():
    """With exactly SEQUENCE_LENGTH frames the only possible window is [0:30], so
    the default (force=False) path must return the input unchanged. extract.py
    passes force=True precisely because this shortcut was a real bug there."""
    frames = make_sequence(SEQUENCE_LENGTH, 25, pose=True, slot=0)
    out = center_on_peak_velocity(frames)
    assert out.shape == (SEQUENCE_LENGTH, FEATURE_SIZE)
    np.testing.assert_array_equal(out, frames)


def test_force_windows_a_sequence_length_input():
    """force=True must skip the shortcut. With exactly 30 frames the only window IS
    [0:30], so the RESULT is the same -- what matters is that it is a deliberate
    identity rather than an invisible early return."""
    frames = make_sequence(SEQUENCE_LENGTH, 25, pose=True, slot=0)
    out = center_on_peak_velocity(frames, force=True)
    assert out.shape == (SEQUENCE_LENGTH, FEATURE_SIZE)


def test_window_is_always_sequence_length():
    """Every windowed output must be exactly SEQUENCE_LENGTH frames regardless of
    input length -- extract.py refuses to store anything else, and the model's input
    shape is fixed at (30, 147)."""
    for n in (5, 17, 29, 30, 31, 45, 60, 90):
        out = center_on_peak_velocity(make_sequence(n, min(n - 1, n // 2), True, 0),
                                      force=True)
        assert out.shape == (SEQUENCE_LENGTH, FEATURE_SIZE), f"n={n}"


# ── Velocity signal ──────────────────────────────────────────────────────────

def test_velocity_ignores_wrist_centered_hand_translation():
    """After normalize_frame the hand blocks are wrist-centred, so translating a
    hand cannot change them. The pose block is shoulder-centred and DOES move. This
    is why the signal reads pose wrists rather than hand landmarks."""
    a = make_sequence(2, 1, True, 0)[0]

    b = a.copy()
    for j in range(21):
        b[j * 3] += 1.0                      # translate hand slot 0 in x
    assert frame_velocity(a, b) == pytest.approx(0.0, abs=1e-6)

    c = a.copy()
    c[126 + 5 * 3] += 1.0                    # move the left pose wrist
    assert frame_velocity(a, c) > 0.9


def test_velocity_falls_back_to_fingertips_without_pose():
    """When either frame lacks a pose block, the signal must fall back to both
    hands' fingertips rather than reading zeros and going blind."""
    a = make_sequence(2, 1, pose=False, slot=0)[0]
    b = a.copy()
    b[4 * 3] += 1.0                          # move a fingertip on slot 0
    assert frame_velocity(a, b) > 0.9


# ── Normalization ────────────────────────────────────────────────────────────

def test_normalize_frame_wrist_centers_present_hand():
    """Landmark 0 must become exactly the origin for a present hand."""
    frame = make_sequence(1, 0, True, 0)[0]
    out = normalize_frame(frame)
    assert out[0] == pytest.approx(0.0, abs=1e-6)
    assert out[1] == pytest.approx(0.0, abs=1e-6)
    assert out[2] == pytest.approx(0.0, abs=1e-6)


def test_normalize_frame_leaves_absent_blocks_zero():
    """An absent hand is the 63-zero sentinel and must survive normalization
    untouched -- the model reads all-zero as 'no hand', so perturbing it would
    invent a hand that was never detected."""
    frame = make_sequence(1, 0, pose=True, slot=0)[0]
    out = normalize_frame(frame)
    assert not np.any(out[63:126]), "absent hand slot 1 must stay zero"


def test_normalize_frame_is_translation_invariant():
    """Shifting the whole frame in image space must not change the normalized
    output -- that is the entire point of wrist/shoulder centering."""
    frame = make_sequence(1, 0, True, 0)[0]
    shifted = frame.copy()
    for j in range(21):
        shifted[j * 3] += 0.1
        shifted[j * 3 + 1] += 0.1
    for k in range(7):
        shifted[_POSE_BASE + k * 3] += 0.1
        shifted[_POSE_BASE + k * 3 + 1] += 0.1

    np.testing.assert_allclose(normalize_frame(frame), normalize_frame(shifted),
                               rtol=1e-4, atol=2e-5)
