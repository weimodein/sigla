"""
Deterministic synthetic frames for clip-preparation tests, shared by
test_clip_prep.py and tools/gen_tap_clip_fixtures.py.

sigla-mobile's TapClipSynth.kt rebuilds byte-identical frames from the same
(pattern, slope, peak_at, jump), so only expected OUTPUTS are shipped to Kotlin.
Change this file only together with TapClipSynth.kt.

Pattern tokens, one per ANALYZED frame:
  H  hand + pose      h  hand, no pose
  X  hand whose extent is implausible (fails hand_extent_ok) + pose
  -  no hand detected
"""
import re

import numpy as np

FEATURE_SIZE = 147
POSE_BASE = 126
NO_PEAK = 1_000_000


def expand(spec: str) -> str:
    """'5-40H4-' -> '-----' + 'H'*40 + '----'."""
    return "".join(tok * int(n) for n, tok in re.findall(r"(\d+)([Hh\-X])", spec))


def synth_frame(i: int, token: str, slope: float, peak_at: int, jump: float):
    if token == "-":
        return None
    pos = slope * i + (jump if i >= peak_at else 0.0)
    f = np.zeros(FEATURE_SIZE, dtype=np.float64)
    for j in range(21):
        f[j * 3] = 0.05 * j + pos
        f[j * 3 + 1] = 0.03 * j + 0.5 * pos
        f[j * 3 + 2] = 0.001 * j
    if token == "X":
        f[60] = 50.0  # landmark 20 x: extent far above MAX_HAND_EXTENT (5.0)
    if token in ("H", "X"):
        for k in range(7):
            f[POSE_BASE + k * 3] = 0.1 * k + pos
            f[POSE_BASE + k * 3 + 1] = 0.2 * k + 0.25 * pos
            f[POSE_BASE + k * 3 + 2] = 0.0
    return f.astype(np.float32)


def synth_sampled(pattern: str, slope: float, peak_at: int, jump: float):
    return [synth_frame(i, t, slope, peak_at, jump) for i, t in enumerate(pattern)]


def _sparse_pattern() -> str:
    # 29 hand frames among 80 analyzed, gaps of at most 2: coverage 0.3625 and a
    # short max gap pass, but 29 < 30 real frames. With total_frames=200 (> the
    # 86-frame budget) that is TOO_SPARSE, not TOO_SHORT.
    return "H--" * 22 + "H-" * 7


# (name, pattern, slope, peak_at, jump, total_frames, source_fps, expected_reason)
# expected_reason None = a 30-frame window is produced.
FINALIZE_CASES = [
    ("normal_45", expand("45H"), 0.05, 22, 1.0, 45, 24.0, None),
    ("exact_30_stretch", expand("30H"), 0.05, 15, 1.0, 30, 24.0, None),
    ("leading_trailing", expand("5-40H4-"), 0.05, 25, 1.0, 49, 24.0, None),
    ("corrupt_inside", expand("20H2X20H"), 0.05, 21, 1.0, 42, 24.0, None),
    ("downsampled_long", expand("70H"), 0.05, 35, 1.0, 88, 30.0, None),
    ("window_pose", expand("15H10h15H"), 0.05, 20, 1.0, 40, 24.0, "window_pose"),
    ("low_motion", expand("45H"), 0.001, NO_PEAK, 0.0, 45, 24.0, "low_motion"),
    ("min_hand_frames", expand("11H"), 0.05, 5, 1.0, 11, 24.0, "min_hand_frames"),
    ("hand_coverage", expand("20H60-"), 0.05, 10, 1.0, 80, 24.0, "hand_coverage"),
    ("pose_coverage", expand("20H20h"), 0.05, 20, 1.0, 40, 24.0, "pose_coverage"),
    ("hand_gap", expand("20H7-20H"), 0.05, 30, 1.0, 47, 24.0, "hand_gap"),
    ("too_short", expand("25H"), 0.05, 12, 1.0, 25, 24.0, "too_short"),
    ("too_sparse", _sparse_pattern(), 0.05, 40, 1.0, 200, 30.0, "too_sparse"),
]

# (total_frames, source_fps)
SAMPLE_CASES = [
    (45, 24.0), (60, 30.0), (90, 30.0), (200, 30.0), (20, 30.0),
    (30, 60.0), (250, 60.0), (100, 24.0), (64, 29.97), (1, 30.0), (37, 15.0),
]
