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
