"""
Generate the WINDOW-SELECTION parity fixtures for FeatureParityTest.kt.

    python tools/gen_parity_fixtures.py > fixtures.txt

Scope note: this generates ONLY the window/velocity fixtures. The four
normalize_frame fixtures already in FeatureParityTest.kt came from an earlier
scratch script whose exact RNG call sequence was never committed, so they cannot
be reproduced here — and they must NOT be regenerated from a different sequence,
because those goldens are a working regression guard against Python/Kotlin drift.
Leave them exactly as they are.

IMPORTANT: regenerating fixtures to make a failing test pass is exactly wrong —
a failure means Python and Kotlin have diverged. Only regenerate when the SAME
change was made deliberately on both sides (which also requires a retrain).
"""

import argparse
import sys
import os

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.preprocessor import (  # noqa: E402
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
    _POSE_BASE,
    center_on_peak_velocity,
    frame_velocity,
    peak_velocity_index,
)

SEED = 7


def _kt_floats(arr) -> str:
    return ", ".join(f"{float(v):.8e}f" for v in arr)


# ── window-selection fixtures ────────────────────────────────────────────────
#
# Each case is an N-frame NORMALIZED sequence. We assert Kotlin picks the same
# peak index. Motion is injected as a clean ramp on the chosen frame so the
# winner clears the runner-up by far more than float32-vs-float64 noise.

def _make_sequence(rng, n, peak_at, pose=True, slot=0):
    """Build a synthetic normalized sequence with one unambiguous velocity peak.

    Deliberately reconstructible in Kotlin WITHOUT shipping the raw floats: the
    filler is a deterministic ramp rather than RNG output, so FeatureParityTest
    can rebuild byte-identical input from (n, peak_at, pose, slot) alone. Only the
    expected peak index needs to be pinned as a golden. `rng` is accepted but
    unused, kept so the signature matches the RNG-based fixtures if ever needed.
    """
    seq = np.zeros((n, FEATURE_SIZE), dtype=np.float32)
    for i in range(n):
        frame = np.zeros(FEATURE_SIZE, dtype=np.float32)
        # Deterministic small drift so non-peak frames have nonzero, unequal velocity.
        for k in range(FEATURE_SIZE):
            frame[k] = np.float32(((i * 31 + k * 7) % 97) * 0.0001)
        if not pose:
            frame[_POSE_BASE:] = 0.0
        if slot == 0:
            frame[63:126] = 0.0
        else:
            frame[0:63] = 0.0
        seq[i] = frame

    # Large displacement into `peak_at` on whichever channels the signal reads.
    if pose:
        for j in (_POSE_BASE + 5 * 3, _POSE_BASE + 5 * 3 + 1,
                  _POSE_BASE + 6 * 3, _POSE_BASE + 6 * 3 + 1):
            seq[peak_at][j] = seq[peak_at - 1][j] + np.float32(5.0)
    else:
        base = slot * 63
        for i in (4, 8, 12, 16, 20):
            seq[peak_at][base + i * 3] = seq[peak_at - 1][base + i * 3] + np.float32(5.0)
    return seq


def build_window_cases(rng):
    return {
        "windowPosePresent":  _make_sequence(rng, 45, 30, pose=True),
        "windowPoseAbsent":   _make_sequence(rng, 45, 12, pose=False),
        "windowSlot1Only":    _make_sequence(rng, 40, 25, pose=False, slot=1),
        "windowShortPad":     _make_sequence(rng, 17, 9,  pose=True),
    }


def raw_argmax_index(seq):
    """Plain argmax — kept only to show what the production picker improves on."""
    n = len(seq)
    peak_idx, peak_vel = n // 2, 0.0
    for i in range(1, n):
        v = frame_velocity(seq[i - 1], seq[i])
        if v > peak_vel:
            peak_vel, peak_idx = v, i
    return peak_idx


def peak_index(seq):
    """The PRODUCTION picker. Must be what the fixtures pin — generating from a
    plain argmax would pin values the real code never produces."""
    return peak_velocity_index(seq)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="print the values only, for eyeballing against the test")
    args = ap.parse_args()

    rng = np.random.default_rng(SEED)

    print("// --- window-selection fixtures ---")
    print("// Paste the expected peak indices into FeatureParityTest.windowSelectionParity.")
    print("// Inputs are rebuilt in Kotlin from (n, peakAt, pose, slot) - see makeSequence().")
    specs = {
        "windowPosePresent": (45, 30, True, 0),
        "windowPoseAbsent":  (45, 12, False, 0),
        "windowSlot1Only":   (40, 25, False, 1),
        "windowShortPad":    (17, 9,  True, 0),
    }
    for name, seq in build_window_cases(rng).items():
        n, peak_at, pose, slot = specs[name]
        idx = peak_index(seq)
        windowed = center_on_peak_velocity(seq)
        assert windowed.shape == (SEQUENCE_LENGTH, FEATURE_SIZE), windowed.shape
        print(f"//   {name}: n={n} peakAt={peak_at} pose={str(pose).lower()} "
              f"slot={slot}  ->  expected peak index {idx}")


if __name__ == "__main__":
    main()
