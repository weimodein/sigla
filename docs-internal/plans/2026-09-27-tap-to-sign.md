# Tap-to-Sign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tap translation mode to the SIGLA Android app: tap, sign one word, and the app classifies that single recorded sign with a model input prepared exactly the way training clips were prepared.

**Architecture:** The post-detection half of `sigla-ml/app/services/extract.py` moves into pure functions in a new `clip_prep.py` (no behaviour change). A pure Kotlin `ClipPreparer` re-implements those functions and is pinned to them by generated parity fixtures. A `TapSignSession` state machine (Idle → Ready → Recording → Processing) buffers camera frames; `MainActivity` routes frames to either the session (Tap) or the existing `PredictionService` (Live), and `PredictionService.classifyWindow` classifies the prepared 30-frame window.

**Tech Stack:** Kotlin (Android, JUnit 4 local unit tests), Python 3 + NumPy + pytest (`sigla-ml`), TFLite (existing), MediaPipe (existing).

**Spec:** `docs-internal/specs/2026-09-27-tap-to-sign-design.md`

## Global Constraints

- Tap mode is the default on fresh installs; the choice is persisted in `AppSettings`. Live mode keeps its current behaviour exactly.
- Recording starts on the first frame with a usable hand (detected and passing `handExtentOk`); it stops after **6** consecutive frames without a usable hand, on a tap, or at **4 s**. Ready times out after **5 s** with no usable hand.
- After a result or a message, the session returns to Idle; every sign needs a new tap (no auto re-arm).
- Signs with fewer than 30 hand frames are rejected ("Sign was too quick — try again, a little slower"), never padded.
- Clip preparation constants must equal the Python ones: `TARGET_SAMPLE_FPS = 24.0`, `TRIM_PAD_FRAMES = 4`, `MIN_DETECTED_HAND_FRAMES = 12`, `MIN_HAND_COVERAGE = 0.35`, `MIN_POSE_COVERAGE = 0.75`, `MAX_MISSING_HAND_SECONDS = 0.25`, `MAX_ANALYZED_FRAMES = 120`, `DEFAULT_SOURCE_FPS = 30.0`, `SEQUENCE_LENGTH = 30`, `FEATURE_SIZE = 147`.
- Acceptance of a tap result: top-1 probability ≥ `MOTION_THRESHOLD` (0.80) and top-1 minus top-2 ≥ `MOTION_MIN_MARGIN` (0.15). Below that → "Not recognized — try again".
- The refactor of `extract.py` must not change any extracted output. Verify with the snapshot tool in Task 1.
- Never regenerate parity fixtures to make a failing test pass: a failure means Python and Kotlin have diverged.
- User-facing copy, exactly: "Tap to sign", "Ready — start signing", "No hands seen — tap and try again", "Sign was too quick — try again, a little slower", "Keep your hands in frame", "Step back so your shoulders are in view", "No clear movement — try again", "Not recognized — try again".
- Deliberate deviation from pure parity (documented in code): the phone caps the TRAILING trim pad at `floor(MAX_MISSING_HAND_SECONDS × fps)` frames, so at camera rates below 16 fps the pad alone cannot trip the hand-gap gate. At ≥ 16 fps it is exactly 4, as in training.

## Environment

- Python (run from `sigla-ml/`): `venv/Scripts/python.exe -m pytest tests/ -v`
- Kotlin tests (run from `sigla-mobile/`, Git Bash). Java is not on PATH:
  `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" && ./gradlew testDebugUnitTest`
  Single class: append `--tests com.example.sigla.ClipPreparerTest`.
- Dataset clips for the refactor snapshot are local (gitignored): `datasets/trimmed_clips/<class>/<signer>/<n>.mp4` (~1,959 files).

## Review Focus

1. **Camera below 24 fps (low light, thermal throttling).** Expect a normal sign still to classify rather than fail the hand-gap gate. Pinned by `lowFpsRecordingIsNotRejectedForHandGap` (Task 2).
2. **Hands never leave the frame** (signer rests in view). Expect the 4 s cap to end the recording and produce a result or a message, never a stuck "Recording". Pinned by `capStopsRecordingAtFourSeconds` (Task 5).
3. **Stop tapped immediately after recording starts** (a handful of frames). Expect "Sign was too quick", no crash. Pinned by `veryShortRecordingIsTooQuick` (Task 2).
4. **Mode, vocabulary or camera switched while Processing.** Expect the late result to be discarded, not shown under the new setup. Pinned by `cancelDuringProcessingDiscardsTheResult` (Task 5).
5. **An occasional glitched hand frame mid-sign** (fails `handExtentOk`). Expect recording to continue; only 6 consecutive bad frames stop it. Pinned by `isolatedBadFramesDoNotStopRecording` (Task 5).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `sigla-ml/app/services/clip_prep.py` | Create | Pure post-detection pipeline: constants, `ExtractionQualityError` with `reason`, `sample_indices`, `finalize_sampled` |
| `sigla-ml/app/services/extract.py` | Modify | Decode + detect only; delegates to `clip_prep`; re-exports moved names |
| `sigla-ml/tools/extract_snapshot.py` | Create | Before/after snapshot of `extract_motion_landmarks` over real clips |
| `sigla-ml/tests/_tap_clip_synth.py` | Create | Deterministic synthetic frames + the shared case table |
| `sigla-ml/tests/test_clip_prep.py` | Create | Python-side expectations for every case |
| `sigla-ml/tools/gen_tap_clip_fixtures.py` | Create | Writes `TapClipFixtures.kt` from the real Python functions |
| `sigla-ml/tests/test_mobile_parity_flags.py` | Modify | Kotlin `TAP_*` constants equal the Python ones |
| `sigla-mobile/.../ClipPreparer.kt` | Create | Kotlin mirror: trim, fps estimate, sampling, finalize, stretch, window |
| `sigla-mobile/.../TapSignSession.kt` | Create | State machine + rejection-message mapping |
| `sigla-mobile/.../PredictionService.kt` | Modify | `posePresent` → internal; `runOnWindow` extraction; `acceptSingleWindow`; `classifyWindow` |
| `sigla-mobile/.../AppSettings.kt` | Modify | `translationMode`, default tap |
| `sigla-mobile/.../MainActivity.kt` | Modify | Mode toggle, frame routing, tap UI, result display |
| `sigla-mobile/app/src/main/res/layout/activity_main.xml` | Modify | Record button + ring + prompt; mode toggle; ids on live-only views |
| `sigla-mobile/app/src/test/.../TapClipSynth.kt` | Create | Kotlin twin of `_tap_clip_synth.py` |
| `sigla-mobile/app/src/test/.../ClipPreparerTest.kt` | Create | Behaviour tests |
| `sigla-mobile/app/src/test/.../TapClipFixtures.kt` | Generated | Parity goldens |
| `sigla-mobile/app/src/test/.../ClipPreparerParityTest.kt` | Create | Kotlin vs Python goldens |
| `sigla-mobile/app/src/test/.../TapAcceptanceTest.kt` | Create | `acceptSingleWindow` policy |
| `sigla-mobile/app/src/test/.../TapSignSessionTest.kt` | Create | State machine tests |

`...` = `app/src/main/kotlin/com/example/sigla` for main code and `app/src/test/kotlin/com/example/sigla` for tests.

---

### Task 1: Move extract.py's post-detection pipeline into `clip_prep.py` (no behaviour change)

**Files:**
- Create: `sigla-ml/tools/extract_snapshot.py`
- Create: `sigla-ml/app/services/clip_prep.py`
- Modify: `sigla-ml/app/services/extract.py`
- Create: `sigla-ml/tests/_tap_clip_synth.py`
- Create: `sigla-ml/tests/test_clip_prep.py`

**Interfaces:**
- Produces:
  - `clip_prep.ExtractionQualityError(message: str, reason: str = "quality")`, attribute `.reason`
  - `clip_prep.REASON_MIN_HAND_FRAMES = "min_hand_frames"`, `REASON_HAND_COVERAGE = "hand_coverage"`, `REASON_POSE_COVERAGE = "pose_coverage"`, `REASON_HAND_GAP = "hand_gap"`, `REASON_TOO_SHORT = "too_short"`, `REASON_TOO_SPARSE = "too_sparse"`, `REASON_LOW_MOTION = "low_motion"`, `REASON_WINDOW_POSE = "window_pose"`
  - `clip_prep.sample_budget() -> int`
  - `clip_prep.sample_indices(total_frames: int, source_fps: float) -> SamplePlan` with fields `indices: np.ndarray`, `rate_count: int`, `budget: int`, property `over_budget: bool`
  - `clip_prep.finalize_sampled(sampled: list[np.ndarray | None], total_frames: int, source_fps: float) -> np.ndarray` of shape (30, 147), float32. Each entry of `sampled` is one ANALYZED frame in order: a NORMALIZED 147-float vector when a hand was detected, `None` otherwise.
  - `_tap_clip_synth.synth_sampled(pattern, slope, peak_at, jump)` and `_tap_clip_synth.FINALIZE_CASES`, `SAMPLE_CASES` (used by Task 3)

- [ ] **Step 1: Write the snapshot tool (before touching extract.py)**

Create `sigla-ml/tools/extract_snapshot.py`:

```python
"""
Snapshot extract_motion_landmarks over real clips, to prove a refactor changed
nothing.

    venv/Scripts/python.exe tools/extract_snapshot.py --out before.pkl
    ...refactor...
    venv/Scripts/python.exe tools/extract_snapshot.py --out after.pkl --compare before.pkl

Compares every clip's result exactly: the stored window must be bit-identical,
and a rejected clip must be rejected with the identical message.
"""
import argparse
import glob
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.extract import ExtractionQualityError, extract_motion_landmarks  # noqa: E402

_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_GLOB = os.path.join(_REPO, "datasets", "trimmed_clips", "*", "*", "*.mp4")


def pick(paths: list[str], limit: int) -> list[str]:
    """Spread `limit` picks evenly across the sorted list so many classes are covered."""
    paths = sorted(paths)
    if len(paths) <= limit:
        return paths
    step = len(paths) / limit
    return [paths[int(i * step)] for i in range(limit)]


def snapshot(paths: list[str]) -> dict:
    out = {}
    for p in paths:
        with open(p, "rb") as f:
            data = f.read()
        try:
            seq = extract_motion_landmarks(data, os.path.basename(p))
            out[p] = ("ok", None if seq is None else np.asarray(seq, dtype=np.float32))
        except ExtractionQualityError as e:
            out[p] = ("rejected", str(e))
    return out


def compare(before: dict, after: dict) -> int:
    diffs = 0
    for p, (kind_b, val_b) in before.items():
        kind_a, val_a = after.get(p, ("missing", None))
        same = kind_a == kind_b and (
            (val_a is None and val_b is None)
            or (isinstance(val_b, str) and val_a == val_b)
            or (isinstance(val_b, np.ndarray) and isinstance(val_a, np.ndarray)
                and val_a.shape == val_b.shape and np.array_equal(val_a, val_b))
        )
        if not same:
            diffs += 1
            print(f"DIFF {p}: before={kind_b} after={kind_a}")
    print(f"{len(before)} clips compared, {diffs} differ")
    return diffs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--glob", default=DEFAULT_GLOB)
    ap.add_argument("--limit", type=int, default=80)
    ap.add_argument("--compare")
    args = ap.parse_args()

    paths = pick(glob.glob(args.glob), args.limit)
    if not paths:
        print(f"no clips match {args.glob}")
        return 2
    snap = snapshot(paths)
    with open(args.out, "wb") as f:
        pickle.dump(snap, f)
    ok = sum(1 for k, _ in snap.values() if k == "ok")
    print(f"{len(snap)} clips: {ok} ok, {len(snap) - ok} rejected -> {args.out}")
    if args.compare:
        with open(args.compare, "rb") as f:
            return 1 if compare(pickle.load(f), snap) else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Take the "before" snapshot**

Run from `sigla-ml/`:
`venv/Scripts/python.exe tools/extract_snapshot.py --out ../scratch/extract_before.pkl`
Expected: `80 clips: N ok, M rejected -> ../scratch/extract_before.pkl`. Some rejections are fine. What matters is the comparison later. If `scratch/` does not exist, create it (it is untracked).

- [ ] **Step 3: Write the synthetic-frame helper and case table**

Create `sigla-ml/tests/_tap_clip_synth.py`. `TapClipSynth.kt` (Task 2) must mirror it exactly, so keep the arithmetic in the same order:

```python
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
```

- [ ] **Step 4: Write the failing Python tests**

Create `sigla-ml/tests/test_clip_prep.py`:

```python
"""Behaviour of the pure clip-preparation pipeline shared with sigla-mobile."""
import numpy as np
import pytest

from app.services.clip_prep import (
    ExtractionQualityError,
    finalize_sampled,
    sample_budget,
    sample_indices,
)
from tests._tap_clip_synth import FINALIZE_CASES, SAMPLE_CASES, synth_sampled


def test_sample_budget_is_86():
    # ceil(30 / 0.35) = 86, between the 60 floor and the 120 ceiling.
    assert sample_budget() == 86


@pytest.mark.parametrize("total,fps", SAMPLE_CASES)
def test_sample_indices_are_in_range_and_ordered(total, fps):
    plan = sample_indices(total, fps)
    idx = plan.indices
    assert len(idx) >= 1
    assert idx.min() >= 0 and idx.max() <= total - 1
    assert np.all(np.diff(idx) >= 0)


def test_rate_path_samples_at_24fps():
    # 60 frames at 30 fps: stride 1.25 -> 48 samples, inside [30, 86].
    plan = sample_indices(60, 30.0)
    assert len(plan.indices) == 48 and not plan.over_budget


def test_over_budget_falls_back_to_even_spread():
    plan = sample_indices(250, 60.0)  # rate path wants 100 > 86
    assert plan.over_budget and len(plan.indices) == 86


@pytest.mark.parametrize("case", FINALIZE_CASES, ids=[c[0] for c in FINALIZE_CASES])
def test_finalize_cases(case):
    name, pattern, slope, peak_at, jump, total, fps, expected = case
    sampled = synth_sampled(pattern, slope, peak_at, jump)
    if expected is None:
        window = finalize_sampled(sampled, total, fps)
        assert window.shape == (30, 147)
        assert window.dtype == np.float32
    else:
        with pytest.raises(ExtractionQualityError) as err:
            finalize_sampled(sampled, total, fps)
        assert err.value.reason == expected
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest tests/test_clip_prep.py -v`
Expected: collection ERROR, `ModuleNotFoundError: No module named 'app.services.clip_prep'`.

- [ ] **Step 6: Create `clip_prep.py`**

Create `sigla-ml/app/services/clip_prep.py`. Then **cut** the following assignments, each with the comment block directly above it, out of `extract.py` and paste them where marked: `MIN_DETECTED_HAND_FRAMES`, `MIN_HAND_COVERAGE`, `MIN_POSE_COVERAGE`, `MIN_SEQUENCE_MOTION`, `MAX_MISSING_HAND_SECONDS`, `MAX_ANALYZED_FRAMES`, `TARGET_SAMPLE_FPS`, `MIN_POSE_WINDOW_COVERAGE`. Leave `DEFAULT_SOURCE_FPS`, `TRIM_TO_SIGNING_SPAN`, `TRIM_SCAN_FRAMES`, `TRIM_PAD_FRAMES` and the model paths in `extract.py`. Also cut the `ExtractionQualityError` class (it is replaced below).

```python
"""
Post-detection half of extract_motion_landmarks, as pure functions.

extract.py decodes a clip and runs MediaPipe on the frames chosen by
sample_indices(); everything after detection happens in finalize_sampled().
sigla-mobile's ClipPreparer.kt re-implements THESE two functions for
tap-to-sign mode, and tools/gen_tap_clip_fixtures.py pins them together. A
behaviour change here must be made on both sides, and needs a retrain.
"""
import os
from typing import NamedTuple

import numpy as np

from app.utils.preprocessor import (
    SEQUENCE_LENGTH,
    _pose_present,
    center_on_peak_velocity,
    frame_velocity,
    hand_extent_ok,
)

# ── Constants moved verbatim from extract.py (with their comments) ──────────
# PASTE HERE: MIN_DETECTED_HAND_FRAMES, MIN_HAND_COVERAGE, MIN_POSE_COVERAGE,
# MIN_SEQUENCE_MOTION, MAX_MISSING_HAND_SECONDS, MAX_ANALYZED_FRAMES,
# TARGET_SAMPLE_FPS, MIN_POSE_WINDOW_COVERAGE


class ExtractionQualityError(ValueError):
    """The video decoded, but does not contain enough reliable training signal.

    `reason` is a stable machine-readable code (a REASON_* constant below). The
    message is for people. sigla-mobile maps the same codes to its own copy.
    """

    def __init__(self, message: str, reason: str = "quality"):
        super().__init__(message)
        self.reason = reason


REASON_MIN_HAND_FRAMES = "min_hand_frames"
REASON_HAND_COVERAGE = "hand_coverage"
REASON_POSE_COVERAGE = "pose_coverage"
REASON_HAND_GAP = "hand_gap"
REASON_TOO_SHORT = "too_short"
REASON_TOO_SPARSE = "too_sparse"
REASON_LOW_MOTION = "low_motion"
REASON_WINDOW_POSE = "window_pose"


class SamplePlan(NamedTuple):
    indices: np.ndarray
    rate_count: int
    budget: int

    @property
    def over_budget(self) -> bool:
        return self.rate_count > self.budget


def sample_budget() -> int:
    """Frames that let a clip at the MIN_HAND_COVERAGE floor still yield
    SEQUENCE_LENGTH frames WITH a hand in them, capped by MAX_ANALYZED_FRAMES."""
    needed_for_floor = int(np.ceil(SEQUENCE_LENGTH / max(MIN_HAND_COVERAGE, 1e-6)))
    return min(max(SEQUENCE_LENGTH * 2, needed_for_floor), MAX_ANALYZED_FRAMES)


def sample_indices(total_frames: int, source_fps: float) -> SamplePlan:
    """Indices (relative to the signing-span start) of the frames to analyze.

    Samples at a fixed RATE (TARGET_SAMPLE_FPS), not a fixed count, so one
    analyzed frame is worth the same wall-clock time on every clip. Falls back to
    an even spread when the rate path yields fewer than SEQUENCE_LENGTH frames or
    more than the budget.
    """
    budget = sample_budget()
    stride_for_rate = max(source_fps / max(TARGET_SAMPLE_FPS, 1e-6), 1.0)
    rate_count = int(np.floor(total_frames / stride_for_rate))
    if rate_count >= SEQUENCE_LENGTH and rate_count <= budget:
        indices = (np.arange(rate_count) * stride_for_rate).astype(int)
        return SamplePlan(np.clip(indices, 0, total_frames - 1), rate_count, budget)
    sample_count = min(total_frames, budget)
    return SamplePlan(
        np.linspace(0, total_frames - 1, sample_count, dtype=int), rate_count, budget
    )


def finalize_sampled(sampled: list, total_frames: int, source_fps: float) -> np.ndarray:
    """Gates, stretch, and windowing over the analyzed frames of one clip.

    `sampled` holds one entry per ANALYZED frame, in order: a NORMALIZED
    147-float vector when a hand was detected, else None. Pose presence is read
    from the vector (an absent pose is the 21-zero sentinel).

    Returns the (SEQUENCE_LENGTH, 147) float32 window, or raises
    ExtractionQualityError with a REASON_* code.
    """
    sequence = []
    analyzed_frames = 0
    detected_hand_frames = 0
    detected_pose_frames = 0
    corrupt_frames = 0
    current_gap = 0
    max_consecutive_gap = 0

    for vec in sampled:
        analyzed_frames += 1
        if vec is None:
            # A frame with no detected hand is DROPPED, not repeated. See the
            # history note that used to live in extract.py's loop: repeating it
            # taught the model frozen stretches the phone never produces.
            if sequence:
                current_gap += 1
            continue
        # Drop a collapsed MediaPipe detection exactly like a hands-less frame,
        # and do not count it as a frame with a hand (or with a pose).
        if not hand_extent_ok(vec):
            corrupt_frames += 1
            if sequence:
                current_gap += 1
            continue
        detected_hand_frames += 1
        if _pose_present(vec):
            detected_pose_frames += 1
        sequence.append(vec)
        if current_gap > max_consecutive_gap:
            max_consecutive_gap = current_gap
        current_gap = 0

    if detected_hand_frames < MIN_DETECTED_HAND_FRAMES:
        raise ExtractionQualityError(
            f"Only {detected_hand_frames} frames had a detectable hand; "
            f"at least {MIN_DETECTED_HAND_FRAMES} are required. Keep the hand "
            "fully visible and record the complete sign.",
            reason=REASON_MIN_HAND_FRAMES,
        )

    hand_coverage = detected_hand_frames / max(analyzed_frames, 1)
    if hand_coverage < MIN_HAND_COVERAGE:
        corrupt_note = (
            f" {corrupt_frames} frame(s) were dropped for an implausible hand "
            "shape, which is a tracking failure rather than framing."
            if corrupt_frames else ""
        )
        raise ExtractionQualityError(
            f"A hand was visible in only {hand_coverage:.0%} of analyzed frames; "
            f"at least {MIN_HAND_COVERAGE:.0%} is required. Keep the signing "
            f"hand(s) inside the frame for the whole clip.{corrupt_note}",
            reason=REASON_HAND_COVERAGE,
        )
    pose_coverage = detected_pose_frames / max(detected_hand_frames, 1)
    if pose_coverage < MIN_POSE_COVERAGE:
        raise ExtractionQualityError(
            f"Upper-body pose was visible in only {pose_coverage:.0%} of hand "
            f"frames; at least {MIN_POSE_COVERAGE:.0%} is required. Frame the "
            "head, shoulders, elbows, wrists, and hands.",
            reason=REASON_POSE_COVERAGE,
        )
    # Trailing gap counts too: a clip whose hands leave and never return ends
    # with current_gap unflushed.
    if current_gap > max_consecutive_gap:
        max_consecutive_gap = current_gap
    stride = (total_frames / analyzed_frames) if analyzed_frames else 1.0
    max_gap_seconds = (max_consecutive_gap * stride) / source_fps
    if max_gap_seconds > MAX_MISSING_HAND_SECONDS:
        raise ExtractionQualityError(
            f"The signing hand left the frame for {max_gap_seconds:.2f}s in a row; "
            f"at most {MAX_MISSING_HAND_SECONDS:.2f}s is allowed. Re-record with "
            "the hand(s) staying in view — a dropout this long ends the gesture "
            "on-device instead of being classified.",
            reason=REASON_HAND_GAP,
        )
    if len(sequence) < SEQUENCE_LENGTH:
        observed = detected_hand_frames / max(analyzed_frames, 1)
        frames_needed = int(np.ceil(SEQUENCE_LENGTH / max(observed, 1e-6)))
        if analyzed_frames < frames_needed and total_frames <= sample_budget():
            raise ExtractionQualityError(
                f"The clip is too short: {len(sequence)} of {analyzed_frames} "
                f"analyzed frames had a detectable hand, but {SEQUENCE_LENGTH} "
                "are needed to fill the model's window without padding. At this "
                f"hand visibility ({observed:.0%}) the clip needs roughly "
                f"{frames_needed} frames (~{frames_needed / 30.0:.1f}s at 30fps). "
                "Record for longer, or keep the hand(s) in frame more of the time.",
                reason=REASON_TOO_SHORT,
            )
        raise ExtractionQualityError(
            f"Only {len(sequence)} of {analyzed_frames} analyzed frames had a "
            f"detectable hand, but {SEQUENCE_LENGTH} are needed to fill the "
            "model's window without padding. Keep the signing hand(s) in frame "
            "for more of the clip.",
            reason=REASON_TOO_SPARSE,
        )

    seq_np = np.array(sequence, dtype=np.float32)
    # Exactly SEQUENCE_LENGTH frames cannot be windowed (the only window is the
    # clip itself), so resample slightly above it to give the search real choice.
    if len(seq_np) == SEQUENCE_LENGTH:
        target = SEQUENCE_LENGTH * 2
        src = np.linspace(0, SEQUENCE_LENGTH - 1, target)
        seq_np = np.array(
            [np.interp(src, np.arange(SEQUENCE_LENGTH), seq_np[:, c])
             for c in range(seq_np.shape[1])],
            dtype=np.float32,
        ).T
    seq_np = center_on_peak_velocity(seq_np, force=True)
    if len(seq_np) != SEQUENCE_LENGTH:
        raise ExtractionQualityError(
            f"windowed sequence is {len(seq_np)} frames, expected {SEQUENCE_LENGTH}",
            reason="window_width",
        )

    # Motion energy and pose coverage of the FINAL window — what is trained on.
    motion_energy = sum(
        frame_velocity(seq_np[i - 1], seq_np[i]) for i in range(1, len(seq_np))
    )
    if motion_energy < MIN_SEQUENCE_MOTION:
        raise ExtractionQualityError(
            f"The stored window contains too little gesture motion "
            f"({motion_energy:.3f}); minimum is {MIN_SEQUENCE_MOTION:.3f}. "
            "Record the complete movement, not a held pose or frozen clip.",
            reason=REASON_LOW_MOTION,
        )
    window_pose_frames = int(sum(1 for f in seq_np if _pose_present(f)))
    window_pose_coverage = window_pose_frames / SEQUENCE_LENGTH
    if window_pose_coverage < MIN_POSE_WINDOW_COVERAGE:
        raise ExtractionQualityError(
            f"Upper-body pose is present in only {window_pose_frames}/"
            f"{SEQUENCE_LENGTH} frames of the stored window "
            f"({window_pose_coverage:.0%}); at least "
            f"{MIN_POSE_WINDOW_COVERAGE:.0%} is required. The app refuses to "
            "classify a window this sparse, so it cannot be trained on either.",
            reason=REASON_WINDOW_POSE,
        )
    return seq_np
```

**One behaviour detail to preserve:** the old code returned `None` (and printed a warning) when the window width was wrong. Keep that in `extract.py` (Step 7) by catching `reason == "window_width"`. Compare every message string above character for character with the original in `extract.py` before deleting the original. The snapshot comparison in Step 9 fails on any difference in a rejection message.

- [ ] **Step 7: Make `extract.py` delegate**

In `extract.py`, add after the existing `from app.utils.preprocessor import (...)` block:

```python
# Moved to clip_prep so sigla-mobile's ClipPreparer can mirror them; re-exported
# because tests and tools import these names from here.
from app.services.clip_prep import (  # noqa: E402,F401
    ExtractionQualityError,
    MAX_ANALYZED_FRAMES,
    MAX_MISSING_HAND_SECONDS,
    MIN_DETECTED_HAND_FRAMES,
    MIN_HAND_COVERAGE,
    MIN_POSE_COVERAGE,
    MIN_POSE_WINDOW_COVERAGE,
    MIN_SEQUENCE_MOTION,
    TARGET_SAMPLE_FPS,
    finalize_sampled,
    sample_indices,
)
```

Then, inside `extract_motion_landmarks`, replace everything from the comment `# Sample enough frames that a clip at the MIN_HAND_COVERAGE floor` down to and including `return seq_np.tolist()` (keep the `finally:` block) with:

```python
        plan = sample_indices(total_frames, source_fps)
        if plan.over_budget:
            print(f"[extract] {filename or '<clip>'}: {total_frames}f @ {source_fps:.1f}fps "
                  f"needs {plan.rate_count} samples at {TARGET_SAMPLE_FPS}fps but the budget is "
                  f"{plan.budget}; falling back to even sampling "
                  f"(~{source_fps * plan.budget / max(total_frames, 1):.1f}fps effective)")

        # One entry per analyzed frame: the NORMALIZED feature vector when a hand
        # was detected, else None. Normalizing per frame here is identical to the
        # old normalize_sequence() after the loop, because normalization is per
        # frame. finalize_sampled() does the rest; see clip_prep.py.
        sampled = []
        with _make_landmarker() as landmarker, _make_pose_landmarker() as pose_landmarker:
            for idx in plan.indices:
                # `indices` are relative to the signing span, so shift them back
                # onto real file positions. span_start is 0 when trimming is off.
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(span_start + idx))
                ret, frame = cap.read()
                if not ret:
                    continue
                result = _detect(landmarker, frame)
                if not result.hand_landmarks:
                    sampled.append(None)
                    continue
                # Pose is only detected on frames that have hands — matches
                # HandLandmarkHelper.detect() (IMAGE-mode / offline extraction path).
                pose_result = _detect_pose(pose_landmarker, frame)
                pose_landmarks = (
                    pose_result.pose_landmarks[0] if pose_result.pose_landmarks else None
                )
                frame_vec = _build_feature_vector(result.hand_landmarks, pose_landmarks)
                sampled.append(normalize_frame(np.asarray(frame_vec, dtype=np.float32)))

        try:
            seq_np = finalize_sampled(sampled, total_frames, source_fps)
        except ExtractionQualityError as e:
            if e.reason == "window_width":
                print(f"[extract] WARNING: {e} — refusing to store a wrong-width sample")
                return None
            raise
        return seq_np.tolist()
```

Leave the imports of `center_on_peak_velocity`, `frame_velocity`, `hand_extent_ok` and `normalize_sequence` in place, even though some become unused. It keeps the diff small.

- [ ] **Step 8: Run the Python tests**

Run: `venv/Scripts/python.exe -m pytest tests/ -v`
Expected: all pass, including every `test_finalize_cases[...]` id and the existing `test_parity.py` / `test_mobile_parity_flags.py`. If a `test_finalize_cases` case gives a different reason than listed, investigate the synthetic pattern (Step 3) before changing any expectation. The table encodes the spec's rules.

- [ ] **Step 9: Prove extraction output is unchanged**

Run: `venv/Scripts/python.exe tools/extract_snapshot.py --out ../scratch/extract_after.pkl --compare ../scratch/extract_before.pkl`
Expected: `80 clips compared, 0 differ` and exit code 0. Any DIFF line means the refactor changed behaviour. Fix it before continuing.

- [ ] **Step 10: Commit**

```bash
git add sigla-ml/app/services/clip_prep.py sigla-ml/app/services/extract.py sigla-ml/tools/extract_snapshot.py sigla-ml/tests/_tap_clip_synth.py sigla-ml/tests/test_clip_prep.py
git commit -m "refactor(ml): move extract post-detection pipeline into pure clip_prep functions"
```

---

### Task 2: Kotlin `ClipPreparer` (trim, fps, sampling, finalize)

**Files:**
- Modify: `sigla-mobile/app/src/main/kotlin/com/example/sigla/PredictionService.kt:152` (`private fun posePresent` → `internal fun posePresent`)
- Create: `sigla-mobile/app/src/main/kotlin/com/example/sigla/ClipPreparer.kt`
- Create: `sigla-mobile/app/src/test/kotlin/com/example/sigla/TapClipSynth.kt`
- Create: `sigla-mobile/app/src/test/kotlin/com/example/sigla/ClipPreparerTest.kt`

**Interfaces:**
- Consumes (existing, same package): `handExtentOk(FloatArray): Boolean` (HandLandmarkHelper.kt), `peakVelocityIndex(List<FloatArray>): Int`, `hasSufficientMotion(List<FloatArray>): Boolean`, `hasSufficientPoseCoverage(List<FloatArray>): Boolean`, `posePresent(FloatArray): Boolean` (PredictionService.kt)
- Produces:
  - `class RecordedFrame(val timestampMs: Long, val features: FloatArray?)` (features = normalized vector when a hand was DETECTED, else null)
  - `enum class ClipRejection(val code: String)`: `NO_HANDS("no_hands")`, `MIN_HAND_FRAMES("min_hand_frames")`, `HAND_COVERAGE("hand_coverage")`, `POSE_COVERAGE("pose_coverage")`, `HAND_GAP("hand_gap")`, `TOO_SHORT("too_short")`, `TOO_SPARSE("too_sparse")`, `LOW_MOTION("low_motion")`, `WINDOW_POSE("window_pose")`
  - `sealed class ClipOutcome { class Window(val frames: List<FloatArray>); class Rejected(val reason: ClipRejection) }`
  - `object ClipPreparer` with `fun prepare(recording: List<RecordedFrame>): ClipOutcome`, and internals `estimateSourceFps(List<RecordedFrame>): Double`, `trimToSigningSpan(List<RecordedFrame>, Double): List<RecordedFrame>?`, `sampleBudget(): Int`, `sampleIndices(Int, Double): IntArray`, `finalizeSampled(List<FloatArray?>, Int, Double): ClipOutcome`
  - Constants `TAP_SEQUENCE_LENGTH`, `TAP_FEATURE_SIZE`, `TAP_TARGET_SAMPLE_FPS`, `TAP_MIN_DETECTED_HAND_FRAMES`, `TAP_MIN_HAND_COVERAGE`, `TAP_MIN_POSE_COVERAGE`, `TAP_MAX_MISSING_HAND_SECONDS`, `TAP_MAX_ANALYZED_FRAMES`, `TAP_TRIM_PAD_FRAMES`, `TAP_DEFAULT_SOURCE_FPS`
  - Test helper `object TapClipSynth { fun frame(...); fun sampled(pattern: String, slope: Double, peakAt: Int, jump: Double): List<FloatArray?>; fun expand(spec: String): String; const val NO_PEAK = 1_000_000 }`

- [ ] **Step 1: Write the Kotlin synthetic helper**

Create `sigla-mobile/app/src/test/kotlin/com/example/sigla/TapClipSynth.kt`. It must produce byte-identical frames to `sigla-ml/tests/_tap_clip_synth.py`, with the same arithmetic order in double precision, then cast to float:

```kotlin
package com.example.sigla

/** Kotlin twin of sigla-ml/tests/_tap_clip_synth.py. Change both together. */
internal object TapClipSynth {
    const val NO_PEAK = 1_000_000

    fun expand(spec: String): String =
        Regex("(\\d+)([Hh\\-X])").findAll(spec)
            .joinToString("") { m -> m.groupValues[2].repeat(m.groupValues[1].toInt()) }

    fun frame(i: Int, token: Char, slope: Double, peakAt: Int, jump: Double): FloatArray? {
        if (token == '-') return null
        val pos = slope * i + (if (i >= peakAt) jump else 0.0)
        val f = DoubleArray(147)
        for (j in 0 until 21) {
            f[j * 3] = 0.05 * j + pos
            f[j * 3 + 1] = 0.03 * j + 0.5 * pos
            f[j * 3 + 2] = 0.001 * j
        }
        if (token == 'X') f[60] = 50.0
        if (token == 'H' || token == 'X') {
            for (k in 0 until 7) {
                f[126 + k * 3] = 0.1 * k + pos
                f[126 + k * 3 + 1] = 0.2 * k + 0.25 * pos
                f[126 + k * 3 + 2] = 0.0
            }
        }
        return FloatArray(147) { f[it].toFloat() }
    }

    fun sampled(pattern: String, slope: Double, peakAt: Int, jump: Double): List<FloatArray?> =
        pattern.mapIndexed { i, c -> frame(i, c, slope, peakAt, jump) }

    /** A recording at a steady frame rate, one RecordedFrame per pattern token. */
    fun recording(pattern: String, fps: Double, slope: Double = 0.05,
                  peakAt: Int = NO_PEAK, jump: Double = 0.0): List<RecordedFrame> =
        pattern.mapIndexed { i, c ->
            RecordedFrame(timestampMs = (i * 1000.0 / fps).toLong(),
                          features = frame(i, c, slope, peakAt, jump))
        }
}
```

- [ ] **Step 2: Write the failing behaviour tests**

Create `sigla-mobile/app/src/test/kotlin/com/example/sigla/ClipPreparerTest.kt`:

```kotlin
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipPreparerTest {

    private fun reason(o: ClipOutcome): ClipRejection? = (o as? ClipOutcome.Rejected)?.reason

    @Test
    fun sampleBudgetIs86() = assertEquals(86, ClipPreparer.sampleBudget())

    @Test
    fun ratePathSamplesAt24fps() {
        val idx = ClipPreparer.sampleIndices(60, 30.0)   // stride 1.25 -> 48
        assertEquals(48, idx.size)
        assertEquals(0, idx.first())
        assertEquals(58, idx.last())                      // floor(47 * 1.25)
    }

    @Test
    fun overBudgetSpreadsEvenly() {
        val idx = ClipPreparer.sampleIndices(250, 60.0)  // wants 100 > 86
        assertEquals(86, idx.size)
        assertEquals(249, idx.last())
    }

    @Test
    fun estimateFpsFromTimestamps() {
        val rec = TapClipSynth.recording(TapClipSynth.expand("31H"), fps = 30.0)
        assertEquals(30.0, ClipPreparer.estimateSourceFps(rec), 0.5)
    }

    @Test
    fun estimateFpsFallsBackForOneFrame() {
        val rec = TapClipSynth.recording("H", fps = 30.0)
        assertEquals(TAP_DEFAULT_SOURCE_FPS, ClipPreparer.estimateSourceFps(rec), 0.0)
    }

    @Test
    fun trimKeepsFourFramesEachSide() {
        val rec = TapClipSynth.recording(TapClipSynth.expand("10-20H10-"), fps = 30.0)
        val span = ClipPreparer.trimToSigningSpan(rec, 30.0)!!
        assertEquals(4 + 20 + 4, span.size)
        assertNull(span.first().features)
        assertTrue(span[4].features != null)
    }

    @Test
    fun trimReturnsNullWithoutHands() =
        assertNull(ClipPreparer.trimToSigningSpan(TapClipSynth.recording("------", 30.0), 30.0))

    @Test
    fun normalSignProducesWindow() {
        val sampled = TapClipSynth.sampled(TapClipSynth.expand("45H"), 0.05, 22, 1.0)
        val out = ClipPreparer.finalizeSampled(sampled, 45, 24.0)
        assertTrue(out is ClipOutcome.Window)
        val w = (out as ClipOutcome.Window).frames
        assertEquals(30, w.size)
        assertEquals(147, w[0].size)
    }

    @Test
    fun exactlyThirtyFramesIsStretchedThenWindowed() {
        val sampled = TapClipSynth.sampled(TapClipSynth.expand("30H"), 0.05, 15, 1.0)
        assertTrue(ClipPreparer.finalizeSampled(sampled, 30, 24.0) is ClipOutcome.Window)
    }

    @Test
    fun rejectionReasons() {
        fun r(spec: String, slope: Double, peak: Int, jump: Double, total: Int, fps: Double) =
            reason(ClipPreparer.finalizeSampled(
                TapClipSynth.sampled(TapClipSynth.expand(spec), slope, peak, jump), total, fps))
        assertEquals(ClipRejection.MIN_HAND_FRAMES, r("11H", 0.05, 5, 1.0, 11, 24.0))
        assertEquals(ClipRejection.HAND_COVERAGE, r("20H60-", 0.05, 10, 1.0, 80, 24.0))
        assertEquals(ClipRejection.POSE_COVERAGE, r("20H20h", 0.05, 20, 1.0, 40, 24.0))
        assertEquals(ClipRejection.HAND_GAP, r("20H7-20H", 0.05, 30, 1.0, 47, 24.0))
        assertEquals(ClipRejection.TOO_SHORT, r("25H", 0.05, 12, 1.0, 25, 24.0))
        assertEquals(ClipRejection.LOW_MOTION,
            r("45H", 0.001, TapClipSynth.NO_PEAK, 0.0, 45, 24.0))
        assertEquals(ClipRejection.WINDOW_POSE, r("15H10h15H", 0.05, 20, 1.0, 40, 24.0))
    }

    @Test
    fun tooSparseWhenLongClipHasFewHandFrames() {
        val pattern = "H--".repeat(22) + "H-".repeat(7)
        val out = ClipPreparer.finalizeSampled(
            TapClipSynth.sampled(pattern, 0.05, 40, 1.0), 200, 30.0)
        assertEquals(ClipRejection.TOO_SPARSE, reason(out))
    }

    @Test
    fun corruptFramesAreDroppedNotFatal() {
        val sampled = TapClipSynth.sampled(TapClipSynth.expand("20H2X20H"), 0.05, 21, 1.0)
        assertTrue(ClipPreparer.finalizeSampled(sampled, 42, 24.0) is ClipOutcome.Window)
    }

    @Test
    fun prepareEndToEndOnARealisticRecording() {
        // Ready pre-roll (4 no-hand), 50 hand frames, 6 no-hand frames that triggered auto-stop.
        val rec = TapClipSynth.recording(TapClipSynth.expand("4-50H6-"), fps = 30.0,
                                         peakAt = 30, jump = 1.0)
        assertTrue(ClipPreparer.prepare(rec) is ClipOutcome.Window)
    }

    // Review Focus 1.
    @Test
    fun lowFpsRecordingIsNotRejectedForHandGap() {
        // 15 fps: 4 trailing pad frames would be 0.27 s > 0.25 s; the cap keeps 3.
        val rec = TapClipSynth.recording(TapClipSynth.expand("4-40H6-"), fps = 15.0,
                                         peakAt = 20, jump = 1.0)
        val out = ClipPreparer.prepare(rec)
        assertTrue("got ${reason(out)}", out is ClipOutcome.Window)
    }

    // Review Focus 3.
    @Test
    fun veryShortRecordingIsTooQuick() {
        val rec = TapClipSynth.recording(TapClipSynth.expand("5H"), fps = 30.0)
        assertEquals(ClipRejection.MIN_HAND_FRAMES, reason(ClipPreparer.prepare(rec)))
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `sigla-mobile/`): `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" && ./gradlew testDebugUnitTest --tests com.example.sigla.ClipPreparerTest`
Expected: compilation FAILURE, unresolved references `ClipPreparer`, `RecordedFrame`, `ClipOutcome`, `ClipRejection`, `TAP_DEFAULT_SOURCE_FPS`.

- [ ] **Step 4: Expose `posePresent`**

In `PredictionService.kt`, change `private fun posePresent(frame: FloatArray): Boolean {` to `internal fun posePresent(frame: FloatArray): Boolean {`. Nothing else changes.

- [ ] **Step 5: Implement `ClipPreparer.kt`**

Create `sigla-mobile/app/src/main/kotlin/com/example/sigla/ClipPreparer.kt`:

```kotlin
package com.example.sigla

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// ── Mirrored from sigla-ml/app/services/clip_prep.py and extract.py ───────────
// Tap mode prepares a recorded sign the way training clips were prepared, so
// these MUST equal their Python twins. test_mobile_parity_flags.py checks each
// one, and ClipPreparerParityTest pins the behaviour to Python-generated goldens.
internal const val TAP_SEQUENCE_LENGTH = 30             // preprocessor.SEQUENCE_LENGTH
internal const val TAP_FEATURE_SIZE = 147               // preprocessor.FEATURE_SIZE
internal const val TAP_TARGET_SAMPLE_FPS = 24.0         // clip_prep.TARGET_SAMPLE_FPS
internal const val TAP_MIN_DETECTED_HAND_FRAMES = 12    // clip_prep.MIN_DETECTED_HAND_FRAMES
internal const val TAP_MIN_HAND_COVERAGE = 0.35         // clip_prep.MIN_HAND_COVERAGE
internal const val TAP_MIN_POSE_COVERAGE = 0.75         // clip_prep.MIN_POSE_COVERAGE
internal const val TAP_MAX_MISSING_HAND_SECONDS = 0.25  // clip_prep.MAX_MISSING_HAND_SECONDS
internal const val TAP_MAX_ANALYZED_FRAMES = 120        // clip_prep.MAX_ANALYZED_FRAMES
internal const val TAP_TRIM_PAD_FRAMES = 4              // extract.TRIM_PAD_FRAMES
internal const val TAP_DEFAULT_SOURCE_FPS = 30.0        // extract.DEFAULT_SOURCE_FPS

/** One camera frame captured during a tap recording. [features] is the
 * NORMALIZED 147-float vector when MediaPipe detected a hand, null otherwise. */
class RecordedFrame(val timestampMs: Long, val features: FloatArray?)

/** Why a recording could not be classified. [code] equals clip_prep's REASON_*. */
enum class ClipRejection(val code: String) {
    NO_HANDS("no_hands"),
    MIN_HAND_FRAMES("min_hand_frames"),
    HAND_COVERAGE("hand_coverage"),
    POSE_COVERAGE("pose_coverage"),
    HAND_GAP("hand_gap"),
    TOO_SHORT("too_short"),
    TOO_SPARSE("too_sparse"),
    LOW_MOTION("low_motion"),
    WINDOW_POSE("window_pose"),
}

sealed class ClipOutcome {
    class Window(val frames: List<FloatArray>) : ClipOutcome()
    class Rejected(val reason: ClipRejection) : ClipOutcome()
}

/**
 * Turns one tap recording into the model's 30-frame input, step for step as
 * extract.py does for a training clip: trim → 24 fps sampling → drop hand-less
 * frames → quality gates → 30→60 stretch → peak-velocity window → window gates.
 *
 * Pure: no Android, camera or TFLite dependencies.
 */
object ClipPreparer {

    fun prepare(recording: List<RecordedFrame>): ClipOutcome {
        val fps = estimateSourceFps(recording)
        val span = trimToSigningSpan(recording, fps)
            ?: return ClipOutcome.Rejected(ClipRejection.NO_HANDS)
        val indices = sampleIndices(span.size, fps)
        val sampled = indices.map { span[it].features }
        return finalizeSampled(sampled, span.size, fps)
    }

    /** Average frame rate over the recording, from its timestamps. extract.py
     * reads the container's fps; the phone measures it. */
    internal fun estimateSourceFps(frames: List<RecordedFrame>): Double {
        if (frames.size < 2) return TAP_DEFAULT_SOURCE_FPS
        val durationMs = frames.last().timestampMs - frames.first().timestampMs
        if (durationMs <= 0) return TAP_DEFAULT_SOURCE_FPS
        val fps = (frames.size - 1) * 1000.0 / durationMs
        return if (fps.isFinite() && fps > 1.0) fps else TAP_DEFAULT_SOURCE_FPS
    }

    /**
     * First to last frame with a detected hand, padded by TRIM_PAD_FRAMES.
     *
     * Deliberate deviation from extract.py: the TRAILING pad is capped at
     * floor(MAX_MISSING_HAND_SECONDS × fps) frames. Training clips are ~30 fps,
     * where 4 pad frames are 0.13 s; on a phone throttled below 16 fps the same
     * 4 frames exceed the 0.25 s hand-gap limit and would reject every sign. At
     * 16 fps and above the cap is ≥ 4, so this is exactly extract.py's trim.
     */
    internal fun trimToSigningSpan(frames: List<RecordedFrame>, sourceFps: Double): List<RecordedFrame>? {
        val first = frames.indexOfFirst { it.features != null }
        if (first < 0) return null
        val last = frames.indexOfLast { it.features != null }
        val trailingPad = min(TAP_TRIM_PAD_FRAMES,
                              floor(TAP_MAX_MISSING_HAND_SECONDS * sourceFps).toInt())
        val start = max(first - TAP_TRIM_PAD_FRAMES, 0)
        val end = min(last + trailingPad, frames.size - 1)
        return frames.subList(start, end + 1)
    }

    /** clip_prep.sample_budget(). */
    internal fun sampleBudget(): Int {
        val neededForFloor = ceil(TAP_SEQUENCE_LENGTH / max(TAP_MIN_HAND_COVERAGE, 1e-6)).toInt()
        return min(max(TAP_SEQUENCE_LENGTH * 2, neededForFloor), TAP_MAX_ANALYZED_FRAMES)
    }

    /** clip_prep.sample_indices(...).indices, reproducing numpy's float64 maths. */
    internal fun sampleIndices(totalFrames: Int, sourceFps: Double): IntArray {
        val budget = sampleBudget()
        val stride = max(sourceFps / max(TAP_TARGET_SAMPLE_FPS, 1e-6), 1.0)
        val rateCount = floor(totalFrames / stride).toInt()
        if (rateCount >= TAP_SEQUENCE_LENGTH && rateCount <= budget) {
            return IntArray(rateCount) { k -> (k * stride).toInt().coerceIn(0, totalFrames - 1) }
        }
        return linspaceInt(0, totalFrames - 1, min(totalFrames, budget))
    }

    /** clip_prep.finalize_sampled(); see its docstring. */
    internal fun finalizeSampled(sampled: List<FloatArray?>, totalFrames: Int, sourceFps: Double): ClipOutcome {
        val sequence = ArrayList<FloatArray>()
        var analyzed = 0
        var handFrames = 0
        var poseFrames = 0
        var currentGap = 0
        var maxGap = 0
        for (vec in sampled) {
            analyzed++
            // No hand, or a collapsed detection: dropped, counted as a gap once
            // the sequence has started, never as a hand frame.
            if (vec == null || !handExtentOk(vec)) {
                if (sequence.isNotEmpty()) currentGap++
                continue
            }
            handFrames++
            if (posePresent(vec)) poseFrames++
            sequence.add(vec)
            if (currentGap > maxGap) maxGap = currentGap
            currentGap = 0
        }

        if (handFrames < TAP_MIN_DETECTED_HAND_FRAMES) return rejected(ClipRejection.MIN_HAND_FRAMES)
        val handCoverage = handFrames.toDouble() / max(analyzed, 1)
        if (handCoverage < TAP_MIN_HAND_COVERAGE) return rejected(ClipRejection.HAND_COVERAGE)
        val poseCoverage = poseFrames.toDouble() / max(handFrames, 1)
        if (poseCoverage < TAP_MIN_POSE_COVERAGE) return rejected(ClipRejection.POSE_COVERAGE)
        if (currentGap > maxGap) maxGap = currentGap
        val stride = if (analyzed > 0) totalFrames.toDouble() / analyzed else 1.0
        val maxGapSeconds = (maxGap * stride) / sourceFps
        if (maxGapSeconds > TAP_MAX_MISSING_HAND_SECONDS) return rejected(ClipRejection.HAND_GAP)
        if (sequence.size < TAP_SEQUENCE_LENGTH) {
            val observed = handFrames.toDouble() / max(analyzed, 1)
            val framesNeeded = ceil(TAP_SEQUENCE_LENGTH / max(observed, 1e-6)).toInt()
            return if (analyzed < framesNeeded && totalFrames <= sampleBudget()) {
                rejected(ClipRejection.TOO_SHORT)
            } else {
                rejected(ClipRejection.TOO_SPARSE)
            }
        }

        val seq = if (sequence.size == TAP_SEQUENCE_LENGTH) {
            stretchLinear(sequence, TAP_SEQUENCE_LENGTH * 2)
        } else {
            sequence
        }
        val window = centerOnPeakVelocity(seq)
        if (!hasSufficientMotion(window)) return rejected(ClipRejection.LOW_MOTION)
        if (!hasSufficientPoseCoverage(window)) return rejected(ClipRejection.WINDOW_POSE)
        return ClipOutcome.Window(window)
    }

    private fun rejected(reason: ClipRejection) = ClipOutcome.Rejected(reason)

    /** numpy.linspace(start, stop, num, dtype=int): i*step + start in float64, then floor. */
    internal fun linspaceInt(start: Int, stop: Int, num: Int): IntArray {
        if (num <= 0) return IntArray(0)
        if (num == 1) return intArrayOf(start)
        val step = (stop - start).toDouble() / (num - 1)
        return IntArray(num) { i -> if (i == num - 1) stop else floor(i * step + start).toInt() }
    }

    /** Per-column numpy.interp over linspace(0, n-1, target); extract.py's 30→60 resample. */
    internal fun stretchLinear(frames: List<FloatArray>, target: Int): List<FloatArray> {
        val n = frames.size
        val width = frames[0].size
        val step = (n - 1).toDouble() / (target - 1)
        return List(target) { i ->
            val x = if (i == target - 1) (n - 1).toDouble() else i * step
            val j = min(floor(x).toInt(), n - 2)
            val t = x - j
            FloatArray(width) { c ->
                val y0 = frames[j][c].toDouble()
                val y1 = frames[j + 1][c].toDouble()
                ((y1 - y0) * t + y0).toFloat()
            }
        }
    }

    /** preprocessor.center_on_peak_velocity(force=True). */
    internal fun centerOnPeakVelocity(frames: List<FloatArray>): List<FloatArray> {
        val n = frames.size
        val peak = peakVelocityIndex(frames)
        val half = TAP_SEQUENCE_LENGTH / 2
        var start = max(peak - half, 0)
        var end = start + TAP_SEQUENCE_LENGTH
        if (end > n) {
            end = n
            start = max(end - TAP_SEQUENCE_LENGTH, 0)
        }
        val window = frames.subList(start, end).toMutableList()
        while (window.size < TAP_SEQUENCE_LENGTH) window.add(window.last())
        return window
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.ClipPreparerTest`
Expected: BUILD SUCCESSFUL, all ClipPreparerTest tests pass. If `lowFpsRecordingIsNotRejectedForHandGap` fails, check the trailing-pad cap in `trimToSigningSpan`, not the test.

- [ ] **Step 7: Run the whole unit suite (regression)**

Run: `./gradlew testDebugUnitTest`
Expected: BUILD SUCCESSFUL. `FeatureParityTest`, `PredictionPolicyTest`, `ThresholdPolicyTest` and `OverlayTransformTest` are unchanged and passing.

- [ ] **Step 8: Commit**

```bash
git add sigla-mobile/app/src/main/kotlin/com/example/sigla/ClipPreparer.kt sigla-mobile/app/src/main/kotlin/com/example/sigla/PredictionService.kt sigla-mobile/app/src/test/kotlin/com/example/sigla/TapClipSynth.kt sigla-mobile/app/src/test/kotlin/com/example/sigla/ClipPreparerTest.kt
git commit -m "feat(mobile): ClipPreparer mirrors extract.py clip preparation for tap mode"
```

---

### Task 3: Pin `ClipPreparer` to Python with generated fixtures and constant checks

**Files:**
- Create: `sigla-ml/tools/gen_tap_clip_fixtures.py`
- Generated: `sigla-mobile/app/src/test/kotlin/com/example/sigla/TapClipFixtures.kt`
- Create: `sigla-mobile/app/src/test/kotlin/com/example/sigla/ClipPreparerParityTest.kt`
- Modify: `sigla-ml/tests/test_mobile_parity_flags.py` (append one test)

**Interfaces:**
- Consumes: `clip_prep.sample_indices`, `clip_prep.finalize_sampled`, `clip_prep.ExtractionQualityError.reason` (Task 1); `_tap_clip_synth.FINALIZE_CASES`, `SAMPLE_CASES`, `synth_sampled` (Task 1); `ClipPreparer.sampleIndices`, `ClipPreparer.finalizeSampled`, `ClipOutcome`, `TapClipSynth.sampled` (Task 2)
- Produces: `internal class TapSampleCase(totalFrames: Int, sourceFps: Double, expected: IntArray)`, `internal class TapFinalizeCase(name, pattern, slope, peakAt, jump, totalFrames, sourceFps, expectedReason: String?, expectedFrameSums: FloatArray?)`, `TAP_SAMPLE_CASES`, `TAP_FINALIZE_CASES`

- [ ] **Step 1: Write the generator**

Create `sigla-ml/tools/gen_tap_clip_fixtures.py`:

```python
"""
Generate TapClipFixtures.kt: goldens pinning sigla-mobile's ClipPreparer to
clip_prep.sample_indices / finalize_sampled.

    venv/Scripts/python.exe tools/gen_tap_clip_fixtures.py

Inputs are NOT shipped: TapClipSynth.kt rebuilds them from each case's
parameters (see tests/_tap_clip_synth.py). Only outputs are pinned: sampled
indices, the rejection reason, or the per-frame sums of the produced window.

Regenerate ONLY after a deliberate change made on both sides. A failing
ClipPreparerParityTest means the two pipelines diverged. Fix the divergence;
do not regenerate to make it pass.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))

from app.services.clip_prep import (  # noqa: E402
    ExtractionQualityError,
    finalize_sampled,
    sample_indices,
)
from tests._tap_clip_synth import (  # noqa: E402
    FINALIZE_CASES,
    SAMPLE_CASES,
    synth_sampled,
)

OUT = os.path.abspath(os.path.join(
    _HERE, "..", "..", "sigla-mobile", "app", "src", "test", "kotlin",
    "com", "example", "sigla", "TapClipFixtures.kt",
))


def _f(v: float) -> str:
    return f"{float(v):.8e}f"


def main() -> None:
    lines = [
        "// GENERATED by sigla-ml/tools/gen_tap_clip_fixtures.py — do not edit by hand.",
        "// Regenerating to make ClipPreparerParityTest pass is wrong: see the generator.",
        "package com.example.sigla",
        "",
        "internal class TapSampleCase(val totalFrames: Int, val sourceFps: Double, val expected: IntArray)",
        "",
        "internal class TapFinalizeCase(",
        "    val name: String, val pattern: String, val slope: Double, val peakAt: Int,",
        "    val jump: Double, val totalFrames: Int, val sourceFps: Double,",
        "    val expectedReason: String?, val expectedFrameSums: FloatArray?,",
        ")",
        "",
        "internal val TAP_SAMPLE_CASES = listOf(",
    ]
    for total, fps in SAMPLE_CASES:
        idx = ", ".join(str(int(i)) for i in sample_indices(total, fps).indices)
        lines.append(f"    TapSampleCase({total}, {fps!r}, intArrayOf({idx})),")
    lines += [")", "", "internal val TAP_FINALIZE_CASES = listOf("]
    for name, pattern, slope, peak_at, jump, total, fps, expected in FINALIZE_CASES:
        sampled = synth_sampled(pattern, slope, peak_at, jump)
        try:
            window = finalize_sampled(sampled, total, fps)
            reason, sums = None, [float(row.astype("float64").sum()) for row in window]
        except ExtractionQualityError as e:
            reason, sums = e.reason, None
        assert reason == expected, f"{name}: python gave {reason}, table says {expected}"
        reason_kt = "null" if reason is None else f'"{reason}"'
        sums_kt = "null" if sums is None else "floatArrayOf(" + ", ".join(_f(s) for s in sums) + ")"
        lines.append(
            f'    TapFinalizeCase("{name}", "{pattern}", {slope!r}, {peak_at}, {jump!r}, '
            f"{total}, {fps!r}, {reason_kt}, {sums_kt}),"
        )
    lines += [")", ""]
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate the fixtures**

Run (from `sigla-ml/`): `venv/Scripts/python.exe tools/gen_tap_clip_fixtures.py`
Expected: `wrote ...\TapClipFixtures.kt`. Open it and check it has 11 `TapSampleCase` and 13 `TapFinalizeCase` entries, and that the Kotlin literals look valid (e.g. `24.0`, `29.97`, `1000000`).

- [ ] **Step 3: Write the parity test**

Create `sigla-mobile/app/src/test/kotlin/com/example/sigla/ClipPreparerParityTest.kt`:

```kotlin
package com.example.sigla

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * ClipPreparer must make the same decisions as sigla-ml's clip_prep, which is
 * the code that prepared every training clip. Goldens come from
 * tools/gen_tap_clip_fixtures.py. A failure is a real divergence: fix the code,
 * never regenerate to make this pass.
 */
class ClipPreparerParityTest {

    @Test
    fun sampleIndicesMatchPython() {
        for (c in TAP_SAMPLE_CASES) {
            assertArrayEquals("${c.totalFrames} frames @ ${c.sourceFps} fps",
                c.expected, ClipPreparer.sampleIndices(c.totalFrames, c.sourceFps))
        }
    }

    @Test
    fun finalizeMatchesPython() {
        for (c in TAP_FINALIZE_CASES) {
            val sampled = TapClipSynth.sampled(c.pattern, c.slope, c.peakAt, c.jump)
            val out = ClipPreparer.finalizeSampled(sampled, c.totalFrames, c.sourceFps)
            if (c.expectedReason != null) {
                assertTrue("${c.name}: expected rejection", out is ClipOutcome.Rejected)
                assertEquals(c.name, c.expectedReason, (out as ClipOutcome.Rejected).reason.code)
            } else {
                assertTrue("${c.name}: expected a window, got ${(out as? ClipOutcome.Rejected)?.reason}",
                    out is ClipOutcome.Window)
                val frames = (out as ClipOutcome.Window).frames
                val expected = c.expectedFrameSums!!
                assertEquals(c.name, expected.size, frames.size)
                for (i in frames.indices) {
                    var sum = 0.0
                    for (v in frames[i]) sum += v
                    // float32 (Kotlin) vs float64 (numpy) intermediates; a wrong
                    // frame selection is off by whole units, not by this much.
                    val tol = maxOf(1e-3, abs(expected[i]) * 1e-4)
                    assertTrue("${c.name} frame $i: expected ${expected[i]} got $sum",
                        abs(sum - expected[i]) <= tol)
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run the parity test**

Run (from `sigla-mobile/`): `./gradlew testDebugUnitTest --tests com.example.sigla.ClipPreparerParityTest`
Expected: PASS. If a case fails, compare that case step by step (trim is not involved here, only sampling and finalize). Typical culprits are the `linspaceInt` float maths, the stretch, and the order of the gates. Fix Kotlin to match Python.

- [ ] **Step 5: Add the constant-parity test (Python)**

Append to `sigla-ml/tests/test_mobile_parity_flags.py`:

```python
_CLIP_PREPARER = os.path.join(_MOBILE, "ClipPreparer.kt")


def test_tap_clip_constants_match_training():
    """ClipPreparer must prepare a tap recording with the numbers extract.py
    used for training clips; otherwise tap mode feeds the model inputs unlike
    anything it was trained on."""
    from app.services import clip_prep, extract
    from app.utils.preprocessor import FEATURE_SIZE, SEQUENCE_LENGTH

    src = _read(_CLIP_PREPARER)
    pairs = {
        "TAP_SEQUENCE_LENGTH": SEQUENCE_LENGTH,
        "TAP_FEATURE_SIZE": FEATURE_SIZE,
        "TAP_TARGET_SAMPLE_FPS": clip_prep.TARGET_SAMPLE_FPS,
        "TAP_MIN_DETECTED_HAND_FRAMES": clip_prep.MIN_DETECTED_HAND_FRAMES,
        "TAP_MIN_HAND_COVERAGE": clip_prep.MIN_HAND_COVERAGE,
        "TAP_MIN_POSE_COVERAGE": clip_prep.MIN_POSE_COVERAGE,
        "TAP_MAX_MISSING_HAND_SECONDS": clip_prep.MAX_MISSING_HAND_SECONDS,
        "TAP_MAX_ANALYZED_FRAMES": clip_prep.MAX_ANALYZED_FRAMES,
        "TAP_TRIM_PAD_FRAMES": extract.TRIM_PAD_FRAMES,
        "TAP_DEFAULT_SOURCE_FPS": extract.DEFAULT_SOURCE_FPS,
    }
    for name, py_value in pairs.items():
        kt_value = _kotlin_float(src, name)
        assert abs(kt_value - float(py_value)) < 1e-9, (
            f"ClipPreparer.{name} = {kt_value} but Python has {py_value}"
        )
```

- [ ] **Step 6: Run the Python suite**

Run (from `sigla-ml/`): `venv/Scripts/python.exe -m pytest tests/ -v`
Expected: all pass, including `test_tap_clip_constants_match_training`.

- [ ] **Step 7: Commit**

```bash
git add sigla-ml/tools/gen_tap_clip_fixtures.py sigla-ml/tests/test_mobile_parity_flags.py sigla-mobile/app/src/test/kotlin/com/example/sigla/TapClipFixtures.kt sigla-mobile/app/src/test/kotlin/com/example/sigla/ClipPreparerParityTest.kt
git commit -m "test: pin tap-mode ClipPreparer to clip_prep with generated goldens"
```

---

### Task 4: `PredictionService.classifyWindow` for one prepared window

**Files:**
- Modify: `sigla-mobile/app/src/main/kotlin/com/example/sigla/PredictionService.kt` (`runMotionInference` around line 973; new top-level function near `topPredictionMargin` around line 330; new public method after `setVocabulary`)
- Create: `sigla-mobile/app/src/test/kotlin/com/example/sigla/TapAcceptanceTest.kt`

**Interfaces:**
- Consumes: existing `topPredictionMargin(FloatArray, Int)`, `MOTION_THRESHOLD`, `MOTION_MIN_MARGIN`, `pinnedModel`, `vocabulary`, `wordsModel`, `lettersModel`, `motionOutputArr`, `motionLabels`, `lock`, `isReady`
- Produces:
  - `internal fun acceptSingleWindow(probabilities: FloatArray): Int` (index, or -1)
  - `fun PredictionService.classifyWindow(window: List<FloatArray>): PredictionResult?` (null = not recognized or the service is not ready)

- [ ] **Step 1: Write the failing policy test**

Create `sigla-mobile/app/src/test/kotlin/com/example/sigla/TapAcceptanceTest.kt`:

```kotlin
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class TapAcceptanceTest {
    @Test
    fun confidentAndSeparatedIsAccepted() =
        assertEquals(1, acceptSingleWindow(floatArrayOf(0.05f, 0.90f, 0.05f)))

    @Test
    fun belowThresholdIsRejected() =
        assertEquals(-1, acceptSingleWindow(floatArrayOf(0.79f, 0.11f, 0.10f)))

    @Test
    fun tooCloseToRunnerUpIsRejected() =
        // 0.81 clears 0.80 but beats 0.70 by only 0.11 < 0.15.
        assertEquals(-1, acceptSingleWindow(floatArrayOf(0.81f, 0.70f)))

    @Test
    fun emptyIsRejected() = assertEquals(-1, acceptSingleWindow(FloatArray(0)))
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.TapAcceptanceTest`
Expected: compilation FAILURE, unresolved reference `acceptSingleWindow`.

- [ ] **Step 3: Add the policy function**

In `PredictionService.kt`, directly after `topPredictionMargin`, add:

```kotlin
/**
 * Tap mode's acceptance rule for ONE prepared window: the same confidence and
 * runner-up margin Live mode requires, without the streak and consensus
 * machinery that exists only to guess sign boundaries. Returns the class index,
 * or -1 when the window is not confidently one word.
 */
internal fun acceptSingleWindow(probabilities: FloatArray): Int {
    if (probabilities.isEmpty()) return -1
    var best = 0
    for (i in 1 until probabilities.size) if (probabilities[i] > probabilities[best]) best = i
    if (probabilities[best] < MOTION_THRESHOLD) return -1
    if (topPredictionMargin(probabilities, best) < MOTION_MIN_MARGIN) return -1
    return best
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.TapAcceptanceTest`
Expected: PASS.

- [ ] **Step 5: Split the interpreter call out of `runMotionInference` (no behaviour change)**

In `runMotionInference`, replace everything from the comment `// Reused tensor; the inner references are rebound to this window's frames.` to the end of the function with `return runOnWindow(seq)`, and add this new method directly below `runMotionInference`, containing exactly the code that was moved:

```kotlin
    /**
     * One LSTM pass over an already-prepared 30-frame window. Caller must hold
     * [lock]. Returns the argmax index, or -1; probabilities are left in
     * `motionOutputArr[0]`. Shared by Live (runMotionInference) and Tap
     * (classifyWindow).
     */
    private fun runOnWindow(seq: List<FloatArray>): Int {
        val interp = motionInterp ?: return -1
        // Reused tensor; the inner references are rebound to this window's frames.
        val row = motionInputArr[0]
        for (i in 0 until SEQUENCE_LENGTH) row[i] = seq[i]

        val startNs = if (LATENCY_LOGGING) System.nanoTime() else 0L
        return try {
            interp.run(motionInputArr, motionOutputArr)
            if (LATENCY_LOGGING) recordLatency((System.nanoTime() - startNs) / 1_000_000.0)

            // Plain loop rather than probs.indices.maxByOrNull, which allocated an
            // IntRange and iterator and boxed the result. Strict `>` keeps
            // maxByOrNull's first-wins behaviour on ties.
            val probs = motionOutputArr[0]
            if (probs.isEmpty()) return -1
            var best = 0
            for (i in 1 until probs.size) {
                if (probs[i] > probs[best]) best = i
            }
            best
        } catch (_: Exception) { -1 }
    }
```

`runMotionInference` keeps its own `val interp = motionInterp ?: return -1` guard at the top. Leave it.

- [ ] **Step 6: Add `classifyWindow`**

Add as a public method of `PredictionService`, directly after `setVocabulary`:

```kotlin
    /**
     * Tap mode: classify one window already prepared by [ClipPreparer]. Uses the
     * model for the current vocabulary and [acceptSingleWindow]'s rule. Returns
     * null when the window is not confidently one word, or when the service is
     * not ready or already closed.
     *
     * Runs the interpreter under [lock], like processFrame, so it can never race
     * close() or a vocabulary switch. Call it off the main thread.
     */
    fun classifyWindow(window: List<FloatArray>): PredictionResult? {
        if (window.size != SEQUENCE_LENGTH) return null
        if (window.any { it.size != FEATURE_SIZE }) return null
        synchronized(lock) {
            if (!isReady) return null
            pinnedModel = if (vocabulary == Vocabulary.LETTERS) lettersModel else wordsModel
            if (runOnWindow(window) < 0) return null
            val probs = motionOutputArr[0]
            val idx = acceptSingleWindow(probs)
            if (idx < 0) return null
            val label = motionLabels.getOrNull(idx) ?: return null
            return PredictionResult(label = label, confidence = probs[idx], isMotion = true)
        }
    }
```

If the compiler reports that `wordsModel`, `lettersModel` or `vocabulary` have different names, use the names from the `pinnedModel = ...` line in `processFrame` (line ~771). This line must be identical to that one.

- [ ] **Step 7: Run the whole unit suite**

Run: `./gradlew testDebugUnitTest`
Expected: BUILD SUCCESSFUL, including `PredictionPolicyTest` and `ThresholdPolicyTest` (Live behaviour unchanged).

- [ ] **Step 8: Commit**

```bash
git add sigla-mobile/app/src/main/kotlin/com/example/sigla/PredictionService.kt sigla-mobile/app/src/test/kotlin/com/example/sigla/TapAcceptanceTest.kt
git commit -m "feat(mobile): PredictionService.classifyWindow for a single prepared tap window"
```

---

### Task 5: `TapSignSession` state machine

**Files:**
- Create: `sigla-mobile/app/src/main/kotlin/com/example/sigla/TapSignSession.kt`
- Create: `sigla-mobile/app/src/test/kotlin/com/example/sigla/TapSignSessionTest.kt`

**Interfaces:**
- Consumes: `RecordedFrame`, `ClipRejection`, `TAP_TRIM_PAD_FRAMES` (Task 2); `handExtentOk` (existing)
- Produces:
  - `class TapSignSession(clock: () -> Long)` with `state: TapSignSession.State` (`IDLE, READY, RECORDING, PROCESSING`), `fun tap(): Event?`, `fun onFrame(features: FloatArray, handsDetected: Int): Event?`, `fun finishProcessing(generation: Int): Boolean`, `fun cancel()`, `fun recordingElapsedMs(): Long`
  - `sealed class TapSignSession.Event`: `Armed`, `Cancelled`, `RecordingStarted`, `NoHandsTimeout`, `Captured(generation: Int, frames: List<RecordedFrame>)`
  - Constants `TAP_READY_TIMEOUT_MS = 5_000L`, `TAP_MAX_RECORDING_MS = 4_000L`, `TAP_STOP_AFTER_NO_HAND_FRAMES = 6`
  - `internal fun tapRejectionMessage(reason: ClipRejection): String`, `internal const val TAP_NOT_RECOGNIZED = "Not recognized — try again"`, `TAP_NO_HANDS_SEEN = "No hands seen — tap and try again"`

- [ ] **Step 1: Write the failing tests**

Create `sigla-mobile/app/src/test/kotlin/com/example/sigla/TapSignSessionTest.kt`:

```kotlin
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TapSignSessionTest {
    private var now = 0L
    private val session = TapSignSession { now }

    private val hand = TapClipSynth.frame(0, 'H', 0.05, TapClipSynth.NO_PEAK, 0.0)!!
    private val corrupt = TapClipSynth.frame(0, 'X', 0.05, TapClipSynth.NO_PEAK, 0.0)!!
    private val empty = FloatArray(147)

    /** Advances the clock one 33 ms frame and feeds it. */
    private fun feed(withHand: Boolean): TapSignSession.Event? {
        now += 33
        return if (withHand) session.onFrame(hand, 1) else session.onFrame(empty, 0)
    }

    @Test
    fun tapArmsAndHandsStartRecording() {
        assertTrue(session.tap() is TapSignSession.Event.Armed)
        assertEquals(TapSignSession.State.READY, session.state)
        assertNull(feed(false))
        assertTrue(feed(true) is TapSignSession.Event.RecordingStarted)
        assertEquals(TapSignSession.State.RECORDING, session.state)
    }

    @Test
    fun readyTimesOutAfterFiveSecondsWithoutHands() {
        session.tap()
        var event: TapSignSession.Event? = null
        while (now < 5_100 && event == null) event = feed(false)
        assertTrue(event is TapSignSession.Event.NoHandsTimeout)
        assertEquals(TapSignSession.State.IDLE, session.state)
    }

    @Test
    fun tapWhileReadyCancels() {
        session.tap()
        assertTrue(session.tap() is TapSignSession.Event.Cancelled)
        assertEquals(TapSignSession.State.IDLE, session.state)
    }

    @Test
    fun sixHandlessFramesStopRecording() {
        session.tap(); feed(true)
        repeat(20) { assertNull(feed(true)) }
        repeat(5) { assertNull(feed(false)) }
        val e = feed(false)
        assertTrue(e is TapSignSession.Event.Captured)
        assertEquals(TapSignSession.State.PROCESSING, session.state)
        // 1 start + 20 hand + 6 hand-less frames.
        assertEquals(27, (e as TapSignSession.Event.Captured).frames.size)
    }

    @Test
    fun preRollKeepsUpToFourFramesBeforeTheFirstHand() {
        session.tap()
        repeat(10) { feed(false) }
        feed(true)
        var e: TapSignSession.Event? = null
        while (e == null) e = feed(false)
        val frames = (e as TapSignSession.Event.Captured).frames
        assertEquals(4, frames.takeWhile { it.features == null }.size)
    }

    // Review Focus 5.
    @Test
    fun isolatedBadFramesDoNotStopRecording() {
        session.tap(); feed(true)
        repeat(10) {
            now += 33; assertNull(session.onFrame(corrupt, 1))   // detected, fails handExtentOk
            assertNull(feed(true))
        }
        assertEquals(TapSignSession.State.RECORDING, session.state)
    }

    @Test
    fun tapWhileRecordingStopsNow() {
        session.tap(); feed(true); feed(true)
        assertTrue(session.tap() is TapSignSession.Event.Captured)
        assertEquals(TapSignSession.State.PROCESSING, session.state)
    }

    // Review Focus 2.
    @Test
    fun capStopsRecordingAtFourSeconds() {
        session.tap(); feed(true)
        var event: TapSignSession.Event? = null
        while (event == null && now < 10_000) event = feed(true)
        assertTrue(event is TapSignSession.Event.Captured)
        assertTrue("stopped at ${now}ms", now in 4_000..4_100)
    }

    @Test
    fun framesAreIgnoredWhileProcessing() {
        session.tap(); feed(true)
        session.tap()
        assertNull(feed(true))
        assertEquals(TapSignSession.State.PROCESSING, session.state)
    }

    @Test
    fun finishProcessingReturnsToIdle() {
        session.tap(); feed(true)
        val e = session.tap() as TapSignSession.Event.Captured
        assertTrue(session.finishProcessing(e.generation))
        assertEquals(TapSignSession.State.IDLE, session.state)
    }

    // Review Focus 4.
    @Test
    fun cancelDuringProcessingDiscardsTheResult() {
        session.tap(); feed(true)
        val e = session.tap() as TapSignSession.Event.Captured
        session.cancel()                               // e.g. Words/Letters switched
        assertFalse(session.finishProcessing(e.generation))
        assertEquals(TapSignSession.State.IDLE, session.state)
    }

    @Test
    fun tapWhileProcessingIsIgnored() {
        session.tap(); feed(true); session.tap()
        assertNull(session.tap())
    }

    @Test
    fun everyRejectionHasCopy() {
        for (r in ClipRejection.values()) assertTrue(tapRejectionMessage(r).isNotBlank())
        assertEquals("Sign was too quick — try again, a little slower",
            tapRejectionMessage(ClipRejection.TOO_SHORT))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.TapSignSessionTest`
Expected: compilation FAILURE, unresolved reference `TapSignSession`.

- [ ] **Step 3: Implement `TapSignSession.kt`**

Create `sigla-mobile/app/src/main/kotlin/com/example/sigla/TapSignSession.kt`:

```kotlin
package com.example.sigla

internal const val TAP_READY_TIMEOUT_MS = 5_000L
internal const val TAP_MAX_RECORDING_MS = 4_000L
// Same count PredictionService uses (NO_HAND_TIMEOUT) to decide a sign has
// ended; at 24 fps it is also extract.py's 0.25 s MAX_MISSING_HAND_SECONDS.
internal const val TAP_STOP_AFTER_NO_HAND_FRAMES = 6

internal const val TAP_NOT_RECOGNIZED = "Not recognized — try again"
internal const val TAP_NO_HANDS_SEEN = "No hands seen — tap and try again"

/** User-facing copy for each rejection. Exhaustive: a new reason fails to compile. */
internal fun tapRejectionMessage(reason: ClipRejection): String = when (reason) {
    ClipRejection.NO_HANDS -> TAP_NO_HANDS_SEEN
    ClipRejection.MIN_HAND_FRAMES,
    ClipRejection.TOO_SHORT -> "Sign was too quick — try again, a little slower"
    ClipRejection.HAND_COVERAGE,
    ClipRejection.HAND_GAP,
    ClipRejection.TOO_SPARSE -> "Keep your hands in frame"
    ClipRejection.POSE_COVERAGE,
    ClipRejection.WINDOW_POSE -> "Step back so your shoulders are in view"
    ClipRejection.LOW_MOTION -> "No clear movement — try again"
}

/**
 * Tap mode's cycle: IDLE → (tap) → READY → (hands appear) → RECORDING →
 * (hands gone 6 frames / tap / 4 s) → PROCESSING → (finishProcessing) → IDLE.
 *
 * onFrame() is called on MediaPipe's callback thread and tap()/cancel() on the
 * UI thread, so every entry point is synchronized. The clock is injected for
 * tests. [generation] changes on every cancel, so a result computed for a
 * recording that was cancelled meanwhile can be recognised and dropped.
 */
class TapSignSession(private val clock: () -> Long) {

    enum class State { IDLE, READY, RECORDING, PROCESSING }

    sealed class Event {
        object Armed : Event()
        object Cancelled : Event()
        object RecordingStarted : Event()
        object NoHandsTimeout : Event()
        class Captured(val generation: Int, val frames: List<RecordedFrame>) : Event()
    }

    @get:Synchronized
    var state = State.IDLE
        private set

    private var generation = 0
    private var readySince = 0L
    private var recordingSince = 0L
    private var noHandRun = 0
    // The last few frames before the first hand, so the recording carries the
    // same leading pad extract.py's trim keeps (TRIM_PAD_FRAMES).
    private val preRoll = ArrayDeque<RecordedFrame>()
    private val frames = ArrayList<RecordedFrame>()

    @Synchronized
    fun tap(): Event? = when (state) {
        State.IDLE -> {
            state = State.READY
            readySince = clock()
            preRoll.clear()
            Event.Armed
        }
        State.READY -> { reset(); Event.Cancelled }
        State.RECORDING -> capture()
        State.PROCESSING -> null
    }

    @Synchronized
    fun onFrame(features: FloatArray, handsDetected: Int): Event? {
        if (state != State.READY && state != State.RECORDING) return null
        val now = clock()
        val detected = if (handsDetected > 0) features.copyOf() else null
        // Same rule as PredictionService.processFrame: a collapsed detection is
        // not a hand.
        val usable = detected != null && handExtentOk(detected)
        val frame = RecordedFrame(now, detected)

        if (state == State.READY) {
            if (usable) {
                frames.clear()
                frames.addAll(preRoll)
                frames.add(frame)
                preRoll.clear()
                state = State.RECORDING
                recordingSince = now
                noHandRun = 0
                return Event.RecordingStarted
            }
            if (now - readySince >= TAP_READY_TIMEOUT_MS) {
                reset()
                return Event.NoHandsTimeout
            }
            preRoll.addLast(frame)
            while (preRoll.size > TAP_TRIM_PAD_FRAMES) preRoll.removeFirst()
            return null
        }

        frames.add(frame)
        noHandRun = if (usable) 0 else noHandRun + 1
        if (noHandRun >= TAP_STOP_AFTER_NO_HAND_FRAMES ||
            now - recordingSince >= TAP_MAX_RECORDING_MS) {
            return capture()
        }
        return null
    }

    /** PROCESSING → IDLE. False when the recording was cancelled meanwhile,
     * in which case the caller must discard its result. */
    @Synchronized
    fun finishProcessing(generation: Int): Boolean {
        if (generation != this.generation || state != State.PROCESSING) return false
        state = State.IDLE
        return true
    }

    /** Any state → IDLE, discarding the recording and any pending result. */
    @Synchronized
    fun cancel() = reset()

    @Synchronized
    fun recordingElapsedMs(): Long =
        if (state == State.RECORDING) clock() - recordingSince else 0L

    private fun capture(): Event {
        state = State.PROCESSING
        val captured = Event.Captured(generation, frames.toList())
        frames.clear()
        return captured
    }

    private fun reset() {
        state = State.IDLE
        generation++
        frames.clear()
        preRoll.clear()
        noHandRun = 0
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./gradlew testDebugUnitTest --tests com.example.sigla.TapSignSessionTest`
Expected: PASS. Note `capStopsRecordingAtFourSeconds`: frames come every 33 ms, so the cap fires on the first frame at or after 4,000 ms after the start frame (start at 33 ms, so around 4,033–4,066 ms).

- [ ] **Step 5: Commit**

```bash
git add sigla-mobile/app/src/main/kotlin/com/example/sigla/TapSignSession.kt sigla-mobile/app/src/test/kotlin/com/example/sigla/TapSignSessionTest.kt
git commit -m "feat(mobile): TapSignSession state machine for tap-to-sign"
```

---

### Task 6: Mode toggle, record button, and wiring in `MainActivity`

**Files:**
- Modify: `sigla-mobile/app/src/main/kotlin/com/example/sigla/AppSettings.kt`
- Modify: `sigla-mobile/app/src/main/res/layout/activity_main.xml`
- Modify: `sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt`

**Interfaces:**
- Consumes: `TapSignSession`, `TapSignSession.Event`, `tapRejectionMessage`, `TAP_NOT_RECOGNIZED`, `TAP_NO_HANDS_SEEN`, `TAP_MAX_RECORDING_MS` (Task 5); `ClipPreparer.prepare`, `ClipOutcome` (Task 2); `PredictionService.classifyWindow` (Task 4)
- Produces: `AppSettings.translationMode: String`, `AppSettings.MODE_TAP = "tap"`, `AppSettings.MODE_LIVE = "live"`

This task is UI glue with no unit-testable logic left in it. It is verified on a device (Step 7).

- [ ] **Step 1: Persist the mode**

In `AppSettings.kt`, add beside the other keys in the companion object:

```kotlin
        private const val KEY_TRANSLATION_MODE = "translation_mode"
        const val MODE_TAP = "tap"
        const val MODE_LIVE = "live"
```

and beside `isFrontCamera`:

```kotlin
    /** Tap-to-sign or realtime. Tap is the default for fresh installs. */
    var translationMode: String
        get() = prefs.getString(KEY_TRANSLATION_MODE, MODE_TAP) ?: MODE_TAP
        set(v) = prefs.edit().putString(KEY_TRANSLATION_MODE, v).apply()
```

- [ ] **Step 2: Layout — mode toggle**

In `activity_main.xml`, inside the toggle-row `LinearLayout`, after the `btnToggleVocabulary` button and before `</LinearLayout>`, add:

```xml
                    <!-- Live / Tap translation mode. Filled = Tap. -->
                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnToggleMode"
                        style="@style/Widget.MaterialComponents.Button.OutlinedButton"
                        android:layout_width="wrap_content"
                        android:layout_height="30dp"
                        android:layout_marginStart="8dp"
                        android:minWidth="0dp"
                        android:insetTop="0dp"
                        android:insetBottom="0dp"
                        android:paddingStart="14dp"
                        android:paddingEnd="14dp"
                        android:text="Tap"
                        android:textColor="@color/sig_accent"
                        android:textSize="11sp"
                        android:textAllCaps="false"
                        android:letterSpacing="0"
                        android:fontFamily="@font/poppins_medium"
                        app:strokeColor="@color/sig_accent"
                        app:strokeWidth="1dp"
                        app:cornerRadius="15dp" />
```

- [ ] **Step 3: Layout — ids on the Live-only views**

In the bottom panel, give the "Detection loading" `TextView` an id by adding `android:id="@+id/tvDetectionLabel"` as its first attribute. Give the stats `LinearLayout` directly under the comment `<!-- Bottom stats row: FPS, loading percent, motion -->` the attribute `android:id="@+id/liveStatsRow"`. `progressBuffer` already has an id.

- [ ] **Step 4: Layout — record button over the camera**

In the camera card's `FrameLayout`, as its LAST child (directly before the `</FrameLayout>` that precedes `</com.google.android.material.card.MaterialCardView>` of `cameraCard`), add:

```xml
                <!-- Tap mode: prompt + record button. GONE in Live mode. -->
                <LinearLayout
                    android:id="@+id/tapControls"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_gravity="bottom|center_horizontal"
                    android:layout_marginBottom="20dp"
                    android:gravity="center_horizontal"
                    android:orientation="vertical"
                    android:visibility="gone">

                    <TextView
                        android:id="@+id/tvTapPrompt"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:layout_marginBottom="10dp"
                        android:background="#CC000000"
                        android:fontFamily="@font/poppins_medium"
                        android:paddingStart="12dp"
                        android:paddingTop="4dp"
                        android:paddingEnd="12dp"
                        android:paddingBottom="4dp"
                        android:textColor="@android:color/white"
                        android:textSize="13sp"
                        android:visibility="gone" />

                    <FrameLayout
                        android:layout_width="88dp"
                        android:layout_height="88dp">

                        <com.google.android.material.progressindicator.CircularProgressIndicator
                            android:id="@+id/tapRecordRing"
                            android:layout_width="match_parent"
                            android:layout_height="match_parent"
                            android:max="100"
                            android:visibility="invisible"
                            app:indicatorColor="#E53935"
                            app:indicatorSize="88dp"
                            app:trackThickness="5dp" />

                        <com.google.android.material.button.MaterialButton
                            android:id="@+id/btnTapRecord"
                            android:layout_width="72dp"
                            android:layout_height="72dp"
                            android:layout_gravity="center"
                            android:insetTop="0dp"
                            android:insetBottom="0dp"
                            android:padding="0dp"
                            android:fontFamily="@font/poppins_medium"
                            android:text="Tap to sign"
                            android:textAllCaps="false"
                            android:textSize="11sp"
                            app:backgroundTint="@color/sig_accent"
                            app:cornerRadius="36dp" />
                    </FrameLayout>
                </LinearLayout>
```

- [ ] **Step 5: MainActivity — state, routing, and the tap cycle**

In `MainActivity.kt`:

(a) Imports, if missing: `android.animation.ObjectAnimator`, `android.animation.ValueAnimator`, `kotlinx.coroutines.Dispatchers`, `kotlinx.coroutines.launch`, `kotlinx.coroutines.withContext`.

(b) Fields, next to `private var showFilipino = true`:

```kotlin
    // Tap-to-sign. `tapMode` is read on MediaPipe's callback thread to route
    // each frame, hence @Volatile.
    @Volatile private var tapMode = true
    private val tapSession = TapSignSession { SystemClock.elapsedRealtime() }
    private var tapPulse: ObjectAnimator? = null
    private val tapRingTicker = object : Runnable {
        override fun run() {
            if (tapSession.state != TapSignSession.State.RECORDING) return
            val pct = (tapSession.recordingElapsedMs() * 100 / TAP_MAX_RECORDING_MS).toInt()
            binding.tapRecordRing.setProgressCompat(pct.coerceIn(0, 100), false)
            binding.tapRecordRing.postDelayed(this, 100)
        }
    }
    private val hideTapPrompt = Runnable { renderTapState() }
```

(c) In `onCreate`, directly after `showFilipino = appSettings.showFilipino`:

```kotlin
        tapMode = appSettings.translationMode == AppSettings.MODE_TAP
```

and after `updateFilipinoToggleLabel()` (end of `onCreate`):

```kotlin
        updateModeToggleLabel()
        renderTapState()
```

(d) In the landmark `sink`, replace the single line `predictor?.processFrame(features, result.handsDetected)` with:

```kotlin
                    if (tapMode) {
                        tapSession.onFrame(features, result.handsDetected)?.let { handleTapEvent(it) }
                    } else {
                        predictor?.processFrame(features, result.handsDetected)
                    }
```

(e) Move the body of `predictor.onResult`'s `runOnUiThread { ... }` block into a new method `private fun showResult(result: PredictionResult)`, and make `onResult` call it: `predictor.onResult = { result -> runOnUiThread { showResult(result) } }`. In `showResult`, change the final hide so the word stays visible in Tap mode:

```kotlin
        if (!tapMode) {
            binding.cardResult.postDelayed(
                { binding.cardResult.visibility = View.INVISIBLE }, 2000)
        }
```

(f) Add these methods (for example directly after `setupCallbacks()`):

```kotlin
    /** Called on MediaPipe's callback thread (onFrame) or the UI thread (tap). */
    private fun handleTapEvent(event: TapSignSession.Event) {
        when (event) {
            is TapSignSession.Event.Captured -> processCapture(event)
            TapSignSession.Event.NoHandsTimeout -> runOnUiThread { showTapMessage(TAP_NO_HANDS_SEEN) }
            else -> runOnUiThread { renderTapState() }
        }
    }

    private fun processCapture(event: TapSignSession.Event.Captured) {
        runOnUiThread { renderTapState() }
        lifecycleScope.launch(Dispatchers.Default) {
            val outcome = ClipPreparer.prepare(event.frames)
            val result = (outcome as? ClipOutcome.Window)?.let { predictor?.classifyWindow(it.frames) }
            withContext(Dispatchers.Main) {
                // Cancelled meanwhile (mode, vocabulary, camera, or screen left):
                // the result belongs to a setup the user has moved away from.
                if (!tapSession.finishProcessing(event.generation)) return@withContext
                when {
                    result != null -> { showResult(result); renderTapState() }
                    outcome is ClipOutcome.Rejected -> showTapMessage(tapRejectionMessage(outcome.reason))
                    else -> showTapMessage(TAP_NOT_RECOGNIZED)
                }
            }
        }
    }

    /** Shows a one-line message above the record button for 3 s, then the normal prompt. */
    private fun showTapMessage(message: String) {
        renderTapState()
        binding.tvTapPrompt.text = message
        binding.tvTapPrompt.visibility = View.VISIBLE
        binding.tvTapPrompt.removeCallbacks(hideTapPrompt)
        binding.tvTapPrompt.postDelayed(hideTapPrompt, 3000)
    }

    private fun cancelTap() {
        tapSession.cancel()
        renderTapState()
    }

    /** Draws the tap controls for the current mode and session state. Main thread only. */
    private fun renderTapState() {
        val liveVisibility = if (tapMode) View.GONE else View.VISIBLE
        binding.tvDetectionLabel.visibility = liveVisibility
        binding.progressBuffer.visibility = liveVisibility
        binding.liveStatsRow.visibility = liveVisibility
        binding.tapControls.visibility = if (tapMode) View.VISIBLE else View.GONE

        tapPulse?.cancel(); tapPulse = null
        binding.btnTapRecord.alpha = 1f
        binding.tapRecordRing.removeCallbacks(tapRingTicker)
        if (!tapMode) return

        val accent = ContextCompat.getColor(this, R.color.sig_accent)
        val red = Color.parseColor("#E53935")
        binding.tvTapPrompt.removeCallbacks(hideTapPrompt)
        when (tapSession.state) {
            TapSignSession.State.IDLE -> {
                binding.btnTapRecord.text = "Tap to sign"
                binding.btnTapRecord.isEnabled = true
                binding.btnTapRecord.backgroundTintList = ColorStateList.valueOf(accent)
                binding.tapRecordRing.visibility = View.INVISIBLE
                binding.tvTapPrompt.visibility = View.GONE
            }
            TapSignSession.State.READY -> {
                binding.btnTapRecord.text = "Cancel"
                binding.btnTapRecord.isEnabled = true
                binding.btnTapRecord.backgroundTintList = ColorStateList.valueOf(accent)
                binding.tapRecordRing.visibility = View.INVISIBLE
                binding.tvTapPrompt.text = "Ready — start signing"
                binding.tvTapPrompt.visibility = View.VISIBLE
                tapPulse = ObjectAnimator.ofFloat(binding.btnTapRecord, View.ALPHA, 1f, 0.45f).apply {
                    duration = 600
                    repeatMode = ValueAnimator.REVERSE
                    repeatCount = ValueAnimator.INFINITE
                    start()
                }
            }
            TapSignSession.State.RECORDING -> {
                binding.btnTapRecord.text = "Stop"
                binding.btnTapRecord.isEnabled = true
                binding.btnTapRecord.backgroundTintList = ColorStateList.valueOf(red)
                binding.tapRecordRing.setProgressCompat(0, false)
                binding.tapRecordRing.visibility = View.VISIBLE
                binding.tvTapPrompt.text = "Recording…"
                binding.tvTapPrompt.visibility = View.VISIBLE
                binding.tapRecordRing.post(tapRingTicker)
            }
            TapSignSession.State.PROCESSING -> {
                binding.btnTapRecord.text = "…"
                binding.btnTapRecord.isEnabled = false
                binding.tapRecordRing.visibility = View.INVISIBLE
                binding.tvTapPrompt.text = "Recognizing…"
                binding.tvTapPrompt.visibility = View.VISIBLE
            }
        }
    }

    private fun updateModeToggleLabel() {
        binding.btnToggleMode.text = if (tapMode) "Tap" else "Live"
        applyToggleStyle(binding.btnToggleMode, tapMode)
    }
```

Add imports if missing: `android.content.res.ColorStateList`, `android.graphics.Color` (already used by `applyToggleStyle`).

(g) In `setupButtons()`, add:

```kotlin
        // Tap-to-sign record button.
        binding.btnTapRecord.setOnClickListener {
            tapSession.tap()?.let { handleTapEvent(it) }
        }

        // Live / Tap mode switch. Cancels any tap recording in progress and
        // clears the realtime buffer, so neither mode inherits the other's frames.
        binding.btnToggleMode.setOnClickListener {
            tapMode = !tapMode
            appSettings.translationMode = if (tapMode) AppSettings.MODE_TAP else AppSettings.MODE_LIVE
            predictor?.reset()
            predictor?.onNoHands?.invoke()
            updateModeToggleLabel()
            cancelTap()
        }
```

(h) Cancel on setup changes. Add `cancelTap()`:
- in the `btnFlipCamera` listener, after `resetHandednessLatch()`;
- in the `btnToggleVocabulary` listener, after `predictor.onNoHands?.invoke()`;
- at the start of `stopVision()`, before `if (!visionActive) return`.

- [ ] **Step 6: Build and run the unit suite**

Run (from `sigla-mobile/`): `./gradlew testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Verify on a device**

Install the debug build (`./gradlew installDebug` with the phone connected, or copy `app/build/outputs/apk/debug/app-debug.apk`). With the phone on a stand, check each item and note the result:

1. A fresh install opens in **Tap** mode. The toggle reads "Tap" (filled), the record button shows, and the buffer bar and stats are hidden.
2. Tap → "Ready — start signing" with a pulsing button. Sign a known word with hands starting out of frame → "Recording…" with the red ring filling → hands drop → "Recognizing…" → the word appears, is spoken, and **stays** on screen. The button shows "Tap to sign" again.
3. Tap, then keep hands out of frame for 5 s → "No hands seen — tap and try again".
4. Tap, sign very fast (a flick) → "Sign was too quick — try again, a little slower".
5. Tap, sign with hands resting in view afterwards → recording stops by itself at about 4 s.
6. While Recognizing, switch Words/Letters → no result appears for the old recording.
7. Switch to **Live** → realtime translation behaves exactly as before, and the tap controls disappear. Restart the app → it opens in Live. Switch back to Tap.
8. The translation history shows the tap results.

- [ ] **Step 8: Commit**

```bash
git add sigla-mobile/app/src/main/kotlin/com/example/sigla/AppSettings.kt sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt sigla-mobile/app/src/main/res/layout/activity_main.xml
git commit -m "feat(mobile): tap-to-sign mode with Live/Tap toggle, defaulting to Tap"
```

---

### Task 7: On-device comparison before shipping Tap as the default

**Files:**
- Create: `docs-internal/tap-vs-live-2026-09.md`

- [ ] **Step 1: Record the comparison**

With the same phone, stand and lighting, pick 10 deployed words covering easy and confusable ones (include at least GOOD AFTERNOON / GOOD EVENING and KNOW / DON'T UNDERSTAND). Sign each word 5 times in **Live** and 5 times in **Tap**. Record per attempt: correct / wrong word / nothing. Write `docs-internal/tap-vs-live-2026-09.md` with this table:

```markdown
# Tap vs Live — on-device comparison (2026-09)

Phone: <model> · Signer(s): <who> · Lighting: <where>

| Word | Live correct /5 | Live wrong word | Tap correct /5 | Tap wrong word | Tap rejected (reason) |
|---|---|---|---|---|---|
| HELLO | | | | | |

**Totals:** Live __/50 correct, __ wrong words · Tap __/50 correct, __ wrong words, __ rejections

**Decision:** keep Tap as default / revert default to Live
```

- [ ] **Step 2: Decide the default**

If Tap is not clearly better (more correct results and no more wrong words than Live), change the default in `AppSettings.translationMode` from `MODE_TAP` to `MODE_LIVE` (one line) and note it in the doc.

- [ ] **Step 3: Commit**

```bash
git add docs-internal/tap-vs-live-2026-09.md sigla-mobile/app/src/main/kotlin/com/example/sigla/AppSettings.kt
git commit -m "docs: tap vs live on-device comparison and default decision"
```
