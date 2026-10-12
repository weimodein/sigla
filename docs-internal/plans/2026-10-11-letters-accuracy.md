# Letters Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make letters mode recognise held letters as hand shapes (per-frame classifier) and J/Z as movements (small motion model), with no change to any screen.

**Architecture:** Extraction stores a raw, one-hand `hand_track` per letter clip. The ML service trains a static MLP on hold frames and a Conv1D motion model on J/Z movements, and exports both as ONE `.tflite` with two signatures (`static`, `motion`) so the backend and admin keep handling "the letters model" unchanged. The app detects that format and routes letters mode through a new `LetterEngine` (vote-on-hold + motion segmenter); words mode and legacy letters models keep the existing LSTM path.

**Tech Stack:** Python 3.10, TensorFlow 2.21, MediaPipe Tasks 0.10.35, FastAPI, pytest · Node.js/Express, Sequelize, `node --test` · Kotlin, TensorFlow Lite 2.14 (Android), MediaPipe tasks-vision 0.10.14, JUnit 4.

**Spec:** [docs-internal/specs/2026-10-11-letters-accuracy-design.md](../specs/2026-10-11-letters-accuracy-design.md)

## Global Constraints

- **No UI change.** No layout, string, chip, button, message or admin-panel change. Existing views may receive different values (the progress ring shows vote progress in letters mode).
- Words mode behaviour must not change. Any letters `.tflite` without both `static` and `motion` signatures must keep using the existing LSTM path.
- Letters `labels_motion.json` keeps its format `{"0": "A", "1": "B", …}` (backend deploy validation reads it).
- Hand input: 63 floats, raw MediaPipe image coordinates, **x and z multiplied by width / height**, signing hand = largest 2D extent after that correction.
- Letter constants (must match across Python and Kotlin, asserted by tests): motion frames 32; segmenter start 1.0, stop 0.5 (hand sizes/s), stop hold 200 ms, pad 150 ms, min 300 ms, max 2500 ms, max missing 0.25; commit 8 of 10 frames at ≥ 0.70; motion ≥ 0.70; replace window 1000 ms; start shapes J←I, Z←none.
- Motion letters: J and Z. `_none` is reserved and never shown.
- Commands: ML tests `cd sigla-ml && venv/Scripts/python.exe -m pytest …`; backend tests `cd sigla-backend && node --test …`; app tests `cd sigla-mobile && ./gradlew :app:testDebugUnitTest --tests …` (Git Bash).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on a branch (`feat/letters-accuracy`), not `main`.

## Review Focus

1. **An older APK (1.8) after the new letters model is deployed** — it must refuse the unfamiliar letters file, hide the Letters chip, and keep words working. Checked on a device in Task 12, step 3.
2. **TFLite op compatibility** — a model converted with TF 2.21 must load and run both signatures in the app's TFLite 2.14 runtime. Checked on a device in Task 12, step 4, with a stated fallback.
3. **A second hand in view while fingerspelling** (resting hand, someone behind) — the closer/larger hand must be used, the same way in training and live. Pinned by `selectPicksLargerHand` (Task 7) and `test_select_hand_picks_larger_extent` (Task 1).
4. **The hand leaves the frame in the middle of J/Z** — the movement must end cleanly, and produce no letter when more than 25 % of its frames have no hand. Pinned by `test_segmenter_drops_segment_with_too_many_missing_frames` (Task 1) and `handLossEndsSegment` (Task 8).
5. **Switching Words/Letters, or a model update, while a letter is half-held** — no stale votes may commit afterwards. Pinned by `resetClearsVotes` (Task 8) and the `resetBuffers` change in Task 9.

---

## File map

**sigla-ml**
- Create `app/utils/letters.py` — hand selection, hold finding, motion segmenter, single-take cutter, resampling (pure, no TF).
- Create `app/services/letters_train.py` — Keras models, augmentation, dataset building, fitting, evaluation, two-signature TFLite export, `train_letters()`, `leave_one_signer_out()`.
- Modify `app/services/extract.py` — add `extract_hand_track()`.
- Modify `app/routers/model.py` — `hand_track` query on `/extract-landmarks`, `model_kind` on `/train`.
- Modify `app/services/train.py` — dispatch `model_kind == "letters"`.
- Modify `app/utils/preprocessor.py` — `fetch_approved_samples(hand_track=False)`.
- Create `tools/extract_letter_tracks.py`, `tools/letters_experiment.py`, `tools/gen_letter_fixtures.py`.
- Modify `scripts/import_alphabets.py`, `scripts/_backend_import.py`.
- Tests: `tests/_letter_synth.py`, `tests/test_letters.py`, `tests/test_letters_train.py`, `tests/test_hand_track.py`, `tests/test_letters_route.py`; extend `tests/test_mobile_parity_flags.py`, `tests/test_backend_import.py`.

**sigla-backend**
- Create `migrations/008_gesture_samples_hand_track.sql`, `src/utils/mlDataset.js`, `test/mlDataset.test.js`.
- Modify `src/models/GestureSample.js`, `src/controllers/wordController.js`, `src/controllers/mlController.js`, `src/controllers/modelController.js`, `migrations/README.md`.

**sigla-mobile** (`app/src/main/kotlin/com/example/sigla/`)
- Create `LetterHand.kt`, `LetterSegmenter.kt`, `LetterStabilizer.kt`, `LetterEngine.kt`, `LetterTfliteClassifier.kt`.
- Modify `HandLandmarkHelper.kt`, `PredictionService.kt`, `TapSignSession.kt`, `ClipPreparer.kt` (RecordedFrame only), `MainActivity.kt`, `TranslationHistoryManager.kt`.
- Tests (`app/src/test/kotlin/com/example/sigla/`): `LetterHandTest.kt`, `LetterFixtures.kt` (generated), `LetterParityTest.kt`, `LetterSegmenterTest.kt`, `LetterStabilizerTest.kt`, `LetterEngineTest.kt`.

---

# Phase 0 — Offline experiment (no production change)

### Task 1: Letter geometry, hold finding and motion segmentation (Python)

**Files:**
- Create: `sigla-ml/app/utils/letters.py`
- Create: `sigla-ml/tests/_letter_synth.py`
- Test: `sigla-ml/tests/test_letters.py`

**Interfaces:**
- Produces (all in `app.utils.letters`):
  - constants `POINTS=21`, `FLOATS=63`, `MOTION_FRAMES=32`, `MOTION_LETTERS=("J","Z")`, `NONE_LABEL="_none"`, `SEGMENT_CONFIG` (dict), `HOLD_SPEED`, `MIN_HOLD_MS`, `HOLD_TRIM_MS`, `STATIC_STEP_MS`, `STATIC_MAX_SAMPLES`, `RAISE_SPEED`
  - `hand_extent(p: Sequence[float]) -> float`
  - `select_hand(hands: list[list[float]], width: int, height: int) -> list[float] | None`
  - frames everywhere are `list[dict]` with keys `t_ms: int` and `hand: list[float] | None`
  - `find_hold(frames) -> list[dict] | None`
  - `static_samples(frames) -> list[list[float]]`
  - `@dataclass Segment(start_ms: float, end_ms: float, frames: list[dict])`
  - `class MotionSegmenter` with `on_frame(t_ms, hand) -> Step` (`Step(moving: bool, segment: Segment | None)`)
  - `resample(points: list[tuple[float, list[float]]], from_ms, to_ms, t=MOTION_FRAMES) -> np.ndarray` shape `[t, 63]`
  - `segment_array(seg: Segment) -> np.ndarray` shape `[32, 63]`
  - `motion_segments(frames) -> list[np.ndarray]`
  - `@dataclass SingleTake(sign: Segment, rest: list[Segment])`, `find_single_take(frames) -> SingleTake | None`
- Produces (`tests/_letter_synth.py`): `synth_track(seed: int, kind: str = "static", fps: int = 24) -> list[dict]` (`kind` is `"static"` or `"J"`), `synth_hand(seed: int, center: tuple) -> list[float]`.

- [ ] **Step 1: Write the synthetic-track helper**

```python
# sigla-ml/tests/_letter_synth.py
"""Synthetic one-hand tracks shaped like real letter clips:
rest (no hand) -> raise -> hold [-> trace for J] -> lower -> rest.
Speeds are chosen against letters.SEGMENT_CONFIG: raise/lower/trace run at
several hand sizes per second, the hold well under HOLD_SPEED."""
import numpy as np


def _shape(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    pts = rng.normal(0, 0.05, size=(21, 3))
    pts[0] = 0.0
    return pts


def synth_hand(seed: int, center) -> list:
    return (_shape(seed) + np.asarray(center, dtype=float)).reshape(-1).tolist()


def synth_track(seed: int, kind: str = "static", fps: int = 24) -> list:
    shape = _shape(seed)
    rng = np.random.default_rng(seed + 1000)
    dt = 1000.0 / fps
    out, t = [], 0.0

    def add(center):
        nonlocal t
        if center is None:
            out.append({"t_ms": int(round(t)), "hand": None})
        else:
            p = shape + np.asarray(center, dtype=float) + rng.normal(0, 0.0005, shape.shape)
            out.append({"t_ms": int(round(t)), "hand": p.reshape(-1).tolist()})
        t += dt

    for _ in range(6):
        add(None)
    for k in range(10):                      # raise: y 1.2 -> 0.57
        add((0.5, 1.2 - 0.07 * k, 0.0))
    hold = 28 if kind == "static" else 8
    for _ in range(hold):                    # hold
        add((0.5, 0.5, 0.0))
    x, y = 0.5, 0.5
    if kind == "J":
        for _ in range(16):                  # trace
            x += 0.02
            y += 0.012
            add((x, y, 0.0))
        for _ in range(8):                   # settle
            add((x, y, 0.0))
    for k in range(10):                      # lower
        add((x, y + 0.07 * (k + 1), 0.0))
    for _ in range(8):
        add(None)
    return out
```

- [ ] **Step 2: Write the failing tests**

```python
# sigla-ml/tests/test_letters.py
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_letters.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.utils.letters'`

- [ ] **Step 4: Implement `letters.py`**

```python
# sigla-ml/app/utils/letters.py
"""One-hand letter features shared by extraction, training and the app parity
fixtures. Kotlin twins: LetterHand.kt, LetterSegmenter.kt — keep them in step
(tests/test_mobile_parity_flags.py and LetterParityTest check it).

Frames are dicts {"t_ms": int, "hand": [63 floats] | None}. A hand is raw
MediaPipe image coordinates with x and z multiplied by width / height, so x and
y share one unit. Normalisation happens inside the models.

Design: docs-internal/specs/2026-10-11-letters-accuracy-design.md
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

POINTS = 21
FLOATS = POINTS * 3
MOTION_FRAMES = 32
MOTION_LETTERS = ("J", "Z")
NONE_LABEL = "_none"

# Hold finding (static letters). Speeds are hand sizes per second.
HOLD_SPEED = 0.5
MIN_HOLD_MS = 300
HOLD_TRIM_MS = 100
STATIC_STEP_MS = 100
STATIC_MAX_SAMPLES = 40
# Single-take cutting (J/Z clips): the wrist rising/dropping faster than this is
# the raise/lower around the sign.
RAISE_SPEED = 0.5

# Motion segmenter. MUST equal LetterSegmenter.kt.
SEGMENT_CONFIG = {
    "start_speed": 1.0, "stop_speed": 0.5, "stop_hold_ms": 200, "pad_ms": 150,
    "min_ms": 300, "max_ms": 2500, "max_missing": 0.25,
}


def hand_extent(p) -> float:
    """Largest 2D distance from the wrist (point 0) to any other point."""
    return max(math.hypot(p[i * 3] - p[0], p[i * 3 + 1] - p[1]) for i in range(1, POINTS))


def select_hand(hands, width: int, height: int):
    """MediaPipe hands (63 raw floats each) -> the signing hand, aspect-corrected.

    The signing hand is the one with the largest 2D extent after correction
    (closest to the camera). Ties keep the earlier hand. None when there is no
    usable hand or the image size is unknown."""
    if not hands or width <= 0 or height <= 0:
        return None
    sx = width / height
    best, best_ext = None, -1.0
    for h in hands:
        if len(h) != FLOATS:
            continue
        p = [v if i % 3 == 1 else v * sx for i, v in enumerate(h)]
        e = hand_extent(p)
        if e > best_ext:
            best, best_ext = p, e
    return best


# ── speeds ──────────────────────────────────────────────────────────────────

def _smooth3(raw: list) -> list:
    """Centred mean of each value and its neighbours; None if any is None."""
    out = []
    for i in range(len(raw)):
        window = raw[max(0, i - 1):i + 2]
        out.append(None if any(v is None for v in window) else sum(window) / len(window))
    return out


def _speeds(frames: list) -> list:
    raw, prev = [], None
    for f in frames:
        cur, before = f["hand"], (prev["hand"] if prev else None)
        if cur is None or before is None:
            raw.append(None)
        else:
            dt = (f["t_ms"] - prev["t_ms"]) / 1000
            size = hand_extent(cur)
            moved = sum(math.hypot(cur[i * 3] - before[i * 3], cur[i * 3 + 1] - before[i * 3 + 1])
                        for i in range(POINTS))
            raw.append(moved / POINTS / size / dt if dt > 0 and size > 0 else None)
        prev = f
    return _smooth3(raw)


def _wrist_drop_speeds(frames: list) -> list:
    """Vertical wrist speed, hand sizes per second (+ = moving down)."""
    raw, prev = [], None
    for f in frames:
        cur, before = f["hand"], (prev["hand"] if prev else None)
        if cur is None or before is None:
            raw.append(None)
        else:
            dt = (f["t_ms"] - prev["t_ms"]) / 1000
            size = hand_extent(cur)
            raw.append((cur[1] - before[1]) / size / dt if dt > 0 and size > 0 else None)
        prev = f
    return _smooth3(raw)


# ── static letters ──────────────────────────────────────────────────────────

def find_hold(frames: list):
    """The frames where the letter is held: the still run (speed <= HOLD_SPEED,
    at least MIN_HOLD_MS) where the hand is highest in the picture, minus
    HOLD_TRIM_MS at each end. None when the hand never holds still."""
    speeds = _speeds(frames)
    runs, start = [], None
    for i, s in enumerate(speeds + [None]):
        still = s is not None and s <= HOLD_SPEED
        if still and start is None:
            start = i
        elif not still and start is not None:
            runs.append((start, i - 1))
            start = None
    runs = [(a, b) for a, b in runs if frames[b]["t_ms"] - frames[a]["t_ms"] >= MIN_HOLD_MS]
    if not runs:
        return None

    def height(run):
        ys = sorted(frames[i]["hand"][1] for i in range(run[0], run[1] + 1))
        return ys[len(ys) // 2]

    a, b = min(runs, key=lambda r: (round(height(r), 2), -(r[1] - r[0])))
    lo, hi = frames[a]["t_ms"] + HOLD_TRIM_MS, frames[b]["t_ms"] - HOLD_TRIM_MS
    return [f for f in frames[a:b + 1] if lo <= f["t_ms"] <= hi] or frames[a:b + 1]


def static_samples(frames: list) -> list:
    """One hand every STATIC_STEP_MS from the hold, at most STATIC_MAX_SAMPLES."""
    hold = find_hold(frames)
    if hold is None:
        return []
    picked, next_t = [], None
    for f in hold:
        if f["hand"] is None:
            continue
        if next_t is None or f["t_ms"] >= next_t:
            picked.append(f["hand"])
            next_t = f["t_ms"] + STATIC_STEP_MS
    if len(picked) > STATIC_MAX_SAMPLES:
        idx = np.linspace(0, len(picked) - 1, STATIC_MAX_SAMPLES).round().astype(int)
        picked = [picked[i] for i in idx]
    return picked


# ── motion ──────────────────────────────────────────────────────────────────

@dataclass
class Segment:
    start_ms: float
    end_ms: float
    frames: list


@dataclass
class Step:
    moving: bool
    segment: Optional[Segment] = None


def resample(points: list, from_ms: float, to_ms: float, t: int = MOTION_FRAMES) -> np.ndarray:
    """[(t_ms, 63 floats)] sorted by time -> [t, 63] by linear interpolation at
    t evenly spaced times; clamps to the first/last frame outside their range.
    MUST match LetterSegmenter.resample."""
    times = np.array([p[0] for p in points], dtype="float64")
    values = np.array([np.asarray(p[1], dtype="float32") for p in points])
    out = np.empty((t, FLOATS), dtype="float32")
    for k in range(t):
        tk = from_ms + k * (to_ms - from_ms) / (t - 1)
        after = int(np.searchsorted(times, tk, side="left"))
        if after >= len(times):
            out[k] = values[-1]
        elif after == 0:
            out[k] = values[0]
        else:
            ta, tb = times[after - 1], times[after]
            w = 1.0 if tb == ta else (tk - ta) / (tb - ta)
            out[k] = values[after - 1] + (values[after] - values[after - 1]) * w
    return out


def segment_array(seg: Segment) -> np.ndarray:
    pts = [(f["t_ms"], f["hand"]) for f in seg.frames if f["hand"] is not None]
    return resample(pts, seg.start_ms, seg.end_ms)


class MotionSegmenter:
    """Finds hand movements in a live stream. MUST match LetterSegmenter.kt."""

    def __init__(self, config: Optional[dict] = None):
        self.c = {**SEGMENT_CONFIG, **(config or {})}
        self.buffer: list = []
        self.prev: Optional[dict] = None
        self.speeds: list = []
        self.moving = False
        self.start_ms = 0.0
        self.below_since_ms: Optional[float] = None
        self.last_hand_ms: Optional[float] = None

    def on_frame(self, t_ms: float, hand) -> Step:
        c = self.c
        frame = {"t_ms": t_ms, "hand": hand}
        self.buffer.append(frame)
        while t_ms - self.buffer[0]["t_ms"] > c["max_ms"] + c["pad_ms"] + c["stop_hold_ms"]:
            self.buffer.pop(0)
        smoothed = self._smoothed_speed(frame)
        self.prev = frame
        if hand is not None:
            self.last_hand_ms = t_ms

        if not self.moving:
            if smoothed is not None and smoothed > c["start_speed"]:
                self.moving = True
                self.start_ms = t_ms
                self.below_since_ms = None
            return Step(self.moving)

        end_ms = None
        if hand is None:
            if self.last_hand_ms is not None and t_ms - self.last_hand_ms > c["stop_hold_ms"]:
                end_ms = self.last_hand_ms
        elif smoothed is None:
            end_ms = None
        elif smoothed < c["stop_speed"]:
            if self.below_since_ms is None:
                self.below_since_ms = t_ms
            if t_ms - self.below_since_ms >= c["stop_hold_ms"]:
                end_ms = self.below_since_ms
        else:
            self.below_since_ms = None
        if end_ms is None:
            return Step(True)
        self.moving = False
        self.below_since_ms = None
        return Step(False, self._build(self.start_ms - c["pad_ms"], end_ms))

    def _smoothed_speed(self, frame: dict):
        cur = frame["hand"]
        if cur is None:
            self.speeds = []
            return None
        before = self.prev["hand"] if self.prev else None
        if before is None:
            return None
        dt_sec = (frame["t_ms"] - self.prev["t_ms"]) / 1000
        size = hand_extent(cur)
        if dt_sec <= 0 or size <= 0:
            return None
        moved = sum(math.hypot(cur[i * 3] - before[i * 3], cur[i * 3 + 1] - before[i * 3 + 1])
                    for i in range(POINTS))
        self.speeds.append(moved / POINTS / size / dt_sec)
        self.speeds = self.speeds[-3:]
        return sum(self.speeds) / len(self.speeds)

    def _build(self, from_ms: float, to_ms: float) -> Optional[Segment]:
        c = self.c
        if not c["min_ms"] <= to_ms - from_ms <= c["max_ms"]:
            return None
        cut = [f for f in self.buffer if from_ms <= f["t_ms"] <= to_ms]
        if not cut:
            return None
        missing = sum(1 for f in cut if f["hand"] is None) / len(cut)
        if missing > c["max_missing"]:
            return None
        if not any(f["hand"] is not None for f in cut):
            return None
        return Segment(from_ms, to_ms, cut)


def motion_segments(frames: list) -> list:
    """Every movement the live segmenter would find, resampled to [32, 63]."""
    seg = MotionSegmenter()
    out = []
    for f in frames:
        step = seg.on_frame(f["t_ms"], f["hand"])
        if step.segment is not None:
            out.append(segment_array(step.segment))
    return out


@dataclass
class SingleTake:
    sign: Segment
    rest: list


def _span(frames: list, from_ms: float, to_ms: float) -> Optional[Segment]:
    c = SEGMENT_CONFIG
    if not c["min_ms"] <= to_ms - from_ms <= c["max_ms"]:
        return None
    cut = [f for f in frames if from_ms <= f["t_ms"] <= to_ms]
    missing = sum(1 for f in cut if f["hand"] is None)
    if not cut or missing == len(cut) or missing / len(cut) > c["max_missing"]:
        return None
    return Segment(from_ms, to_ms, cut)


def find_single_take(frames: list) -> Optional[SingleTake]:
    """The one movement in a rest -> raise -> (hold) -> MOVE -> settle -> lower
    clip, plus the raise and lower as `rest` (they become _none samples).
    Ported from Senya's extract.find_single_take (measured on 40 real J clips)."""
    c = SEGMENT_CONFIG
    speeds, drop = _speeds(frames), _wrist_drop_speeds(frames)
    hand = [i for i, f in enumerate(frames) if f["hand"] is not None]
    if not hand:
        return None
    first, last = hand[0], hand[-1]

    def t(i):
        return frames[i]["t_ms"]

    def still(i):
        return speeds[i] is not None and speeds[i] < c["stop_speed"]

    def fast(i):
        return speeds[i] is not None and speeds[i] > c["start_speed"]

    rise_start = first
    while rise_start < last and (speeds[rise_start] is None or still(rise_start)):
        rise_start += 1
    raise_end = rise_start
    while raise_end < last and (drop[raise_end] is None or -drop[raise_end] > RAISE_SPEED):
        raise_end += 1
    lower_start = last
    while lower_start > raise_end and (drop[lower_start] is None or drop[lower_start] > RAISE_SPEED):
        lower_start -= 1

    start = next((i for i in range(raise_end, lower_start + 1)
                  if fast(i) and not any(still(k) for k in range(i, lower_start + 1)
                                         if t(k) - t(i) <= c["min_ms"])),
                 None)
    if start is None:
        return None
    end, i = lower_start, start + 1
    while i <= lower_start:
        if still(i):
            k = i
            while k < lower_start and still(k + 1):
                k += 1
            if k == lower_start or t(k) - t(i) >= c["stop_hold_ms"]:
                end = i
                break
            i = k
        i += 1

    sign = _span(frames, t(start) - c["pad_ms"], t(end))
    if sign is None:
        return None
    rest = [s for s in (_span(frames, t(rise_start) - c["pad_ms"], t(raise_end)),
                        _span(frames, t(lower_start) - c["pad_ms"], t(last))) if s]
    return SingleTake(sign, rest)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_letters.py -v`
Expected: 8 passed. If `test_single_take_cuts_the_j_movement` or `test_segmenter_finds_raise_and_lower_of_a_static_clip` fails, print the speeds of the synthetic track and fix the **synthetic track's speeds** (they must sit clearly above 1.0 / below 0.5 hand sizes per second), not the thresholds. The thresholds were measured on real clips.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/letters-accuracy
git add sigla-ml/app/utils/letters.py sigla-ml/tests/_letter_synth.py sigla-ml/tests/test_letters.py
git commit -m "feat(ml): one-hand letter geometry, hold finding and motion segmenter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Letter models, training and two-signature TFLite export

**Files:**
- Create: `sigla-ml/app/services/letters_train.py`
- Test: `sigla-ml/tests/test_letters_train.py`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces (in `app.services.letters_train`):
  - `@dataclass LetterSample(label: str, group: str, frames: list[dict])`
  - `@dataclass Part(x: np.ndarray, y: np.ndarray, clip: np.ndarray, group: np.ndarray)`
  - `@dataclass LetterData(labels: list[str], static_labels: list[str], motion_labels: list[str], static: Part, motion: Part)` — `motion_labels[0] == "_none"`
  - `build_dataset(samples: list[LetterSample], labels: list[str]) -> LetterData`
  - `fit_pair(data, train_s, train_m, val_s=None, val_m=None, static_epochs=None, motion_epochs=None) -> tuple[keras.Model, keras.Model | None, int, int]`
  - `predict_clips(data, static_model, motion_model, mask_s, mask_m) -> tuple[list[str], list[str]]`
  - `none_false_alarm(data, motion_model, mask_m) -> float | None`
  - `letter_report(true: list[str], pred: list[str]) -> dict` (keys `accuracy, precision, recall, f1_score, classification_report, top_confusions, per_letter`)
  - `export_tflite(data, static_model, motion_model) -> bytes`
  - `tflite_probs(tflite_bytes: bytes, signature: str, x: np.ndarray) -> np.ndarray`
  - `verify_tflite(tflite_bytes, data, static_model, motion_model) -> None` (raises `RuntimeError`)
  - `leave_one_signer_out(samples, labels) -> dict`
  - `train_letters(...)` is added in Task 5.

- [ ] **Step 1: Write the failing tests**

```python
# sigla-ml/tests/test_letters_train.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_letters_train.py -v`
Expected: FAIL with `ImportError: cannot import name 'letters_train'`

- [ ] **Step 3: Implement `letters_train.py`**

```python
# sigla-ml/app/services/letters_train.py
"""Letters models: a per-frame hand-shape classifier (static letters) and a
Conv1D movement classifier (J, Z, _none), exported together as ONE .tflite with
two signatures so the backend keeps storing "the letters model".

Design: docs-internal/specs/2026-10-11-letters-accuracy-design.md
"""
from __future__ import annotations

import os
import tempfile
from collections import Counter
from dataclasses import dataclass

import numpy as np
import tensorflow as tf
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix,
                             f1_score, precision_score, recall_score)

from app.utils import letters as L

EPS = 1e-6
SEED = int(os.getenv("TRAIN_SEED", 42))
STATIC_EPOCHS = int(os.getenv("LETTERS_STATIC_EPOCHS", 60))
MOTION_EPOCHS = int(os.getenv("LETTERS_MOTION_EPOCHS", 50))
STATIC_AUG_COPIES = int(os.getenv("LETTERS_STATIC_AUG_COPIES", 2))
MOTION_AUG_COPIES = int(os.getenv("LETTERS_MOTION_AUG_COPIES", 3))


# ── models ──────────────────────────────────────────────────────────────────

@tf.keras.utils.register_keras_serializable(package="sigla")
class WristNormalize(tf.keras.layers.Layer):
    """[B, 21, 3] -> minus the wrist, divided by the largest 2D wrist distance."""

    def call(self, x):
        rel = x - x[:, 0:1, :]
        size = tf.reduce_max(tf.norm(rel[..., :2], axis=-1), axis=-1)
        return rel / (size[:, None, None] + EPS)


@tf.keras.utils.register_keras_serializable(package="sigla")
class SequenceNormalize(tf.keras.layers.Layer):
    """[B, T, 21, 3] -> minus FRAME 0's wrist, divided by FRAME 0's hand size,
    so the path of the movement survives."""

    def call(self, x):
        rel = x - x[:, 0:1, 0:1, :]
        size0 = tf.reduce_max(tf.norm(rel[:, 0, :, :2], axis=-1), axis=-1)
        return rel / (size0[:, None, None, None] + EPS)


def build_static_model(n_classes: int) -> tf.keras.Model:
    inp = tf.keras.Input(shape=(L.FLOATS,), name="landmarks")
    x = tf.keras.layers.Reshape((L.POINTS, 3))(inp)
    x = WristNormalize()(x)
    x = tf.keras.layers.Flatten()(x)
    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    x = tf.keras.layers.Dense(64, activation="relu")(x)
    out = tf.keras.layers.Dense(n_classes, activation="softmax")(x)
    return tf.keras.Model(inp, out, name="sigla_letters_static")


def build_motion_model(n_classes: int) -> tf.keras.Model:
    """Conv1D, not LSTM: plain TFLite builtins, no Flex ops."""
    inp = tf.keras.Input(shape=(L.MOTION_FRAMES, L.FLOATS), name="frames")
    x = tf.keras.layers.Reshape((L.MOTION_FRAMES, L.POINTS, 3))(inp)
    x = SequenceNormalize()(x)
    x = tf.keras.layers.Reshape((L.MOTION_FRAMES, L.FLOATS))(x)
    x = tf.keras.layers.Conv1D(64, 5, padding="same", activation="relu")(x)
    x = tf.keras.layers.Conv1D(64, 5, padding="same", activation="relu")(x)
    x = tf.keras.layers.MaxPool1D(2)(x)
    x = tf.keras.layers.Conv1D(128, 3, padding="same", activation="relu")(x)
    x = tf.keras.layers.GlobalMaxPool1D()(x)
    x = tf.keras.layers.Dense(64, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    out = tf.keras.layers.Dense(n_classes, activation="softmax")(x)
    return tf.keras.Model(inp, out, name="sigla_letters_motion")


# ── augmentation ────────────────────────────────────────────────────────────

def _pts(a):
    return np.asarray(a, dtype="float32").reshape(*np.shape(a)[:-1], L.POINTS, 3)


def mirror(a):
    """Left/right flip. Normalisation subtracts the wrist, so -x is enough."""
    p = _pts(a).copy()
    p[..., 0] = -p[..., 0]
    return p.reshape(np.shape(a))


def rotate_scale_noise(a, rng, max_deg=15.0, scale=0.10, noise=0.004):
    """One rotation (xy, about the first wrist), scale and Gaussian noise. A
    sequence gets the same rotation and scale in every frame."""
    p = _pts(a).copy()
    origin = p.reshape(-1, L.POINTS, 3)[0, 0].copy()
    theta = np.deg2rad(rng.uniform(-max_deg, max_deg))
    s = 1.0 + rng.uniform(-scale, scale)
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], dtype="float32")
    rel = p - origin
    rel[..., :2] = rel[..., :2] @ rot.T
    out = origin + rel * s + rng.normal(0, noise, size=p.shape).astype("float32")
    return out.astype("float32").reshape(np.shape(a))


def time_warp(seq, rng, amount=0.2):
    """Smooth monotonic speed change. seq is [T, 63]."""
    t = seq.shape[0]
    u = np.linspace(0.0, 1.0, t)
    amp = rng.uniform(-amount, amount)
    warped = np.clip(u + amp * np.sin(2 * np.pi * u) / (2 * np.pi), 0.0, 1.0)
    pos = warped * (t - 1)
    base = np.arange(t)
    return np.stack([np.interp(pos, base, seq[:, j]) for j in range(seq.shape[1])], axis=1).astype("float32")


def augment_static(x, y, rng, copies=STATIC_AUG_COPIES):
    parts = [x, mirror(x)]
    for _ in range(copies):
        for base in (x, mirror(x)):
            parts.append(np.stack([rotate_scale_noise(r, rng) for r in base]))
    return np.concatenate(parts).astype("float32"), np.tile(y, len(parts))


def augment_motion(x, y, rng, copies=MOTION_AUG_COPIES):
    xs, ys = [], []
    for seq, lab in zip(x, y):
        xs += [seq, mirror(seq)]
        ys += [lab, lab]
        for _ in range(copies):
            a = rotate_scale_noise(time_warp(seq, rng), rng)
            xs.append(mirror(a) if rng.random() < 0.5 else a)
            ys.append(lab)
    return np.stack(xs).astype("float32"), np.asarray(ys)


# ── data ────────────────────────────────────────────────────────────────────

@dataclass
class LetterSample:
    label: str
    group: str
    frames: list


@dataclass
class Part:
    x: np.ndarray
    y: np.ndarray
    clip: np.ndarray    # index into the sample list; -1 for _none movements
    group: np.ndarray


@dataclass
class LetterData:
    labels: list
    static_labels: list
    motion_labels: list
    static: Part
    motion: Part


def build_dataset(samples: list, labels: list) -> LetterData:
    labels = sorted(labels)
    static_labels = [l for l in labels if l not in L.MOTION_LETTERS]
    motion_labels = [L.NONE_LABEL] + [l for l in labels if l in L.MOTION_LETTERS]
    s = ([], [], [], [])
    m = ([], [], [], [])
    for i, smp in enumerate(samples):
        if smp.label not in labels:
            continue
        if smp.label in L.MOTION_LETTERS:
            take = L.find_single_take(smp.frames)
            if take is None:
                continue
            for part, v in zip(m, (L.segment_array(take.sign), motion_labels.index(smp.label), i, smp.group)):
                part.append(v)
            for r in take.rest:
                for part, v in zip(m, (L.segment_array(r), 0, -1, smp.group)):
                    part.append(v)
        else:
            for h in L.static_samples(smp.frames):
                for part, v in zip(s, (h, static_labels.index(smp.label), i, smp.group)):
                    part.append(v)
            for seg in L.motion_segments(smp.frames):
                for part, v in zip(m, (seg, 0, -1, smp.group)):
                    part.append(v)

    def make(p, shape):
        return Part(np.asarray(p[0], "float32").reshape((-1,) + shape),
                    np.asarray(p[1], "int64"), np.asarray(p[2], "int64"), np.asarray(p[3], dtype=object))

    return LetterData(labels, static_labels, motion_labels,
                      make(s, (L.FLOATS,)), make(m, (L.MOTION_FRAMES, L.FLOATS)))


# ── fitting ─────────────────────────────────────────────────────────────────

def _fit(model, x, y, val, epochs, class_weight=None) -> int:
    tf.keras.utils.set_random_seed(SEED)
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    callbacks = ([tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=6, restore_best_weights=True)]
                 if val is not None else [])
    hist = model.fit(x, y, validation_data=val, epochs=epochs, batch_size=64, shuffle=True,
                     verbose=0, callbacks=callbacks, class_weight=class_weight)
    if val is not None:
        return int(np.argmin(hist.history["val_loss"])) + 1
    return epochs


def _balanced(y, n) -> dict:
    counts = np.bincount(y, minlength=n)
    present = [i for i in range(n) if counts[i] > 0]
    return {i: len(y) / (len(present) * counts[i]) for i in present}


def fit_pair(data: LetterData, train_s, train_m, val_s=None, val_m=None,
             static_epochs=None, motion_epochs=None):
    """Trains the static model (always) and the motion model (when the training
    rows hold at least two motion classes). With validation masks, epochs are
    chosen by early stopping and returned; without, the given counts are used."""
    static_epochs = static_epochs or STATIC_EPOCHS
    motion_epochs = motion_epochs or MOTION_EPOCHS
    rng = np.random.default_rng(SEED)
    S, M = data.static, data.motion

    ax, ay = augment_static(S.x[train_s], S.y[train_s], rng)
    sval = (S.x[val_s], S.y[val_s]) if val_s is not None and val_s.any() else None
    static_model = build_static_model(len(data.static_labels))
    s_ep = _fit(static_model, ax, ay, sval, static_epochs)

    motion_model, m_ep = None, 0
    if len(data.motion_labels) > 1 and train_m.any() and len(set(M.y[train_m].tolist())) > 1:
        bx, by = augment_motion(M.x[train_m], M.y[train_m], rng)
        mval = (M.x[val_m], M.y[val_m]) if val_m is not None and val_m.any() else None
        motion_model = build_motion_model(len(data.motion_labels))
        m_ep = _fit(motion_model, bx, by, mval, motion_epochs,
                    class_weight=_balanced(by, len(data.motion_labels)))
    return static_model, motion_model, s_ep, m_ep


# ── evaluation ──────────────────────────────────────────────────────────────

def predict_clips(data: LetterData, static_model, motion_model, mask_s, mask_m):
    """Clip-level labels: a static clip's letter is the majority vote over its
    hold frames (as live voting does); a J/Z clip is its one movement."""
    true, pred = [], []
    S, M = data.static, data.motion
    if mask_s.any():
        guesses = static_model.predict(S.x[mask_s], verbose=0).argmax(1)
        clips, ys = S.clip[mask_s], S.y[mask_s]
        for c in np.unique(clips):
            sel = clips == c
            vote = Counter(guesses[sel].tolist()).most_common(1)[0][0]
            true.append(data.static_labels[int(ys[sel][0])])
            pred.append(data.static_labels[vote])
    real = mask_m & (M.clip >= 0)
    if real.any():
        guesses = (np.zeros(real.sum(), int) if motion_model is None
                   else motion_model.predict(M.x[real], verbose=0).argmax(1))
        true += [data.motion_labels[int(i)] for i in M.y[real]]
        pred += [data.motion_labels[int(i)] for i in guesses]
    return true, pred


def none_false_alarm(data: LetterData, motion_model, mask_m):
    """Share of non-letter movements the motion model calls a letter."""
    sel = mask_m & (data.motion.clip < 0)
    if motion_model is None or not sel.any():
        return None
    return float((motion_model.predict(data.motion.x[sel], verbose=0).argmax(1) != 0).mean())


def letter_report(true: list, pred: list) -> dict:
    names = sorted(set(true) | set(pred))
    cm = confusion_matrix(true, pred, labels=names)
    confusions = sorted(((int(cm[i, j]), names[i], names[j]) for i in range(len(names))
                         for j in range(len(names)) if i != j and cm[i, j] > 0), reverse=True)
    per_letter = {}
    for name in sorted(set(true)):
        idx = [k for k, t in enumerate(true) if t == name]
        per_letter[name] = round(sum(pred[k] == name for k in idx) / len(idx), 4)
    return {
        "accuracy": round(float(accuracy_score(true, pred)), 4),
        "precision": round(float(precision_score(true, pred, average="weighted", zero_division=0)), 4),
        "recall": round(float(recall_score(true, pred, average="weighted", zero_division=0)), 4),
        "f1_score": round(float(f1_score(true, pred, average="weighted", zero_division=0)), 4),
        "classification_report": classification_report(true, pred, zero_division=0),
        "top_confusions": "\n".join(f"  {t} -> predicted as {p}: {c}" for c, t, p in confusions[:10])
                          or "  (none - every clip classified correctly)",
        "per_letter": per_letter,
    }


# ── export ──────────────────────────────────────────────────────────────────

def _scatter(src_labels: list, labels: list, none_last: bool) -> np.ndarray:
    n = len(labels) + (1 if none_last else 0)
    m = np.zeros((len(src_labels), n), dtype="float32")
    for i, l in enumerate(src_labels):
        m[i, len(labels) if l == L.NONE_LABEL else labels.index(l)] = 1.0
    return m


def export_tflite(data: LetterData, static_model, motion_model) -> bytes:
    """One .tflite, two signatures (spec "Two letter models in one file"):
    static(landmarks[1,63]) -> probabilities[1,N]; motion(frames[1,32,63]) ->
    probabilities[1,N+1], last column _none."""
    n = len(data.labels)
    s_scatter = tf.constant(_scatter(data.static_labels, data.labels, none_last=False))
    m_scatter = tf.constant(_scatter(data.motion_labels, data.labels, none_last=True))

    class Letters(tf.Module):
        def __init__(self):
            super().__init__()
            self.s = static_model
            self.m = motion_model

        @tf.function(input_signature=[tf.TensorSpec([1, L.FLOATS], tf.float32, name="landmarks")])
        def static(self, landmarks):
            return {"probabilities": tf.matmul(self.s(landmarks, training=False), s_scatter)}

        @tf.function(input_signature=[tf.TensorSpec([1, L.MOTION_FRAMES, L.FLOATS], tf.float32, name="frames")])
        def motion(self, frames):
            if self.m is None:
                # No motion letters trained: everything is "not a letter".
                return {"probabilities": tf.one_hot([n], n + 1) + 0.0 * tf.reduce_sum(frames)}
            return {"probabilities": tf.matmul(self.m(frames, training=False), m_scatter)}

    module = Letters()
    with tempfile.TemporaryDirectory() as d:
        tf.saved_model.save(module, d, signatures={
            "static": module.static.get_concrete_function(),
            "motion": module.motion.get_concrete_function(),
        })
        conv = tf.lite.TFLiteConverter.from_saved_model(d, signature_keys=["static", "motion"])
        return conv.convert()


def tflite_probs(tflite_bytes: bytes, signature: str, x: np.ndarray) -> np.ndarray:
    runner = tf.lite.Interpreter(model_content=tflite_bytes).get_signature_runner(signature)
    key = "landmarks" if signature == "static" else "frames"
    return np.stack([runner(**{key: row[None, ...].astype("float32")})["probabilities"][0] for row in x])


def verify_tflite(tflite_bytes: bytes, data: LetterData, static_model, motion_model, n: int = 32) -> None:
    """The .tflite must predict like Keras, or the version must not ship."""
    xs = data.static.x[:n]
    want = static_model.predict(xs, verbose=0) @ _scatter(data.static_labels, data.labels, False)
    got = tflite_probs(tflite_bytes, "static", xs)
    if not np.allclose(want, got, atol=1e-3) or not (want.argmax(1) == got.argmax(1)).all():
        raise RuntimeError(f"static TFLite does not match Keras (max diff {np.abs(want - got).max():.4f})")
    if motion_model is not None and len(data.motion.x):
        xm = data.motion.x[:n]
        want = motion_model.predict(xm, verbose=0) @ _scatter(data.motion_labels, data.labels, True)
        got = tflite_probs(tflite_bytes, "motion", xm)
        if not np.allclose(want, got, atol=1e-3) or not (want.argmax(1) == got.argmax(1)).all():
            raise RuntimeError(f"motion TFLite does not match Keras (max diff {np.abs(want - got).max():.4f})")


# ── leave-one-signer-out (the honest number) ────────────────────────────────

def leave_one_signer_out(samples: list, labels: list) -> dict:
    """For each signer: choose epochs on one other signer, refit on every
    other signer, score the held-out signer's clips. Every clip is scored once,
    by a model that never saw its signer."""
    data = build_dataset(samples, labels)
    groups = sorted(set(data.static.group.tolist()) | set(data.motion.group.tolist()))
    folds, all_true, all_pred = [], [], []
    for g in groups:
        others = [o for o in groups if o != g]
        v = others[SEED % len(others)]
        tr_s, tr_m = data.static.group != g, data.motion.group != g
        val_s, val_m = data.static.group == v, data.motion.group == v
        _, _, se, me = fit_pair(data, tr_s & ~val_s, tr_m & ~val_m, val_s, val_m)
        s, m, _, _ = fit_pair(data, tr_s, tr_m, static_epochs=se, motion_epochs=max(me, 1))
        t, p = predict_clips(data, s, m, ~tr_s, ~tr_m)
        folds.append({
            "signer": g,
            "clips": len(t),
            "accuracy": round(float(np.mean([a == b for a, b in zip(t, p)])) if t else 0.0, 4),
            "none_false_alarm": none_false_alarm(data, m, ~tr_m),
        })
        all_true += t
        all_pred += p
    return {
        "folds": folds,
        "mean_accuracy": round(float(np.mean([f["accuracy"] for f in folds])), 4),
        "report": letter_report(all_true, all_pred),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_letters_train.py -v`
Expected: 3 passed. If `tf.saved_model.save` cannot track the Keras 3 models inside the `tf.Module`, build the same two endpoints with `keras.export.ExportArchive` instead (`archive.track(model)` for both, `archive.add_endpoint(name="static", fn=…, input_signature=[tf.TensorSpec([1, 63], tf.float32, name="landmarks")])`, likewise `motion`, `archive.write_out(d)`), then convert `d` with the same `signature_keys`. The signature names, input names and output key `probabilities` must not change.

- [ ] **Step 5: Commit**

```bash
git add sigla-ml/app/services/letters_train.py sigla-ml/tests/test_letters_train.py
git commit -m "feat(ml): letter static/motion models and two-signature TFLite export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hand-track extraction and the local track cache

**Files:**
- Modify: `sigla-ml/app/services/extract.py` (add imports, `_make_video_landmarker`, `_downscale`, `extract_hand_track`)
- Create: `sigla-ml/tools/extract_letter_tracks.py`
- Modify: `sigla-ml/.gitignore` (or repo `.gitignore`): add `sigla-ml/letter_tracks/`
- Test: `sigla-ml/tests/test_hand_track.py`

**Interfaces:**
- Consumes: `letters.select_hand`, `letters.static_samples`.
- Produces: `extract_hand_track(video_bytes: bytes, filename: str | None = None) -> dict | None` returning `{"version": 1, "frames": [{"t_ms": int, "hand": [63 floats] | None}, …]}` (trimmed to the first/last hand ± 4 frames), or None when no hand is ever seen. Cache layout: `letter_tracks/<LETTER>/<signer>/<clip-stem>.json`, same JSON.

- [ ] **Step 1: Write the failing test** (uses one real clip; skips when the dataset is not on disk)

```python
# sigla-ml/tests/test_hand_track.py
import glob
import os

import pytest

from app.utils import letters as L

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_CLIPS = sorted(glob.glob(os.path.join(_ROOT, "datasets", "LETTERS(A-L)", "A", "*", "*.MOV")))


@pytest.mark.skipif(not _CLIPS, reason="letter clips not on disk")
def test_hand_track_from_real_clip():
    from app.services.extract import extract_hand_track
    with open(_CLIPS[0], "rb") as f:
        track = extract_hand_track(f.read(), os.path.basename(_CLIPS[0]))
    assert track is not None and track["version"] == 1
    frames = track["frames"]
    assert len(frames) >= 24
    ts = [f["t_ms"] for f in frames]
    assert ts == sorted(ts)
    hands = [f["hand"] for f in frames if f["hand"] is not None]
    assert hands and all(len(h) == L.FLOATS for h in hands)
    assert L.static_samples(frames), "a real A clip must have a hold"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_hand_track.py -v`
Expected: FAIL with `ImportError: cannot import name 'extract_hand_track'`

- [ ] **Step 3: Implement `extract_hand_track`** — append to `extract.py`, and add `from app.utils.letters import select_hand` to its imports.

```python
# ── Letters: one-hand track (docs-internal/specs/2026-10-11-letters-accuracy-design.md)
#
# Separate from extract_motion_landmarks on purpose: letters need EVERY frame of
# the signing span (the hold and the J/Z path), raw and one-handed, while the
# words window is 30 normalised frames around the fastest movement. VIDEO mode
# tracks between frames like the live camera. Called only for letter words.
HAND_TRACK_FPS = float(os.getenv("HAND_TRACK_FPS", 24.0))
HAND_TRACK_MAX_SIDE = int(os.getenv("HAND_TRACK_MAX_SIDE", 640))


def _make_video_landmarker() -> "vision.HandLandmarker":
    model_path = os.path.abspath(_MODEL_PATH)
    if not os.path.isfile(model_path):
        raise FileNotFoundError(f"HandLandmarker model not found: {model_path}")
    return vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    ))


def _downscale(bgr: np.ndarray) -> np.ndarray:
    """Landmarks are normalised, so a uniform resize does not change them."""
    h, w = bgr.shape[:2]
    scale = HAND_TRACK_MAX_SIDE / max(h, w)
    if scale >= 1:
        return bgr
    return cv2.resize(bgr, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def extract_hand_track(video_bytes: bytes, filename: str | None = None) -> dict | None:
    suffix = (os.path.splitext(filename)[1] if filename else "") or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name
    frames = []
    cap = cv2.VideoCapture(tmp_path)
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if not np.isfinite(fps) or fps <= 1.0:
            fps = DEFAULT_SOURCE_FPS
        every = max(1, round(fps / HAND_TRACK_FPS))
        with _make_video_landmarker() as lm:
            i = 0
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                if i % every == 0:
                    t_ms = int(round(i * 1000 / fps))
                    small = _downscale(bgr)
                    h, w = small.shape[:2]
                    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
                    res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), t_ms)
                    hands = [[c for p in hand for c in (p.x, p.y, p.z)] for hand in res.hand_landmarks]
                    sel = select_hand(hands, w, h)
                    frames.append({"t_ms": t_ms,
                                   "hand": None if sel is None else [round(v, 5) for v in sel]})
                i += 1
    finally:
        cap.release()
        os.unlink(tmp_path)
    hits = [k for k, f in enumerate(frames) if f["hand"] is not None]
    if not hits:
        return None
    lo, hi = max(hits[0] - TRIM_PAD_FRAMES, 0), min(hits[-1] + TRIM_PAD_FRAMES, len(frames) - 1)
    return {"version": 1, "frames": frames[lo:hi + 1]}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_hand_track.py -v`
Expected: PASS (one real clip takes a few seconds).

- [ ] **Step 5: Write the cache tool**

```python
# sigla-ml/tools/extract_letter_tracks.py
"""Extract hand tracks for every local letter clip, for the offline experiment.

    venv/Scripts/python.exe tools/extract_letter_tracks.py --workers 4

Reads datasets/LETTERS(A-L), LETTERS(M-S), LETTERS(T-Z) (layout
<LETTER>/<signer>/<clip>), writes letter_tracks/<LETTER>/<signer>/<clip>.json.
Skips clips already done, so it can be stopped and resumed.
"""
import argparse
import glob
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ML_ROOT)
REPO = os.path.dirname(ML_ROOT)
DEFAULT_DIRS = [os.path.join(REPO, "datasets", d) for d in ("LETTERS(A-L)", "LETTERS(M-S)", "LETTERS(T-Z)")]


def _one(clip: str, out_path: str) -> tuple[str, str]:
    from app.services.extract import extract_hand_track
    with open(clip, "rb") as f:
        track = extract_hand_track(f.read(), os.path.basename(clip))
    if track is None:
        return clip, "no hand"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(track, f)
    return clip, "ok"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-dir", action="append", default=None)
    ap.add_argument("--out", default=os.path.join(ML_ROOT, "letter_tracks"))
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()
    jobs = []
    for d in args.dataset_dir or DEFAULT_DIRS:
        for clip in sorted(glob.glob(os.path.join(d, "*", "*", "*"))):
            if not clip.lower().endswith((".mov", ".mp4", ".avi", ".mkv")):
                continue
            letter, signer = clip.split(os.sep)[-3], clip.split(os.sep)[-2]
            out_path = os.path.join(args.out, letter, signer,
                                    os.path.splitext(os.path.basename(clip))[0] + ".json")
            if not os.path.exists(out_path):
                jobs.append((clip, out_path))
    print(f"{len(jobs)} clips to extract")
    failed = 0
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(_one, c, o) for c, o in jobs]
        for n, fut in enumerate(as_completed(futures), 1):
            clip, status = fut.result()
            if status != "ok":
                failed += 1
                print(f"  {status}: {clip}")
            if n % 25 == 0:
                print(f"  {n}/{len(jobs)}")
    print(f"done, {failed} without a hand")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Ignore the cache and run the tool in the background** (about 1-3 hours for ~1040 clips)

Add `sigla-ml/letter_tracks/` to the repo `.gitignore`, then:
Run: `cd sigla-ml && venv/Scripts/python.exe tools/extract_letter_tracks.py --workers 4`
Expected: ends with `done, N without a hand`, N small (< 2 % of clips). Check: `find letter_tracks -name '*.json' | wc -l` ≈ 1038.

- [ ] **Step 7: Commit**

```bash
git add sigla-ml/app/services/extract.py sigla-ml/tools/extract_letter_tracks.py sigla-ml/tests/test_hand_track.py .gitignore
git commit -m "feat(ml): one-hand letter track extraction and local track cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Leave-one-signer-out experiment — GO / NO-GO GATE

**Files:**
- Create: `sigla-ml/tools/letters_experiment.py`
- Output: `sigla-ml/letters_experiment.json` (committed, like the existing `cv_*.json`)

**Interfaces:**
- Consumes: `LetterSample`, `leave_one_signer_out` (Task 2); the cache (Task 3).

- [ ] **Step 1: Write the tool**

```python
# sigla-ml/tools/letters_experiment.py
"""Go/no-go for the letters redesign (spec "Go / no-go gate").

    venv/Scripts/python.exe tools/letters_experiment.py

Leave-one-signer-out on the local track cache, twice: on F, M, S, T, W (the
deployed LSTM's classes, held-out-signer accuracy 0.94 in models/1.9.0-letters)
and on every letter present.
"""
import argparse
import glob
import json
import os
import sys

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ML_ROOT)

from app.services.letters_train import LetterSample, leave_one_signer_out  # noqa: E402

BASELINE_LETTERS = ["F", "M", "S", "T", "W"]
BASELINE_ACCURACY = 0.94
GATE_ALL = 0.90
GATE_MIN_LETTER = 0.70


def load(root: str) -> list:
    out = []
    for path in sorted(glob.glob(os.path.join(root, "*", "*", "*.json"))):
        letter, signer = path.split(os.sep)[-3], path.split(os.sep)[-2]
        with open(path, encoding="utf-8") as f:
            out.append(LetterSample(letter, signer, json.load(f)["frames"]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracks", default=os.path.join(ML_ROOT, "letter_tracks"))
    ap.add_argument("--out", default=os.path.join(ML_ROOT, "letters_experiment.json"))
    args = ap.parse_args()
    samples = load(args.tracks)
    labels = sorted({s.label for s in samples})
    print(f"{len(samples)} clips, {len(labels)} letters, signers: "
          f"{sorted({s.group for s in samples})}")

    subset = leave_one_signer_out([s for s in samples if s.label in BASELINE_LETTERS], BASELINE_LETTERS)
    full = leave_one_signer_out(samples, labels)
    worst = min(full["report"]["per_letter"].items(), key=lambda kv: kv[1])
    gate = {
        "subset_mean": subset["mean_accuracy"], "subset_needed": BASELINE_ACCURACY,
        "all_mean": full["mean_accuracy"], "all_needed": GATE_ALL,
        "worst_letter": worst[0], "worst_recall": worst[1], "worst_needed": GATE_MIN_LETTER,
    }
    gate["pass"] = (subset["mean_accuracy"] >= BASELINE_ACCURACY
                    and full["mean_accuracy"] >= GATE_ALL and worst[1] >= GATE_MIN_LETTER)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"gate": gate, "subset": subset, "all": full}, f, indent=2)
    print(json.dumps(gate, indent=2))
    print(full["report"]["top_confusions"])
    print("GATE PASSED" if gate["pass"] else "GATE FAILED — stop and report, change nothing in production")
    return 0 if gate["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the experiment** (4 folds × 2 fits; expect tens of minutes)

Run: `cd sigla-ml && venv/Scripts/python.exe tools/letters_experiment.py`
Expected: prints the gate block, the top confusions, then `GATE PASSED` or `GATE FAILED`.

- [ ] **Step 3: Commit the result**

```bash
git add sigla-ml/tools/letters_experiment.py sigla-ml/letters_experiment.json
git commit -m "chore(ml): letters leave-one-signer-out experiment and result

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: STOP — report to the user and wait for a decision**

Report: the gate block, the per-fold accuracy, the weakest five letters and the top confusions. On **GATE FAILED**, propose next steps (more signers for the weak letters, hold-finding fixes visible in the confusions) and do not start Phase 1. On **GATE PASSED**, ask for the go-ahead before Phase 1: from here on, the work touches the deployed system.

---

# Phase 1 — ML service

### Task 5: Extraction endpoint, `model_kind`, and `train_letters`

**Files:**
- Modify: `sigla-ml/app/routers/model.py` (imports, `TrainRequest`, `train_model`, `extract_landmarks`)
- Modify: `sigla-ml/app/services/train.py` (signature of `train`, dispatch)
- Modify: `sigla-ml/app/utils/preprocessor.py` (`fetch_approved_samples`)
- Modify: `sigla-ml/app/services/letters_train.py` (add `samples_from_dataset`, `check_coverage`, `train_letters`)
- Test: `sigla-ml/tests/test_letters_route.py`, extend `sigla-ml/tests/test_letters_train.py`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces:
  - `POST /extract-landmarks?hand_track=true` → `{"type": "motion", "sequence": [...], "hand_track": {...}}`; without the query, the body is unchanged.
  - `TrainRequest.model_kind: Optional[str]`; `train(..., model_kind: str | None = None)`.
  - `fetch_approved_samples(hand_track: bool = False) -> dict` (adds `?hand_track=1`).
  - `samples_from_dataset(dataset: dict, word_labels: list[str] | None) -> list[LetterSample]`
  - `check_coverage(samples: list[LetterSample]) -> None` (raises `ValueError`)
  - `train_letters(version_number, model_id, word_labels, report_progress, fetch=None, upload=None) -> dict` returning the same keys `train()` returns (`version_number, model_id, total_classes, trained_labels, accuracy, selection_best_accuracy, selected_epoch, deployment_real_samples, deployment_fit_samples, accuracy_note, tflite_url, h5_url`).
  - Storage under `{version_number}/`: `sign_model_letters.tflite`, `labels_motion.json`, `selection_metrics.json`, `artifact_manifest.json`.

- [ ] **Step 1: Write the failing route test**

```python
# sigla-ml/tests/test_letters_route.py
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
        return {"accuracy": 1.0, "total_classes": 2, "tflite_url": "u", "h5_url": None, "trained_labels": ["A", "B"]}

    monkeypatch.setattr(model_router, "train", fake_train)
    r = TestClient(app).post("/train", json={"version_number": "9.9.9-letters", "model_id": 1,
                                             "word_labels": ["A", "B"], "model_kind": "letters"})
    assert r.status_code == 200
    assert seen["model_kind"] == "letters"
```

Check first that `app/main.py` exposes `app` and mounts this router at the root (`grep -n "include_router" sigla-ml/app/main.py`); if the router is mounted under a prefix, prepend it to the URLs above.

- [ ] **Step 2: Add the failing `train_letters` test** to `tests/test_letters_train.py`

```python
def _fake_dataset():
    ds = {}
    for label, kind, seed in (("A", "static", 1), ("B", "static", 2), ("J", "J", 3)):
        rows = []
        for g in ("s1", "s2", "s3", "s4"):
            for k in range(5):
                rows.append({"sequence": [[0.0] * 147] * 30, "sample_id": len(rows),
                             "session_id": g, "hand_track": {"version": 1, "frames": synth_track(seed, kind=kind)}})
        ds[label] = rows
    ds["HELLO"] = [{"sequence": [[0.0] * 147] * 30, "sample_id": 99, "session_id": "s1"}]
    return ds


def test_train_letters_end_to_end(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(LT, "STATIC_EPOCHS", 4)
    monkeypatch.setattr(LT, "MOTION_EPOCHS", 4)
    uploads = {}

    def upload(path_in_bucket, data, content_type):
        uploads[path_in_bucket] = data
        return f"https://store/{path_in_bucket}"

    progress = []
    out = LT.train_letters("9.9.9-letters", 7, ["A", "B", "J"],
                           lambda *a, **k: progress.append(a), fetch=lambda: _fake_dataset(), upload=upload)
    assert out["trained_labels"] == ["A", "B", "J"]
    assert out["total_classes"] == 3
    assert out["tflite_url"].endswith("9.9.9-letters/sign_model_letters.tflite")
    assert set(uploads) == {"9.9.9-letters/sign_model_letters.tflite", "9.9.9-letters/labels_motion.json",
                            "9.9.9-letters/selection_metrics.json", "9.9.9-letters/artifact_manifest.json"}
    import json
    assert json.loads(uploads["9.9.9-letters/labels_motion.json"]) == {"0": "A", "1": "B", "2": "J"}
    metrics = json.loads(uploads["9.9.9-letters/selection_metrics.json"])
    assert {"accuracy", "precision", "recall", "f1_score"} <= set(metrics)


def test_train_letters_refuses_thin_coverage():
    ds = _fake_dataset()
    ds["A"] = ds["A"][:3]
    with pytest.raises(ValueError, match="A"):
        LT.train_letters("x-letters", 1, ["A", "B", "J"], lambda *a, **k: None,
                         fetch=lambda: ds, upload=lambda *a: "u")
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_letters_route.py tests/test_letters_train.py -v`
Expected: route tests FAIL (`extract_hand_track` not an attribute of the router; `model_kind` not passed); `train_letters` tests FAIL with `AttributeError`.

- [ ] **Step 4: Change the router**

In `app/routers/model.py`, change the import line to
`from app.services.extract import extract_motion_landmarks, extract_hand_track`.

Add to `TrainRequest`:

```python
    # "letters" runs the one-hand letters pipeline (letters_train.py); None or
    # "words" is the LSTM. Older backends omit it, which keeps the old behaviour.
    model_kind:     Optional[str] = None
```

In `train_model`, add `model_kind=request.model_kind,` to the `run_in_threadpool(train, …)` keyword arguments.

Replace `extract_landmarks` with:

```python
@router.post("/extract-landmarks")
async def extract_landmarks(file: UploadFile = File(...), hand_track: bool = False):
    """
    Extract the 30x147 motion sequence from an uploaded video, and with
    ?hand_track=true also the one-hand letter track (letter words only — see
    docs-internal/specs/2026-10-11-letters-accuracy-design.md).
    """
    try:
        video_bytes = await file.read()
        sequence = await run_in_threadpool(
            extract_motion_landmarks, video_bytes, file.filename
        )
        if sequence is None:
            raise HTTPException(status_code=422, detail="No hands detected in video")
        body = {"type": "motion", "sequence": sequence}
        if hand_track:
            track = await run_in_threadpool(extract_hand_track, video_bytes, file.filename)
            if track is None:
                raise HTTPException(status_code=422, detail="No hands detected in video")
            body["hand_track"] = track
        return body
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Landmark extraction failed: {str(e)}")
```

- [ ] **Step 5: Dispatch in `train.py` and extend the fetch**

Change the signature to:

```python
def train(version_number: str, model_id: int,
          word_labels: list[str] | None = None,
          progress_callback=None,
          model_kind: str | None = None) -> dict:
```

Insert immediately before the line `report_progress("loading_data", 2, "Loading approved samples")`:

```python
    # Letters run their own pipeline: one hand, hold frames and J/Z movements,
    # two models in one .tflite (docs-internal/specs/2026-10-11-letters-accuracy-design.md).
    if model_kind == "letters":
        from app.services.letters_train import train_letters
        return train_letters(version_number, model_id, word_labels, report_progress)
```

In `preprocessor.py`, change `fetch_approved_samples` to take `hand_track: bool = False` and build the URL as:

```python
    url = f"{BACKEND_URL}/ml/dataset" + ("?hand_track=1" if hand_track else "")
```

- [ ] **Step 6: Add `train_letters` and its helpers** — append to `letters_train.py`:

```python
# ── production training (POST /train with model_kind "letters") ─────────────

def samples_from_dataset(dataset: dict, word_labels) -> list:
    """/api/ml/dataset?hand_track=1 rows -> LetterSamples. Rows without a hand
    track (clips imported before it existed) are skipped."""
    out = []
    for label, rows in dataset.items():
        if word_labels is not None and label not in word_labels:
            continue
        for r in rows:
            track = r.get("hand_track") or {}
            if not track.get("frames"):
                continue
            group = r.get("session_id") or f"__unknown_{r.get('sample_id')}"
            out.append(LetterSample(label, str(group), track["frames"]))
    return out


def check_coverage(samples: list) -> None:
    """Same bar as the words model (preprocessor.validate_training_coverage):
    enough clips per letter, from enough signers."""
    from app.utils.preprocessor import MIN_REAL_SAMPLES_PER_CLASS, MIN_SIGNERS_PER_CLASS
    by_label: dict = {}
    for s in samples:
        by_label.setdefault(s.label, []).append(s.group)
    problems = []
    for label, groups in sorted(by_label.items()):
        signers = {g for g in groups if not g.startswith("__unknown_")}
        if len(groups) < MIN_REAL_SAMPLES_PER_CLASS or len(signers) < MIN_SIGNERS_PER_CLASS:
            problems.append(f"{label}: {len(groups)} clips with a hand track from {len(signers)} signers "
                            f"(needs {MIN_REAL_SAMPLES_PER_CLASS} from {MIN_SIGNERS_PER_CLASS})")
    if problems:
        raise ValueError("Not enough letter data: " + "; ".join(problems))


def train_letters(version_number: str, model_id: int, word_labels, report_progress,
                  fetch=None, upload=None) -> dict:
    import json

    if fetch is None:
        from app.utils.preprocessor import fetch_approved_samples
        fetch = lambda: fetch_approved_samples(hand_track=True)  # noqa: E731
    if upload is None:
        from app.utils.supabase_client import BUCKET_MODELS, upload_file
        upload = lambda path, data, ctype: upload_file(BUCKET_MODELS, path, data, ctype)  # noqa: E731

    report_progress("loading_data", 2, "Loading approved letter samples")
    samples = samples_from_dataset(fetch(), word_labels)
    check_coverage(samples)
    labels = sorted({s.label for s in samples})
    if word_labels is not None:
        missing = sorted(set(word_labels) - set(labels))
        if missing:
            print(f"WARNING: no hand-track samples for {', '.join(missing)} — not in this model")
    if len(labels) < 2:
        raise ValueError("At least 2 letters with hand-track samples are required")

    report_progress("preparing_data", 8, "Finding holds and movements")
    data = build_dataset(samples, labels)

    groups = sorted(set(data.static.group.tolist()) | set(data.motion.group.tolist()))
    held = groups[SEED % len(groups)]
    val_s, val_m = data.static.group == held, data.motion.group == held
    report_progress("training_model", 15, "Choosing epochs on a held-out signer")
    s_model, m_model, s_ep, m_ep = fit_pair(data, ~val_s, ~val_m, val_s, val_m)
    t, p = predict_clips(data, s_model, m_model, val_s, val_m)
    report = letter_report(t, p)
    report.update({
        "is_generalization_estimate": False,
        "held_out_signer": held,
        "none_false_alarm": none_false_alarm(data, m_model, val_m),
        "evaluation_note": ("Clip accuracy on one held-out signer, used to choose epochs, before the "
                            "deployment models were refit on every signer. Run "
                            "tools/letters_experiment.py for leave-one-signer-out."),
    })

    report_progress("training_final_model", 55, "Training final letter models")
    everything_s = np.ones(len(data.static.y), bool)
    everything_m = np.ones(len(data.motion.y), bool)
    s_model, m_model, _, _ = fit_pair(data, everything_s, everything_m,
                                      static_epochs=s_ep, motion_epochs=max(m_ep, 1))

    report_progress("converting_model", 85, "Converting model")
    tflite = export_tflite(data, s_model, m_model)
    verify_tflite(tflite, data, s_model, m_model)

    version_dir = os.path.join("models", version_number)
    os.makedirs(version_dir, exist_ok=True)
    files = {
        "sign_model_letters.tflite": (tflite, "application/octet-stream"),
        "labels_motion.json": (json.dumps({str(i): l for i, l in enumerate(labels)}, indent=2).encode(),
                               "application/json"),
        "selection_metrics.json": (json.dumps(report, indent=2).encode(), "application/json"),
        "artifact_manifest.json": (json.dumps({
            "schema_version": 1, "kind": "letters-two-signature-v1",
            "signatures": {"static": [1, L.FLOATS], "motion": [1, L.MOTION_FRAMES, L.FLOATS]},
            "labels": labels, "motion_letters": [l for l in labels if l in L.MOTION_LETTERS],
            "hand": "raw image coords, x and z * width/height, largest 2D extent",
        }, indent=2).encode(), "application/json"),
    }
    report_progress("uploading_model", 92, "Uploading model files")
    urls = {}
    for name, (blob, ctype) in files.items():
        with open(os.path.join(version_dir, name), "wb") as f:
            f.write(blob)
        urls[name] = upload(f"{version_number}/{name}", blob, ctype)
    report_progress("completed", 100, "Training complete")

    return {
        "version_number": version_number,
        "model_id": model_id,
        "total_classes": len(labels),
        "trained_labels": labels,
        "accuracy": report["accuracy"],
        "selection_best_accuracy": report["accuracy"],
        "selected_epoch": s_ep,
        "deployment_real_samples": len(samples),
        "deployment_fit_samples": int(len(data.static.y) + len(data.motion.y)),
        "accuracy_note": "clip accuracy on a held-out signer used for epoch selection",
        "tflite_url": urls["sign_model_letters.tflite"],
        "h5_url": None,
    }
```

- [ ] **Step 7: Run the tests to verify they pass, then the whole ML suite**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_letters_route.py tests/test_letters_train.py -v`
Expected: all pass.
Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest`
Expected: no new failures compared with `main`.

- [ ] **Step 8: Commit**

```bash
git add sigla-ml/app sigla-ml/tests
git commit -m "feat(ml): hand_track extraction option and letters training pipeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Phase 2 — Backend

### Task 6: Store hand tracks, export them, and send `model_kind`

**Files:**
- Create: `sigla-backend/migrations/008_gesture_samples_hand_track.sql`
- Create: `sigla-backend/src/utils/mlDataset.js`
- Test: `sigla-backend/test/mlDataset.test.js`
- Modify: `sigla-backend/src/models/GestureSample.js`, `src/controllers/wordController.js` (`extractAndStoreSample`), `src/controllers/mlController.js` (`getApprovedDataset`), `src/controllers/modelController.js` (`runTraining`), `migrations/README.md`

**Interfaces:**
- Consumes: Task 5 endpoints.
- Produces: `datasetEntry(sample, withTrack) -> object` and `extractUrl(baseUrl, vocabulary) -> string` in `src/utils/mlDataset.js`; `GET /api/ml/dataset?hand_track=1`.

- [ ] **Step 1: Write the failing test**

```javascript
// sigla-backend/test/mlDataset.test.js
const test = require("node:test");
const assert = require("node:assert");
const { datasetEntry, extractUrl } = require("../src/utils/mlDataset");

const sample = {
  id: 5, sequence: [[0]], file_url: "f", submitted_by: 1, session_id: "signer-01",
  hand_track: { version: 1, frames: [] },
};

test("dataset entry omits hand_track unless asked", () => {
  assert.deepStrictEqual(Object.keys(datasetEntry(sample, false)).sort(),
    ["file_url", "sample_id", "sequence", "session_id", "submitted_by"]);
});

test("dataset entry includes hand_track when asked and present", () => {
  assert.deepStrictEqual(datasetEntry(sample, true).hand_track, { version: 1, frames: [] });
  assert.ok(!("hand_track" in datasetEntry({ ...sample, hand_track: null }, true)));
});

test("extract url asks for a hand track only for letters", () => {
  assert.strictEqual(extractUrl("http://ml", "letters"), "http://ml/extract-landmarks?hand_track=true");
  assert.strictEqual(extractUrl("http://ml", "words"), "http://ml/extract-landmarks");
  assert.strictEqual(extractUrl("http://ml", undefined), "http://ml/extract-landmarks");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sigla-backend && node --test test/mlDataset.test.js`
Expected: FAIL with `Cannot find module '../src/utils/mlDataset'`

- [ ] **Step 3: Implement the helpers**

```javascript
// sigla-backend/src/utils/mlDataset.js
// Pure helpers for the ML service contract, kept out of the controllers so they
// can be tested without a database. Letters design:
// docs-internal/specs/2026-10-11-letters-accuracy-design.md

// One /api/ml/dataset row. hand_track is large and only the letters pipeline
// reads it, so it is sent only when the caller asks (?hand_track=1).
function datasetEntry(sample, withTrack) {
  const entry = {
    sequence: sample.sequence,
    sample_id: sample.id,
    file_url: sample.file_url,
    submitted_by: sample.submitted_by,
    session_id: sample.session_id,
  };
  if (withTrack && sample.hand_track) entry.hand_track = sample.hand_track;
  return entry;
}

// Letter words also need the one-hand track; every other word does not.
function extractUrl(baseUrl, vocabulary) {
  return `${baseUrl}/extract-landmarks${vocabulary === "letters" ? "?hand_track=true" : ""}`;
}

module.exports = { datasetEntry, extractUrl };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sigla-backend && node --test test/mlDataset.test.js`
Expected: 3 passing.

- [ ] **Step 5: Migration, model and controllers**

```sql
-- sigla-backend/migrations/008_gesture_samples_hand_track.sql
-- One-hand letter track per clip (letter words only). NULL for words and for
-- letter clips imported before this column existed.
-- docs-internal/specs/2026-10-11-letters-accuracy-design.md
ALTER TABLE gesture_samples ADD COLUMN IF NOT EXISTS hand_track JSONB;
```

In `GestureSample.js`, add after the `sequence` attribute:

```javascript
    // Letter words only: {version, frames: [{t_ms, hand: [63] | null}]} from
    // /extract-landmarks?hand_track=true. Requires migration 008 — Sequelize
    // selects every declared column.
    hand_track: {
      type: DataTypes.JSON,
      allowNull: true,
    },
```

In `wordController.js`, add `const { extractUrl } = require("../utils/mlDataset");` with the other requires; in `extractAndStoreSample` replace the `axios.post(\`${ML_SERVICE_URL}/extract-landmarks\`, …` URL with `extractUrl(ML_SERVICE_URL, word.vocabulary)`, replace `const { sequence } = mlRes.data;` with `const { sequence, hand_track } = mlRes.data;`, and add `hand_track: hand_track ?? null,` to the `GestureSample.create({...})` object.

In `mlController.js`, add `const { datasetEntry } = require("../utils/mlDataset");`, add `const withTrack = req.query.hand_track === "1";` at the top of `getApprovedDataset`, and replace the `dataset[label].push({ ... })` object with `dataset[label].push(datasetEntry(sample, withTrack));` (keep the comment above it).

In `modelController.js` `runTraining`, add `model_kind: kind,` to the `/train` request body, next to `model_id`.

Add a row to `migrations/README.md`'s table:

```
| `008_gesture_samples_hand_track.sql` | no | Letter clips keep a one-hand track for the letters models |
```

- [ ] **Step 6: Run the backend suite**

Run: `cd sigla-backend && node --test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add sigla-backend
git commit -m "feat(backend): store letter hand tracks, export them, send model_kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Phase 3 — Mobile

### Task 7: Signing-hand selection and parity fixtures

**Files:**
- Create: `sigla-mobile/app/src/main/kotlin/com/example/sigla/LetterHand.kt`
- Modify: `HandLandmarkHelper.kt` (`LandmarkResult.rawHands`, `parseResult`)
- Create: `sigla-ml/tools/gen_letter_fixtures.py`
- Create (generated): `sigla-mobile/app/src/test/kotlin/com/example/sigla/LetterFixtures.kt`
- Test: `sigla-mobile/app/src/test/kotlin/com/example/sigla/LetterHandTest.kt`, `LetterParityTest.kt` (select part; segment part added in Task 8)

**Interfaces:**
- Consumes: `letters.select_hand`, `letters.MotionSegmenter`, `tests._letter_synth.synth_track` (Python side).
- Produces: `internal const val LETTER_POINTS = 21`, `LETTER_FLOATS = 63`; `internal object LetterHand { fun extent(p: FloatArray): Float; fun select(hands: List<FloatArray>, width: Int, height: Int): FloatArray? }`; `LandmarkResult.rawHands: List<FloatArray>` (63 raw floats per detected hand, detection order, default empty); `LetterFixtures.kt` with `LETTER_SELECT_CASES: List<LetterSelectCase>`, `LETTER_SEGMENT_TRACK: List<Pair<Long, FloatArray?>>`, `LETTER_SEGMENT_EXPECTED: List<Triple<Long, Long, Double>>` (startMs, endMs, sum of all 32×63 resampled values).

- [ ] **Step 1: Write the failing unit test**

```kotlin
// sigla-mobile/app/src/test/kotlin/com/example/sigla/LetterHandTest.kt
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LetterHandTest {
    private fun hand(cx: Float, cy: Float, spread: Float) = FloatArray(LETTER_FLOATS) { i ->
        val p = i / 3
        when (i % 3) {
            0 -> cx + if (p == 0) 0f else spread * (p % 5)
            1 -> cy + if (p == 0) 0f else spread * (p / 5)
            else -> 0.01f * p
        }
    }

    @Test
    fun selectPicksLargerHand() {
        val small = hand(0.3f, 0.5f, 0.01f)
        val big = hand(0.6f, 0.5f, 0.03f)
        val out = LetterHand.select(listOf(small, big), 640, 480)!!
        assertEquals(big[3] * 640f / 480f, out[3], 1e-6f)   // x scaled
        assertEquals(big[4], out[4], 1e-6f)                  // y unchanged
        assertEquals(big[5] * 640f / 480f, out[5], 1e-6f)   // z scaled
    }

    @Test
    fun selectNullWithoutHandsOrSize() {
        assertNull(LetterHand.select(emptyList(), 640, 480))
        assertNull(LetterHand.select(listOf(hand(0.5f, 0.5f, 0.02f)), 640, 0))
        assertNull(LetterHand.select(listOf(FloatArray(10)), 640, 480))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.LetterHandTest"`
Expected: FAIL to compile, `Unresolved reference: LetterHand`.

- [ ] **Step 3: Implement `LetterHand.kt`**

```kotlin
package com.example.sigla

import kotlin.math.hypot

// One-hand letter input. MUST match sigla-ml app/utils/letters.py
// (hand_extent / select_hand); LetterParityTest checks it against Python.
// Design: docs-internal/specs/2026-10-11-letters-accuracy-design.md
internal const val LETTER_POINTS = 21
internal const val LETTER_FLOATS = LETTER_POINTS * 3

internal object LetterHand {

    /** Largest 2D distance from the wrist (point 0) to any other point. */
    fun extent(p: FloatArray): Float {
        var max = 0f
        for (i in 1 until LETTER_POINTS) {
            max = maxOf(max, hypot(p[i * 3] - p[0], p[i * 3 + 1] - p[1]))
        }
        return max
    }

    /**
     * The signing hand from raw MediaPipe hands (63 floats each, x/y in 0..1 of
     * the image), with x and z multiplied by width / height so x and y share one
     * unit. The signing hand is the one with the largest extent after that
     * correction — the hand closest to the camera. Ties keep the earlier hand.
     */
    fun select(hands: List<FloatArray>, width: Int, height: Int): FloatArray? {
        if (hands.isEmpty() || width <= 0 || height <= 0) return null
        val sx = width.toFloat() / height
        var best: FloatArray? = null
        var bestExtent = -1f
        for (h in hands) {
            if (h.size != LETTER_FLOATS) continue
            val p = FloatArray(LETTER_FLOATS) { i -> if (i % 3 == 1) h[i] else h[i] * sx }
            val e = extent(p)
            if (e > bestExtent) {
                best = p
                bestExtent = e
            }
        }
        return best
    }
}
```

- [ ] **Step 4: Add `rawHands` to `LandmarkResult` and fill it in `parseResult`**

In `HandLandmarkHelper.kt`, add to `data class LandmarkResult` after `landmarks`:

```kotlin
    // Per detected hand: 63 raw floats (x, y, z per landmark, MediaPipe image
    // coordinates, detection order). Input to LetterHand.select for letters mode;
    // the normalised `features` stay the words model's input.
    val rawHands: List<FloatArray> = emptyList(),
```

In `parseResult`, declare `val rawHands = ArrayList<FloatArray>(numHands)` next to `drawData`; inside the per-hand loop, before `drawData.add(pts)`, add:

```kotlin
            val raw = FloatArray(63)
            for (j in lms.indices) {
                raw[j * 3] = lms[j].x(); raw[j * 3 + 1] = lms[j].y(); raw[j * 3 + 2] = lms[j].z()
            }
            rawHands.add(raw)
```

and pass `rawHands = rawHands,` in the returned `LandmarkResult(...)`.

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.LetterHandTest"`
Expected: PASS.

- [ ] **Step 6: Write the fixture generator**

```python
# sigla-ml/tools/gen_letter_fixtures.py
"""Writes sigla-mobile's LetterFixtures.kt from the Python reference
(app/utils/letters.py). LetterParityTest fails on any divergence: fix the
code, never regenerate to make it pass.

    venv/Scripts/python.exe tools/gen_letter_fixtures.py
"""
import os
import sys

import numpy as np

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ML_ROOT)

from app.utils import letters as L  # noqa: E402
from tests._letter_synth import synth_hand, synth_track  # noqa: E402

OUT = os.path.join(ML_ROOT, "..", "sigla-mobile", "app", "src", "test", "kotlin",
                   "com", "example", "sigla", "LetterFixtures.kt")


def farr(values) -> str:
    return "floatArrayOf(" + ", ".join(f"{float(v)!r}f" for v in values) + ")"


def main() -> None:
    cases = []
    for k, (w, h) in enumerate(((640, 480), (480, 640), (720, 1280))):
        a = synth_hand(10 + k, (0.4, 0.5, 0.0))
        b = (np.asarray(synth_hand(20 + k, (0.6, 0.5, 0.0))).reshape(21, 3))
        b[:, :2] = (b[:, :2] - b[0, :2]) * (1.5 if k != 1 else 0.5) + b[0, :2]
        hands = [a, b.reshape(-1).tolist()]
        hands32 = [np.asarray(x, dtype=np.float32).astype(float).tolist() for x in hands]
        exp = L.select_hand(hands32, w, h)
        cases.append((hands32, w, h, exp))

    track = synth_track(31)
    track32 = [(f["t_ms"], None if f["hand"] is None
                else np.asarray(f["hand"], dtype=np.float32).astype(float).tolist()) for f in track]
    seg = L.MotionSegmenter()
    expected = []
    for t, hand in track32:
        step = seg.on_frame(t, hand)
        if step.segment is not None:
            arr = L.segment_array(step.segment)
            expected.append((int(step.segment.start_ms), int(step.segment.end_ms), float(arr.astype(np.float64).sum())))

    lines = [
        "package com.example.sigla",
        "",
        "// GENERATED by sigla-ml/tools/gen_letter_fixtures.py — do not edit.",
        "",
        "internal class LetterSelectCase(val hands: List<FloatArray>, val width: Int, val height: Int, val expected: FloatArray?)",
        "",
        "internal val LETTER_SELECT_CASES: List<LetterSelectCase> = listOf(",
    ]
    for hands, w, h, exp in cases:
        lines.append(f"    LetterSelectCase(listOf({', '.join(farr(x) for x in hands)}), {w}, {h}, "
                     f"{farr(exp) if exp is not None else 'null'}),")
    lines += [")", "", "internal val LETTER_SEGMENT_TRACK: List<Pair<Long, FloatArray?>> = listOf("]
    for t, hand in track32:
        lines.append(f"    Pair({t}L, {farr(hand) if hand is not None else 'null'}),")
    lines += [")", "", "internal val LETTER_SEGMENT_EXPECTED: List<Triple<Long, Long, Double>> = listOf("]
    for s, e, total in expected:
        lines.append(f"    Triple({s}L, {e}L, {total!r}),")
    lines += [")", ""]
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"wrote {OUT}: {len(cases)} select cases, {len(expected)} segments")


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Generate the fixtures and write the select half of the parity test**

Run: `cd sigla-ml && venv/Scripts/python.exe tools/gen_letter_fixtures.py`
Expected: `wrote …LetterFixtures.kt: 3 select cases, 2 segments`

```kotlin
// sigla-mobile/app/src/test/kotlin/com/example/sigla/LetterParityTest.kt
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** LetterHand / LetterSegmenter must decide exactly as sigla-ml letters.py. */
class LetterParityTest {

    @Test
    fun selectMatchesPython() {
        for ((n, c) in LETTER_SELECT_CASES.withIndex()) {
            val got = LetterHand.select(c.hands, c.width, c.height)
            if (c.expected == null) { assertNull("case $n", got); continue }
            for (i in c.expected.indices) assertEquals("case $n [$i]", c.expected[i], got!![i], 1e-5f)
        }
    }
}
```

- [ ] **Step 8: Run the parity test**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.LetterParityTest"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add sigla-mobile/app/src sigla-ml/tools/gen_letter_fixtures.py
git commit -m "feat(mobile): signing-hand selection for letters with Python parity fixtures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Letter segmenter, stabilizer and engine (pure Kotlin)

**Files:**
- Create: `LetterSegmenter.kt`, `LetterStabilizer.kt`, `LetterEngine.kt`
- Test: `LetterSegmenterTest.kt`, `LetterStabilizerTest.kt`, `LetterEngineTest.kt`; extend `LetterParityTest.kt`; extend `sigla-ml/tests/test_mobile_parity_flags.py`

**Interfaces:**
- Consumes: `LetterHand.extent`, `LETTER_FLOATS` (Task 7).
- Produces:
  - Constants `LETTER_MOTION_FRAMES = 32`, `LETTER_START_SPEED = 1.0f`, `LETTER_STOP_SPEED = 0.5f`, `LETTER_STOP_HOLD_MS = 200L`, `LETTER_PAD_MS = 150L`, `LETTER_MIN_MS = 300L`, `LETTER_MAX_MS = 2500L`, `LETTER_MAX_MISSING = 0.25f`, `LETTER_MIN_CONFIDENCE = 0.70f`, `LETTER_WINDOW = 10`, `LETTER_VOTES = 8`, `LETTER_MOTION_MIN_CONFIDENCE = 0.70f`, `LETTER_REPLACE_WINDOW_MS = 1000L`, `LETTER_START_SHAPES: Map<String, Set<String>>`.
  - `internal class LetterSegmenter { class Segment(startMs: Long, endMs: Long, frames: Array<FloatArray>); data class Output(moving: Boolean, segment: Segment?); fun onFrame(tMs: Long, hand: FloatArray?): Output; fun reset(); companion fun resample(points: List<Pair<Long, FloatArray>>, fromMs: Long, toMs: Long, t: Int): Array<FloatArray> }`
  - `internal data class LetterGuess(label: String, confidence: Float)`, `internal data class LetterCommit(label: String, confidence: Float, isMotion: Boolean, replacesPrevious: Boolean)`
  - `internal class LetterStabilizer { fun onFrame(tMs: Long, guess: LetterGuess?, handPresent: Boolean, moving: Boolean, mayCommit: Boolean): LetterCommit?; fun onMotion(tMs: Long, segmentStartMs: Long, guess: LetterGuess?): LetterCommit?; fun progress(): Float; fun reset() }`
  - `internal interface LetterClassifier { val labels: List<String>; fun classifyStatic(hand: FloatArray): FloatArray /* size labels.size */; fun classifyMotion(frames: Array<FloatArray>): FloatArray /* size labels.size + 1, last = _none */ }`
  - `internal data class LetterStep(progress: Float, commit: LetterCommit?)`, `internal class LetterEngine(classifier: LetterClassifier, cooldownMs: Long) { fun onFrame(tMs: Long, hand: FloatArray?): LetterStep; fun reset() }`

- [ ] **Step 1: Write the failing tests**

```kotlin
// LetterStabilizerTest.kt
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LetterStabilizerTest {
    private fun feed(s: LetterStabilizer, label: String, frames: Int, from: Long = 0L, conf: Float = 0.9f): LetterCommit? {
        var out: LetterCommit? = null
        for (i in 0 until frames) {
            s.onFrame(from + i * 66L, LetterGuess(label, conf), handPresent = true, moving = false, mayCommit = true)
                ?.let { out = it }
        }
        return out
    }

    @Test
    fun commitsAfterEightAgreeingFrames() {
        val s = LetterStabilizer()
        assertNull(feed(s, "A", 7))
        val c = feed(s, "A", 1, from = 7 * 66L)!!
        assertEquals("A", c.label)
        assertTrue(!c.isMotion && !c.replacesPrevious)
    }

    @Test
    fun lowConfidenceFramesDoNotVote() {
        assertNull(feed(LetterStabilizer(), "A", 20, conf = 0.5f))
    }

    @Test
    fun holdingTheSameLetterCommitsOnce() {
        val s = LetterStabilizer()
        assertEquals("A", feed(s, "A", 8)!!.label)
        assertNull(feed(s, "A", 30, from = 1000L))
    }

    @Test
    fun handLeavingAllowsTheSameLetterAgain() {
        val s = LetterStabilizer()
        feed(s, "L", 8)
        s.onFrame(700L, null, handPresent = false, moving = false, mayCommit = true)
        assertEquals("L", feed(s, "L", 8, from = 800L)!!.label)
    }

    @Test
    fun movingClearsVotes() {
        val s = LetterStabilizer()
        feed(s, "A", 7)
        s.onFrame(500L, LetterGuess("A", 0.9f), handPresent = true, moving = true, mayCommit = true)
        assertNull(feed(s, "A", 7, from = 600L))
    }

    @Test
    fun jReplacesARecentI() {
        val s = LetterStabilizer()
        feed(s, "I", 8)                                   // committed at t = 462
        val j = s.onMotion(1400L, segmentStartMs = 900L, guess = LetterGuess("J", 0.9f))!!
        assertTrue(j.isMotion && j.replacesPrevious)
    }

    @Test
    fun motionBelowConfidenceIsIgnored() {
        assertNull(LetterStabilizer().onMotion(0L, 0L, LetterGuess("J", 0.5f)))
        assertNull(LetterStabilizer().onMotion(0L, 0L, null))
    }

    @Test
    fun resetClearsVotes() {
        val s = LetterStabilizer()
        feed(s, "A", 7)
        assertTrue(s.progress() > 0f)
        s.reset()
        assertEquals(0f, s.progress(), 0f)
        assertNull(feed(s, "A", 1, from = 1000L))
    }
}
```

```kotlin
// LetterSegmenterTest.kt
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class LetterSegmenterTest {
    private fun hand(x: Float, y: Float) = FloatArray(LETTER_FLOATS) { i ->
        val p = i / 3
        when (i % 3) { 0 -> x + 0.02f * (p % 5); 1 -> y + 0.02f * (p / 5); else -> 0f }
    }

    @Test
    fun movementThenStillnessMakesOneSegment() {
        val s = LetterSegmenter()
        var seg: LetterSegmenter.Segment? = null
        var t = 0L
        repeat(5) { s.onFrame(t, hand(0.5f, 0.5f)); t += 40 }
        repeat(15) { k -> s.onFrame(t, hand(0.5f + 0.02f * k, 0.5f)).segment?.let { seg = it }; t += 40 }
        repeat(10) { s.onFrame(t, hand(0.8f, 0.5f)).segment?.let { seg = it }; t += 40 }
        assertNotNull(seg)
        assertEquals(LETTER_MOTION_FRAMES, seg!!.frames.size)
    }

    @Test
    fun handLossEndsSegment() {
        val s = LetterSegmenter()
        var seg: LetterSegmenter.Segment? = null
        var t = 0L
        repeat(3) { s.onFrame(t, hand(0.5f, 0.5f)); t += 40 }
        repeat(12) { k -> s.onFrame(t, hand(0.5f + 0.02f * k, 0.5f)); t += 40 }
        repeat(8) { s.onFrame(t, null).segment?.let { seg = it }; t += 40 }
        assertNotNull(seg)
    }

    @Test
    fun tooShortMovementIsDropped() {
        // 20 ms frames: a 3-frame flick plus the 150 ms pad spans ~250 ms,
        // under LETTER_MIN_MS, so no segment is produced once it settles.
        val s = LetterSegmenter()
        var seg: LetterSegmenter.Segment? = null
        var t = 0L
        repeat(3) { s.onFrame(t, hand(0.5f, 0.5f)); t += 20 }
        repeat(2) { k -> s.onFrame(t, hand(0.55f + 0.05f * k, 0.5f)); t += 20 }
        repeat(20) { s.onFrame(t, hand(0.6f, 0.5f)).segment?.let { seg = it }; t += 20 }
        assertNull(seg)
    }
}
```

```kotlin
// LetterEngineTest.kt
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LetterEngineTest {
    /** Static: always "A" at 0.9. Motion: always "J" at 0.95. */
    private class Fake : LetterClassifier {
        override val labels = listOf("A", "I", "J")
        override fun classifyStatic(hand: FloatArray) = floatArrayOf(0.9f, 0.1f, 0f)
        override fun classifyMotion(frames: Array<FloatArray>) = floatArrayOf(0f, 0f, 0.95f, 0.05f)
    }

    private val still = FloatArray(LETTER_FLOATS) { i -> if (i % 3 == 2) 0f else 0.5f + 0.01f * (i / 3 % 5) }

    @Test
    fun heldHandCommitsOnceThenCoolsDown() {
        val e = LetterEngine(Fake(), cooldownMs = 2000L)
        val commits = (0 until 40).mapNotNull { e.onFrame(it * 66L, still).commit }
        assertEquals(listOf("A"), commits.map { it.label })
    }

    @Test
    fun progressFollowsVotes() {
        val e = LetterEngine(Fake(), cooldownMs = 0L)
        val p = (0 until 4).map { e.onFrame(it * 66L, still).progress }.last()
        assertEquals(4f / LETTER_VOTES, p, 1e-6f)
    }

    @Test
    fun resetDropsProgress() {
        val e = LetterEngine(Fake(), cooldownMs = 0L)
        repeat(5) { e.onFrame(it * 66L, still) }
        e.reset()
        assertEquals(0f, e.onFrame(1000L, null).progress, 0f)
    }

    @Test
    fun noHandNoCommit() {
        val e = LetterEngine(Fake(), cooldownMs = 0L)
        repeat(20) { assertNull(e.onFrame(it * 66L, null).commit) }
    }
}
```

Add to `LetterParityTest.kt`:

```kotlin
    @Test
    fun segmenterMatchesPython() {
        val s = LetterSegmenter()
        val got = ArrayList<Triple<Long, Long, Double>>()
        for ((t, hand) in LETTER_SEGMENT_TRACK) {
            s.onFrame(t, hand).segment?.let { seg ->
                var sum = 0.0
                for (f in seg.frames) for (v in f) sum += v
                got.add(Triple(seg.startMs, seg.endMs, sum))
            }
        }
        assertEquals(LETTER_SEGMENT_EXPECTED.size, got.size)
        for (i in got.indices) {
            assertEquals(LETTER_SEGMENT_EXPECTED[i].first, got[i].first)
            assertEquals(LETTER_SEGMENT_EXPECTED[i].second, got[i].second)
            assertEquals(LETTER_SEGMENT_EXPECTED[i].third, got[i].third, 1e-2)
        }
    }
```

Add to `sigla-ml/tests/test_mobile_parity_flags.py`:

```python
_LETTER_SEGMENTER = os.path.join(_MOBILE, "LetterSegmenter.kt")


def test_letter_segmenter_constants_match_training():
    from app.utils import letters as L
    src = _read(_LETTER_SEGMENTER)

    def num(name):
        return float(_kotlin_const(src, name).rstrip("L"))

    assert num("LETTER_MOTION_FRAMES") == L.MOTION_FRAMES
    assert num("LETTER_START_SPEED") == L.SEGMENT_CONFIG["start_speed"]
    assert num("LETTER_STOP_SPEED") == L.SEGMENT_CONFIG["stop_speed"]
    assert num("LETTER_STOP_HOLD_MS") == L.SEGMENT_CONFIG["stop_hold_ms"]
    assert num("LETTER_PAD_MS") == L.SEGMENT_CONFIG["pad_ms"]
    assert num("LETTER_MIN_MS") == L.SEGMENT_CONFIG["min_ms"]
    assert num("LETTER_MAX_MS") == L.SEGMENT_CONFIG["max_ms"]
    assert num("LETTER_MAX_MISSING") == L.SEGMENT_CONFIG["max_missing"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.Letter*"`
Expected: FAIL to compile (`Unresolved reference: LetterStabilizer`, `LetterSegmenter`, `LetterEngine`).

- [ ] **Step 3: Implement `LetterSegmenter.kt`**

```kotlin
package com.example.sigla

import kotlin.math.hypot

// MUST equal sigla-ml app/utils/letters.py SEGMENT_CONFIG / MOTION_FRAMES —
// test_mobile_parity_flags.py reads these lines; LetterParityTest replays a
// Python-recorded stream. Speeds are hand sizes per second.
internal const val LETTER_MOTION_FRAMES = 32
internal const val LETTER_START_SPEED = 1.0f
internal const val LETTER_STOP_SPEED = 0.5f
internal const val LETTER_STOP_HOLD_MS = 200L
internal const val LETTER_PAD_MS = 150L
internal const val LETTER_MIN_MS = 300L
internal const val LETTER_MAX_MS = 2500L
internal const val LETTER_MAX_MISSING = 0.25f

/** Finds hand movements in the live stream and resamples each to 32 frames. */
internal class LetterSegmenter {

    /** [startMs] is the movement start minus the pad; [frames] is 32 × 63. */
    class Segment(val startMs: Long, val endMs: Long, val frames: Array<FloatArray>)

    data class Output(val moving: Boolean, val segment: Segment?)

    private class Frame(val tMs: Long, val hand: FloatArray?)

    private val buffer = ArrayDeque<Frame>()
    private var prev: Frame? = null
    private val speeds = ArrayDeque<Float>()
    private var moving = false
    private var startMs = 0L
    private var belowSinceMs: Long? = null
    private var lastHandMs: Long? = null

    fun onFrame(tMs: Long, hand: FloatArray?): Output {
        val frame = Frame(tMs, hand)
        buffer.addLast(frame)
        while (tMs - buffer.first().tMs > LETTER_MAX_MS + LETTER_PAD_MS + LETTER_STOP_HOLD_MS) buffer.removeFirst()
        val smoothed = smoothedSpeed(frame)
        prev = frame
        if (hand != null) lastHandMs = tMs

        if (!moving) {
            if (smoothed != null && smoothed > LETTER_START_SPEED) {
                moving = true
                startMs = tMs
                belowSinceMs = null
            }
            return Output(moving, null)
        }

        val endMs: Long? = when {
            hand == null -> lastHandMs?.takeIf { tMs - it > LETTER_STOP_HOLD_MS }
            smoothed == null -> null
            smoothed < LETTER_STOP_SPEED -> {
                val since = belowSinceMs ?: tMs.also { belowSinceMs = it }
                since.takeIf { tMs - it >= LETTER_STOP_HOLD_MS }
            }
            else -> {
                belowSinceMs = null
                null
            }
        }
        if (endMs == null) return Output(true, null)
        moving = false
        belowSinceMs = null
        return Output(false, buildSegment(startMs - LETTER_PAD_MS, endMs))
    }

    fun reset() {
        buffer.clear()
        prev = null
        speeds.clear()
        moving = false
        belowSinceMs = null
        lastHandMs = null
    }

    private fun smoothedSpeed(frame: Frame): Float? {
        val cur = frame.hand
        if (cur == null) {
            speeds.clear()
            return null
        }
        val p = prev ?: return null
        val before = p.hand ?: return null
        val dtSec = (frame.tMs - p.tMs) / 1000f
        val size = LetterHand.extent(cur)
        if (dtSec <= 0f || size <= 0f) return null
        var moved = 0f
        for (i in 0 until LETTER_POINTS) moved += hypot(cur[i * 3] - before[i * 3], cur[i * 3 + 1] - before[i * 3 + 1])
        speeds.addLast(moved / LETTER_POINTS / size / dtSec)
        while (speeds.size > 3) speeds.removeFirst()
        return speeds.sum() / speeds.size
    }

    private fun buildSegment(fromMs: Long, toMs: Long): Segment? {
        val duration = toMs - fromMs
        if (duration < LETTER_MIN_MS || duration > LETTER_MAX_MS) return null
        val frames = buffer.filter { it.tMs in fromMs..toMs }
        if (frames.isEmpty()) return null
        val missing = frames.count { it.hand == null }.toFloat() / frames.size
        if (missing > LETTER_MAX_MISSING) return null
        val withHand = frames.mapNotNull { f -> f.hand?.let { f.tMs to it } }
        if (withHand.isEmpty()) return null
        return Segment(fromMs, toMs, resample(withHand, fromMs, toMs, LETTER_MOTION_FRAMES))
    }

    companion object {
        /** Linear interpolation at [t] evenly spaced times; clamps at the edges.
         *  MUST match letters.py resample. */
        fun resample(points: List<Pair<Long, FloatArray>>, fromMs: Long, toMs: Long, t: Int): Array<FloatArray> =
            Array(t) { k ->
                val tk = fromMs + k * (toMs - fromMs).toDouble() / (t - 1)
                when (val after = points.indexOfFirst { it.first >= tk }) {
                    -1 -> points.last().second.copyOf()
                    0 -> points.first().second.copyOf()
                    else -> {
                        val (ta, a) = points[after - 1]
                        val (tb, b) = points[after]
                        val w = if (tb == ta) 1f else ((tk - ta) / (tb - ta)).toFloat()
                        FloatArray(a.size) { i -> a[i] + (b[i] - a[i]) * w }
                    }
                }
            }
    }
}
```

- [ ] **Step 4: Implement `LetterStabilizer.kt`**

```kotlin
package com.example.sigla

// Turns per-frame letter guesses into committed letters. Ported from Senya's
// PredictionStabilizer, without spaces (SigLa shows one result at a time).
internal const val LETTER_MIN_CONFIDENCE = 0.70f
internal const val LETTER_WINDOW = 10
internal const val LETTER_VOTES = 8
internal const val LETTER_MOTION_MIN_CONFIDENCE = 0.70f
internal const val LETTER_REPLACE_WINDOW_MS = 1000L
/** Static letters a motion letter starts from: J is traced from I. */
internal val LETTER_START_SHAPES: Map<String, Set<String>> = mapOf("J" to setOf("I"), "Z" to emptySet())

internal data class LetterGuess(val label: String, val confidence: Float)

internal data class LetterCommit(
    val label: String,
    val confidence: Float,
    val isMotion: Boolean,
    /** The previous result was this letter's start shape (I before J): replace it. */
    val replacesPrevious: Boolean,
)

internal class LetterStabilizer {
    private val window = ArrayDeque<LetterGuess?>()
    /** Cannot commit again until another letter commits or the hand leaves. */
    private var lastStatic: String? = null
    /** Start shapes of the last motion letter, blocked the same way. */
    private var blocked: Set<String> = emptySet()
    private var last: Committed? = null

    private class Committed(val label: String, val atMs: Long, val isStatic: Boolean)

    fun onFrame(tMs: Long, guess: LetterGuess?, handPresent: Boolean, moving: Boolean, mayCommit: Boolean): LetterCommit? {
        if (!handPresent) {
            window.clear()
            lastStatic = null
            blocked = emptySet()
            return null
        }
        if (moving) {
            window.clear()
            return null
        }
        window.addLast(guess?.takeIf { it.confidence >= LETTER_MIN_CONFIDENCE })
        while (window.size > LETTER_WINDOW) window.removeFirst()
        if (!mayCommit) return null

        val (label, votes) = leader() ?: return null
        if (votes < LETTER_VOTES || label == lastStatic || label in blocked) return null
        val confidence = window.filterNotNull().filter { it.label == label }.map { it.confidence }.average().toFloat()
        window.clear()
        lastStatic = label
        blocked = emptySet()
        last = Committed(label, tMs, isStatic = true)
        return LetterCommit(label, confidence, isMotion = false, replacesPrevious = false)
    }

    fun onMotion(tMs: Long, segmentStartMs: Long, guess: LetterGuess?): LetterCommit? {
        if (guess == null || guess.confidence < LETTER_MOTION_MIN_CONFIDENCE) return null
        val shapes = LETTER_START_SHAPES[guess.label].orEmpty()
        val prev = last
        val replace = prev != null && prev.isStatic && prev.label in shapes &&
            prev.atMs >= segmentStartMs - LETTER_REPLACE_WINDOW_MS
        window.clear()
        lastStatic = null
        blocked = shapes
        last = Committed(guess.label, tMs, isStatic = false)
        return LetterCommit(guess.label, guess.confidence, isMotion = true, replacesPrevious = replace)
    }

    /** Agreeing votes for the current leader over [LETTER_VOTES], capped at 1. */
    fun progress(): Float {
        val votes = leader()?.second ?: return 0f
        return (votes.toFloat() / LETTER_VOTES).coerceAtMost(1f)
    }

    fun reset() {
        window.clear()
        lastStatic = null
        blocked = emptySet()
        last = null
    }

    private fun leader(): Pair<String, Int>? =
        window.filterNotNull().groupingBy { it.label }.eachCount().maxByOrNull { it.value }?.toPair()
}
```

- [ ] **Step 5: Implement `LetterEngine.kt`**

```kotlin
package com.example.sigla

/** The two letter models, behind an interface so the engine is testable on the JVM. */
internal interface LetterClassifier {
    val labels: List<String>
    /** Probabilities over [labels]; motion-only letters are 0. */
    fun classifyStatic(hand: FloatArray): FloatArray
    /** Probabilities over [labels] plus a final "_none" column. */
    fun classifyMotion(frames: Array<FloatArray>): FloatArray
}

internal data class LetterStep(val progress: Float, val commit: LetterCommit?)

/**
 * Letters mode, one frame at a time: hold voting for static letters, the
 * segmenter + motion model for J/Z. [cooldownMs] keeps the existing gap
 * between results; a motion letter replacing its start shape is exempt.
 * Not thread-safe — PredictionService calls it under its lock.
 */
internal class LetterEngine(private val classifier: LetterClassifier, private val cooldownMs: Long) {
    private val segmenter = LetterSegmenter()
    private val stabilizer = LetterStabilizer()
    private var lastCommitMs: Long? = null

    fun onFrame(tMs: Long, hand: FloatArray?): LetterStep {
        val seg = segmenter.onFrame(tMs, hand)
        var commit: LetterCommit? = null
        seg.segment?.let { s ->
            val c = stabilizer.onMotion(tMs, s.startMs, motionGuess(classifier.classifyMotion(s.frames)))
            if (c != null && (c.replacesPrevious || !coolingDown(tMs))) commit = c
        }
        val guess = hand?.let { staticGuess(classifier.classifyStatic(it)) }
        val held = stabilizer.onFrame(
            tMs, guess, handPresent = hand != null, moving = seg.moving,
            mayCommit = commit == null && !coolingDown(tMs),
        )
        if (commit == null) commit = held
        if (commit != null) lastCommitMs = tMs
        return LetterStep(stabilizer.progress(), commit)
    }

    fun reset() {
        segmenter.reset()
        stabilizer.reset()
        lastCommitMs = null
    }

    private fun coolingDown(tMs: Long): Boolean = lastCommitMs?.let { tMs - it < cooldownMs } ?: false

    private fun staticGuess(p: FloatArray): LetterGuess? {
        val n = classifier.labels.size
        if (p.size < n || n == 0) return null
        var best = 0
        for (i in 1 until n) if (p[i] > p[best]) best = i
        return LetterGuess(classifier.labels[best], p[best])
    }

    /** null when "_none" (the last column) wins. */
    private fun motionGuess(p: FloatArray): LetterGuess? {
        val n = classifier.labels.size
        if (p.size != n + 1) return null
        var best = 0
        for (i in 1..n) if (p[i] > p[best]) best = i
        return if (best == n) null else LetterGuess(classifier.labels[best], p[best])
    }
}
```

- [ ] **Step 6: Run all letter tests and the Python parity flags**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.Letter*"`
Expected: all pass.
Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_mobile_parity_flags.py -v`
Expected: all pass, including `test_letter_segmenter_constants_match_training`.

- [ ] **Step 7: Commit**

```bash
git add sigla-mobile/app/src sigla-ml/tests/test_mobile_parity_flags.py
git commit -m "feat(mobile): letter segmenter, hold stabilizer and engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Two-signature model loading and PredictionService routing

**Files:**
- Create: `sigla-mobile/app/src/main/kotlin/com/example/sigla/LetterTfliteClassifier.kt`
- Modify: `PredictionService.kt` (`PredictionResult`, `LoadedModel`, `loadVocabulary`, `processFrame`, `resetBuffers`, new `processLetterFrame`, `fireLetter`, `classifyLetterClip`, `usesLetterEngine`)
- Modify: `ClipPreparer.kt` (`RecordedFrame` gains `hand`)
- Test: extend `PredictionPolicyTest.kt`

**Interfaces:**
- Consumes: `LetterEngine`, `LetterClassifier`, `LetterCommit`, `LETTER_*` (Task 8).
- Produces:
  - `internal class LetterTfliteClassifier(interp: Interpreter, labels: List<String>) : LetterClassifier` with `companion { fun isLetterModel(interp: Interpreter): Boolean; fun validate(interp: Interpreter, labelCount: Int): String? }`
  - `PredictionResult.replacesPrevious: Boolean = false`
  - `PredictionService.processFrame(features: FloatArray, handsDetected: Int, letterHand: FloatArray? = null)`
  - `PredictionService.usesLetterEngine(): Boolean`
  - `PredictionService.classifyLetterClip(recording: List<RecordedFrame>): PredictionResult?`
  - `internal fun letterResult(c: LetterCommit): PredictionResult`
  - `class RecordedFrame(val timestampMs: Long, val features: FloatArray?, val hand: FloatArray? = null)`

- [ ] **Step 1: Write the failing policy test** (append to `PredictionPolicyTest.kt`)

```kotlin
    @Test
    fun letterCommitMapsToResult() {
        val r = letterResult(LetterCommit("J", 0.91f, isMotion = true, replacesPrevious = true))
        assertEquals("J", r.label)
        assertEquals(0.91f, r.confidence, 0f)
        assertTrue(r.isMotion)
        assertTrue(r.replacesPrevious)
        val s = letterResult(LetterCommit("A", 0.8f, isMotion = false, replacesPrevious = false))
        assertFalse(s.isMotion)
        assertFalse(s.replacesPrevious)
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.PredictionPolicyTest"`
Expected: FAIL to compile, `Unresolved reference: letterResult`.

- [ ] **Step 3: Implement `LetterTfliteClassifier.kt`**

```kotlin
package com.example.sigla

import org.tensorflow.lite.Interpreter

/**
 * The letters .tflite with two signatures (spec "Two letter models in one file"):
 *   static(landmarks[1,63])      -> probabilities[1,N]
 *   motion(frames[1,32,63])      -> probabilities[1,N+1]  (last = _none)
 * Reuses its buffers, so callers must serialise access (PredictionService's lock).
 */
internal class LetterTfliteClassifier(
    private val interp: Interpreter,
    override val labels: List<String>,
) : LetterClassifier {
    private val staticIn = arrayOf(FloatArray(LETTER_FLOATS))
    private val staticOut = arrayOf(FloatArray(labels.size))
    private val motionIn = arrayOf(Array(LETTER_MOTION_FRAMES) { FloatArray(LETTER_FLOATS) })
    private val motionOut = arrayOf(FloatArray(labels.size + 1))

    override fun classifyStatic(hand: FloatArray): FloatArray {
        hand.copyInto(staticIn[0])
        interp.runSignature(mapOf(IN_STATIC to staticIn), mapOf(OUT to staticOut), SIG_STATIC)
        return staticOut[0].copyOf()
    }

    override fun classifyMotion(frames: Array<FloatArray>): FloatArray {
        for (i in 0 until LETTER_MOTION_FRAMES) frames[i].copyInto(motionIn[0][i])
        interp.runSignature(mapOf(IN_MOTION to motionIn), mapOf(OUT to motionOut), SIG_MOTION)
        return motionOut[0].copyOf()
    }

    companion object {
        private const val SIG_STATIC = "static"
        private const val SIG_MOTION = "motion"
        private const val IN_STATIC = "landmarks"
        private const val IN_MOTION = "frames"
        private const val OUT = "probabilities"

        fun isLetterModel(interp: Interpreter): Boolean =
            interp.signatureKeys.toSet().containsAll(listOf(SIG_STATIC, SIG_MOTION))

        /** null when the file matches this build and [labelCount]; otherwise why not. */
        fun validate(interp: Interpreter, labelCount: Int): String? = try {
            val sIn = interp.getInputTensorFromSignature(IN_STATIC, SIG_STATIC).shape()
            val sOut = interp.getOutputTensorFromSignature(OUT, SIG_STATIC).shape()
            val mIn = interp.getInputTensorFromSignature(IN_MOTION, SIG_MOTION).shape()
            val mOut = interp.getOutputTensorFromSignature(OUT, SIG_MOTION).shape()
            when {
                !sIn.contentEquals(intArrayOf(1, LETTER_FLOATS)) -> "static input ${sIn.contentToString()}"
                !mIn.contentEquals(intArrayOf(1, LETTER_MOTION_FRAMES, LETTER_FLOATS)) -> "motion input ${mIn.contentToString()}"
                sOut.last() != labelCount -> "static output ${sOut.last()} != $labelCount labels"
                mOut.last() != labelCount + 1 -> "motion output ${mOut.last()} != ${labelCount + 1}"
                else -> null
            }
        } catch (e: Exception) {
            "signature check failed: ${e.message}"
        }
    }
}
```

- [ ] **Step 4: Change `PredictionService.kt`**

a) `PredictionResult` — add the field:

```kotlin
data class PredictionResult(
    val label: String,
    val confidence: Float,
    val isMotion: Boolean = true,
    val earlyExit: Boolean = false,
    // Letters: this J replaces the I just shown (it was J's start shape).
    val replacesPrevious: Boolean = false,
)

internal fun letterResult(c: LetterCommit): PredictionResult =
    PredictionResult(c.label, c.confidence, isMotion = c.isMotion, replacesPrevious = c.replacesPrevious)
```

b) `LoadedModel` — add `val letters: LetterTfliteClassifier? = null,` as the last constructor parameter.

c) `loadVocabulary` — insert immediately after the `if (labels == null) { … }` block, before the `outClasses` check:

```kotlin
        // The two-signature letters file (static hand shape + J/Z motion) runs
        // through LetterEngine instead of the LSTM. Any other letters file falls
        // through to the checks below unchanged.
        if (kind == "letters" && LetterTfliteClassifier.isLetterModel(interp)) {
            val problem = LetterTfliteClassifier.validate(interp, labels.size)
            if (problem != null) {
                Log.e(TAG, "Letters model rejected: $problem")
                interp.close()
                return null
            }
            return LoadedModel(interp, labels, arrayOf(FloatArray(labels.size)),
                letters = LetterTfliteClassifier(interp, labels))
        }
```

d) New fields next to `probabilityHistory`:

```kotlin
    // Letters mode with a two-signature model. Rebuilt when the classifier
    // changes (model update); only touched under [lock].
    private var letterEngine: LetterEngine? = null
    private var letterEngineFor: LetterTfliteClassifier? = null
    private var letterHandFrames = 0
```

e) `processFrame` — new signature `fun processFrame(features: FloatArray, handsDetected: Int, letterHand: FloatArray? = null)`. Inside `synchronized(lock)`, right after the `if (resetRequested) { … }` block, insert:

```kotlin
            // Letters mode with the two-signature model: hand shape + J/Z
            // engine instead of the words LSTM. No pose, motion-energy or
            // 36-frame gates — they describe moving words, not held letters.
            val letters = pinnedModel?.letters
            if (letters != null) {
                val step = processLetterFrame(letters, if (usable == 0) null else letterHand)
                notifyNoHands = step.first
                collectingState = step.second
                pending = step.third
                return@synchronized
            }
```

f) Add the private helpers (caller holds [lock]):

```kotlin
    /** Returns (notifyNoHands, collecting, pending). Caller must hold [lock]. */
    private fun processLetterFrame(
        classifier: LetterTfliteClassifier,
        hand: FloatArray?,
    ): Triple<Boolean, CollectingState?, PendingFire?> {
        val engine = letterEngine?.takeIf { letterEngineFor === classifier }
            ?: LetterEngine(classifier, DETECTION_COOLDOWN_MS).also {
                letterEngine = it
                letterEngineFor = classifier
            }
        val now = System.currentTimeMillis()
        val step = engine.onFrame(now, hand)
        val pending = step.commit?.let { c ->
            lastDetectionTime = now
            PendingFire(letterResult(c))
        }
        if (hand == null) {
            noHandFrames++
            letterHandFrames = 0
            return Triple(noHandFrames == NO_HAND_TIMEOUT, null, pending)
        }
        noHandFrames = 0
        letterHandFrames++
        return Triple(false, CollectingState(step.progress, letterHandFrames), pending)
    }
```

g) `resetBuffers` — add at the end: `letterEngine?.reset()` and `letterHandFrames = 0`.

h) Public helpers next to `classifyWindow`:

```kotlin
    /** True when letters mode will use the hand-shape engine (two-signature model). */
    fun usesLetterEngine(): Boolean =
        vocabulary == Vocabulary.LETTERS && lettersModel?.letters != null

    /**
     * Tap mode, letters: replays the recording through a fresh LetterEngine
     * (no cooldown) and returns the last letter it committed, or null.
     */
    fun classifyLetterClip(recording: List<RecordedFrame>): PredictionResult? {
        synchronized(lock) {
            if (!isReady || vocabulary != Vocabulary.LETTERS) return null
            val classifier = lettersModel?.letters ?: return null
            val engine = LetterEngine(classifier, cooldownMs = 0L)
            var last: LetterCommit? = null
            for (f in recording) engine.onFrame(f.timestampMs, f.hand).commit?.let { last = it }
            // Close a movement still open when recording stopped.
            val end = (recording.lastOrNull()?.timestampMs ?: 0L) + LETTER_STOP_HOLD_MS + 1
            engine.onFrame(end, null).commit?.let { last = it }
            return last?.let { letterResult(it).copy(replacesPrevious = false) }
        }
    }
```

- [ ] **Step 5: Extend `RecordedFrame`** in `ClipPreparer.kt`:

```kotlin
/** One camera frame captured during a tap recording. [features] is the
 * NORMALIZED 147-float vector when MediaPipe detected a hand, null otherwise.
 * [hand] is the letters engine's one-hand input (LetterHand.select), letters
 * mode only. */
class RecordedFrame(val timestampMs: Long, val features: FloatArray?, val hand: FloatArray? = null)
```

- [ ] **Step 6: Run the unit tests**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest`
Expected: all pass (existing tests untouched; `letterCommitMapsToResult` passes).

- [ ] **Step 7: Commit**

```bash
git add sigla-mobile/app/src
git commit -m "feat(mobile): load two-signature letters model and route letters mode to LetterEngine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Wire the camera, tap mode, history and pose switch

**Files:**
- Modify: `MainActivity.kt` (landmark sink, `processCapture`, `showResult`, `selectVocabulary`, model-swap block, `stopVision`)
- Modify: `TapSignSession.kt` (`onFrame`)
- Modify: `HandLandmarkHelper.kt` (`poseEnabled`)
- Modify: `TranslationHistoryManager.kt` (`replaceNewest`)
- Test: extend `TapSignSessionTest.kt`

**Interfaces:**
- Consumes: Task 7 `LetterHand.select`, `LandmarkResult.rawHands`; Task 9 `processFrame(…, letterHand)`, `usesLetterEngine()`, `classifyLetterClip()`, `PredictionResult.replacesPrevious`, `RecordedFrame.hand`.
- Produces: `TapSignSession.onFrame(features: FloatArray, handsDetected: Int, letterHand: FloatArray? = null)`; `HandLandmarkHelper.poseEnabled: Boolean`; `TranslationHistoryManager.replaceNewest(word: String, confidence: Int, gestureType: String)`.

- [ ] **Step 1: Write the failing tap test** (append to `TapSignSessionTest.kt`; reuse that file's existing clock and frame helpers — read its top first and use the same names)

```kotlin
    @Test
    fun recordedFramesCarryTheLetterHand() {
        var now = 0L
        val session = TapSignSession { now }
        session.tap()
        val hand = FloatArray(LETTER_FLOATS) { 0.5f }
        val features = FloatArray(147).also { f -> for (i in 0 until 63) f[i] = if (i % 3 == 2) 0f else 0.5f + 0.01f * (i / 3) }
        session.onFrame(features, 1, hand)
        var captured: TapSignSession.Event.Captured? = null
        repeat(10) { now += 66; session.onFrame(features, 1, hand) }
        repeat(TAP_STOP_AFTER_NO_HAND_FRAMES + 1) {
            now += 66
            (session.onFrame(FloatArray(147), 0, null) as? TapSignSession.Event.Captured)?.let { captured = it }
        }
        val frames = captured!!.frames
        assertTrue(frames.any { it.hand != null })
        assertArrayEquals(hand, frames.first { it.hand != null }.hand, 0f)
    }
```

(Add `import org.junit.Assert.assertArrayEquals` / `assertTrue` if the file lacks them. If `handExtentOk` rejects this synthetic `features`, copy a valid feature vector from an existing test in the same file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.TapSignSessionTest"`
Expected: FAIL to compile — `onFrame` takes 2 arguments.

- [ ] **Step 3: `TapSignSession.onFrame`** — change the signature to `fun onFrame(features: FloatArray, handsDetected: Int, letterHand: FloatArray? = null): Event?` and the frame line to:

```kotlin
        val frame = RecordedFrame(now, detected, if (detected != null) letterHand?.copyOf() else null)
```

- [ ] **Step 4: Run the tap tests**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.TapSignSessionTest"`
Expected: PASS.

- [ ] **Step 5: `HandLandmarkHelper.poseEnabled`** — add next to `lastPoseResult`:

```kotlin
    /**
     * Off in letters mode: the letter models read one hand only, so pose
     * detection is pure cost there. Turning it off drops the last pose so a
     * later switch back to words starts from the absent-pose sentinel.
     */
    @Volatile var poseEnabled: Boolean = true
        set(value) {
            field = value
            if (!value) lastPoseResult = null
        }
```

and in `detectAsync` change `if (poseFrameCounter >= POSE_DETECT_INTERVAL) {` to `if (poseFrameCounter >= POSE_DETECT_INTERVAL && poseEnabled) {`.

- [ ] **Step 6: `TranslationHistoryManager.replaceNewest`** — add after `add`:

```kotlin
    /**
     * Letters: J is traced from I, so the I shown a moment earlier was the start
     * of J, not a letter of its own. Swap the newest entry instead of adding one;
     * the translated counters already counted it once.
     */
    @Synchronized
    fun replaceNewest(word: String, confidence: Int, gestureType: String) {
        val list = getAll().toMutableList()
        if (list.isEmpty()) {
            add(word, confidence, gestureType)
            return
        }
        list[0] = TranslationEntry(word, confidence, gestureType)
        saveToPrefs(list)
    }
```

- [ ] **Step 7: `MainActivity` wiring**

a) In the landmark `sink`, replace the `if (tapMode) { … } else { … }` block with:

```kotlin
                    // Letters with the two-signature model read one raw hand,
                    // not the normalised 147-float frame.
                    val letterHand = if (result.handsDetected > 0 && predictor?.usesLetterEngine() == true) {
                        LetterHand.select(result.rawHands, result.sourceWidth, result.sourceHeight)
                    } else null
                    if (tapMode) {
                        tapSession.onFrame(features, result.handsDetected, letterHand)?.let { handleTapEvent(it) }
                    } else {
                        predictor?.processFrame(features, result.handsDetected, letterHand)
                    }
```

b) In `processCapture`, replace the two lines computing `outcome` and `result` with:

```kotlin
            val letters = predictor?.usesLetterEngine() == true
            val outcome = if (letters) null else ClipPreparer.prepare(event.frames)
            val result = if (letters) {
                predictor?.classifyLetterClip(event.frames)
            } else {
                (outcome as? ClipOutcome.Window)?.let { predictor?.classifyWindow(it.frames) }
            }
```

(The `when` below already falls through to `TAP_NOT_RECOGNIZED` when `outcome` is null and there is no result.)

c) In `showResult`, replace the history launch with:

```kotlin
        val replaces = result.replacesPrevious
        lifecycleScope.launch(Dispatchers.IO) {
            if (replaces) historyManager.replaceNewest(label, pct, gestureType)
            else historyManager.add(label, pct, gestureType)
        }
```

d) Add a helper and call it in three places:

```kotlin
    /** Pose only serves the words model; letters with the hand-shape engine skip it. */
    private fun syncPoseForVocabulary() {
        landmarker?.poseEnabled = predictor?.usesLetterEngine() != true
    }
```

- in `selectVocabulary`, after `updateVocabularyToggleLabel()`;
- in the model-swap block, after its `updateVocabularyToggleLabel()`;
- in `stopVision`, before the helper is released: `landmarker?.poseEnabled = true` (the cached helper is shared, so leave it in its default state).

- [ ] **Step 8: Build and run every unit test**

Run: `cd sigla-mobile && ./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add sigla-mobile/app/src
git commit -m "feat(mobile): feed letters engine from camera and tap mode, skip pose in letters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Phase 4 — Data, training and rollout

### Task 11: Re-import the letter clips with hand tracks and train a version

**Files:**
- Modify: `sigla-ml/scripts/_backend_import.py` (add `delete_all_samples`)
- Modify: `sigla-ml/scripts/import_alphabets.py` (`--dataset-dir`, `--replace`)
- Test: extend `sigla-ml/tests/test_backend_import.py`

**Interfaces:**
- Produces: `BackendImporter.delete_all_samples(client: httpx.Client, word_id: int, label: str) -> int` (rows deleted); `discover(letters, dirs: list[str])`.

- [ ] **Step 1: Write the failing test** (append to `tests/test_backend_import.py`; adjust the import line to match the file's existing one)

```python
def test_delete_all_samples_sends_confirmation():
    import httpx
    from _backend_import import BackendImporter

    seen = {}

    def handler(request):
        seen["method"] = request.method
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"deleted": 40})

    imp = BackendImporter("http://b/api", "tok", job_timeout_seconds=1, upload_timeout_seconds=1)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert imp.delete_all_samples(client, 12, "F") == 40
    assert seen["method"] == "DELETE"
    assert seen["url"] == "http://b/api/words/12/samples?confirm=F"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_backend_import.py -v`
Expected: FAIL with `AttributeError: 'BackendImporter' object has no attribute 'delete_all_samples'`

- [ ] **Step 3: Implement `delete_all_samples`** (read `_backend_import.py` first and use its existing base-URL attribute name in place of `self.backend_url` if it differs)

```python
    def delete_all_samples(self, client: httpx.Client, word_id: int, label: str) -> int:
        """DELETE /words/:id/samples. The backend demands confirm=<label>."""
        r = client.delete(f"{self.backend_url}/words/{word_id}/samples",
                          params={"confirm": label}, headers=self.headers)
        r.raise_for_status()
        return int(r.json().get("deleted", 0))
```

- [ ] **Step 4: Extend `import_alphabets.py`**

Change `discover` to take the directories:

```python
def discover(letters: list[str] | None, dirs: list[str]) -> dict[str, dict[str, list[str]]]:
    """{LETTER: {signer: [clip paths]}} across every directory in `dirs`."""
    out: dict[str, dict[str, list[str]]] = {}
    wanted = {l.upper() for l in letters} if letters else None
    for root in dirs:
        if not os.path.isdir(root):
            sys.exit(f"dataset folder not found: {root}")
        for letter in sorted(os.listdir(root)):
            lpath = os.path.join(root, letter)
            if not os.path.isdir(lpath) or (wanted is not None and letter.upper() not in wanted):
                continue
            for signer in sorted(os.listdir(lpath)):
                spath = os.path.join(lpath, signer)
                if not os.path.isdir(spath):
                    continue
                clips = [os.path.join(spath, f) for f in sorted(os.listdir(spath))
                         if f.lower().endswith((".mov", ".mp4", ".avi", ".mkv"))]
                if clips:
                    out.setdefault(letter, {}).setdefault(signer, []).extend(clips)
    return out
```

Add arguments:

```python
    ap.add_argument("--dataset-dir", action="append", default=None,
                    help="repeatable; default datasets/ALPHABETS")
    ap.add_argument("--replace", action="store_true",
                    help="delete each selected letter's existing samples first "
                         "(clips imported before hand tracks existed)")
```

call `found = discover(None if args.all else args.letters, args.dataset_dir or [DATASET_DIR])`, and, right after `word_id = IMPORTER.find_or_create_word(...)` and its print:

```python
            if args.replace:
                reply = input(f"  delete every existing {letter} sample? [y/N] ")
                if reply.strip().lower() == "y":
                    n = IMPORTER.delete_all_samples(client, word_id, letter)
                    print(f"  deleted {n} old samples")
```

- [ ] **Step 5: Run the importer tests**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_backend_import.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add sigla-ml/scripts sigla-ml/tests/test_backend_import.py
git commit -m "feat(ml): import letters from several folders and replace old samples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: STOP — confirm with the user before touching shared data**

The backend and the deployed app share one Supabase database. Ask for the go-ahead for, in order: running migration 008 on Supabase, deploying the backend (Hostinger) and the ML service, deleting the old F/M/S/T/W letter samples, and re-importing every letter. Do not continue without it.

- [ ] **Step 8: Run the migration, deploy backend and ML service**

Run: `psql "$PG_URI" -f sigla-backend/migrations/008_gesture_samples_hand_track.sql`
Then mark 008 applied in `migrations/README.md`, deploy the backend, restart the ML service from this branch.
Expected: `ALTER TABLE`; `GET /api/ml/dataset?hand_track=1` still answers (with the API key).

- [ ] **Step 9: Re-import the letters** (one batch per letter and signer; long)

Run: `cd sigla-ml && ADMIN_TOKEN=… BACKEND_URL=… venv/Scripts/python.exe scripts/import_alphabets.py --all --replace --dataset-dir "../datasets/LETTERS(A-L)" --dataset-dir "../datasets/LETTERS(M-S)" --dataset-dir "../datasets/LETTERS(T-Z)" --json letters_import.json`
Expected: every (letter, signer) batch ends `completed`; spot-check in SQL that letter rows have `hand_track IS NOT NULL` and word rows do not.

- [ ] **Step 10: Train a version in the admin panel — do not Deploy yet**

In *Manage Model* (it has no Test button; the accuracy shows in the version row), train a new version (words + letters as usual). When both finish, the version is "trained", not deployed.
Expected: the alphabet column shows 26 classes and the held-out-signer accuracy from `selection_metrics.json`. That figure is flattering (the same signer chose the epoch); the honest estimate is Task 4's 95.8%. Before Deploy, download the letters artifacts from storage and sideload them on the dev app (Task 12 step 4 procedure) to check them. Note the version number for Task 12.

---

### Task 12: Device verification, release and deploy

**Files:**
- Modify: `sigla-mobile/app/build.gradle.kts` (versionCode 9, versionName "1.9")
- Modify: `artifacts/device_tests/alphabet_readiness.md` (dated "superseded" note)

- [ ] **Step 1: Build the release APK** following the mobile release checklist (bump versionCode 8 → 9 and versionName "1.8" → "1.9", verify the signing cert, name it `SigLa.apk`).

- [ ] **Step 2: Regression check with the CURRENT deployed model** — install 1.9 on a test phone while the old version is still deployed.
Expected: Words mode behaves as in 1.8; Letters mode still loads the old LSTM letters model (legacy path) and recognises F/M/S/T/W as before.

- [ ] **Step 3: Deploy the version trained in Task 11** in *Manage Model*. On a phone still on **1.8** (if one is available): open the translator.
Expected: words work; the Letters chip is hidden (1.8 refuses the new file). This is the documented trade-off: old installs lose letters until they update.

- [ ] **Step 4: On 1.9, confirm the new model loads and runs**

Run: `adb logcat -s PredictionService:*` while opening the translator.
Expected: `alphabet loaded — 26 classes` and no `Letters model rejected` line. **Fallback** if loading or `runSignature` fails with an op-version error: change `org.tensorflow:tensorflow-lite` and `tensorflow-lite-select-tf-ops` to `2.16.1` in `app/build.gradle.kts`, rebuild, and repeat Step 2 (words regression) before continuing.

- [ ] **Step 5: Live and tap checks on 1.9** (no screen may look different from 1.8)

- Hold each letter A–Y (not J) still for about half a second, about 0.5 m from the camera, close enough that the shoulders are out of view: each shows once, and holding longer does not repeat it.
- Show L, drop the hand, show L again: shows twice.
- Sign I, then trace J: the card ends on J and History shows J, not I then J.
- Trace Z: shows Z.
- Raise and lower the hand without signing: nothing shows.
- A second hand resting in view while signing with the front hand: the front hand's letter shows.
- Switch Words ↔ Letters in the middle of holding a letter: nothing stale fires; words still work after switching back.
- Tap mode, Letters: tap, hold B: shows B; tap, trace J: shows J; tap and do nothing: "Not recognized — try again".

Note any letter that fails repeatedly; if it is a pair (e.g. M/N), it should match a top confusion from Task 4.

- [ ] **Step 6: Mark the old analysis superseded** — add at the top of `artifacts/device_tests/alphabet_readiness.md`:

```markdown
> **Superseded 2026-10-11** for letters mode: letters now use a one-hand
> hand-shape model and a J/Z motion model instead of the 30-frame LSTM — see
> docs-internal/specs/2026-10-11-letters-accuracy-design.md. The analysis below
> describes the LSTM approach and is kept as a record.
```

- [ ] **Step 7: Commit, publish the APK and update the latest link** per the release checklist

```bash
git add sigla-mobile/app/build.gradle.kts artifacts/device_tests/alphabet_readiness.md
git commit -m "chore(release): 1.9 (versionCode 9) — letters hand-shape recognition

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Rollback at any point after Step 3: *Manage Model* → **Revert** to the previous version (1.9 then falls back to the old letters model through the legacy path).
