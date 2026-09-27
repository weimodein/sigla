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
MIN_DETECTED_HAND_FRAMES = int(os.getenv("MIN_DETECTED_HAND_FRAMES", 12))
MIN_HAND_COVERAGE = float(os.getenv("MIN_HAND_COVERAGE", 0.35))
MIN_POSE_COVERAGE = float(os.getenv("MIN_POSE_COVERAGE", 0.75))
MIN_SEQUENCE_MOTION = float(os.getenv("MIN_SEQUENCE_MOTION", 0.50))

# Longest tolerated run of consecutive hands-less frames once signing has started.
#
# MIN_HAND_COVERAGE bounds the TOTAL missing fraction but says nothing about how
# that loss is distributed: one 35-frame blackout and 35 single-frame flickers
# score identically, yet only the second is a recoverable recording. Live, a run
# this long trips NO_HAND_TIMEOUT (6 frames) and resets the buffer outright, so a
# clip containing one is not a gesture the phone could ever classify.
# MIN_SEQUENCE_MOTION does not catch it either — dropped frames contribute no
# velocity at all, so the surviving frames can carry the total over the line.
# Kept equal to PredictionService.NO_HAND_TIMEOUT on purpose.
# Expressed in SECONDS, not frames, because extraction SUBSAMPLES the clip.
#
# The phone's NO_HAND_TIMEOUT is 6 consecutive CAMERA frames at >=24fps — i.e.
# about a quarter-second of missing hand before the gesture is ended and the
# buffer reset. Extraction analyzes only `sample_budget` frames spread evenly
# across the whole video, so one *sampled* frame can span many real ones: on a
# 10s/60fps clip the stride is ~7x, making "6 sampled frames" 0.7s rather than
# 0.25s. Counting sampled frames therefore made this gate wildly stricter on
# short clips and looser on long ones — the same recording could pass or fail
# purely on its length. Convert to real time using the clip's own fps.
MAX_MISSING_HAND_SECONDS = float(os.getenv("MAX_MISSING_HAND_SECONDS", 0.25))

# Hard ceiling on frames analyzed per clip. The sampling budget scales with
# MIN_HAND_COVERAGE (see extract_motion_landmarks) so a low coverage floor stays
# reachable; this bounds the cost of that, since each analyzed frame runs a hand
# detection and, when hands are found, a pose detection too.
MAX_ANALYZED_FRAMES = int(os.getenv("MAX_ANALYZED_FRAMES", 120))

# Rate at which a source clip is sampled, in frames per second of real time.
#
# Set to the phone's MIN_ACCEPTABLE_FPS (MainActivity.kt), which is the floor the
# camera's AE range is pinned to, so one analyzed frame covers the same wall-clock
# span offline as it does live. Sampling a clip at a fixed COUNT instead made the
# effective rate depend on clip length (see extract_motion_landmarks), so the same
# sign trained at 17-38fps depending only on how long the take ran.
TARGET_SAMPLE_FPS = float(os.getenv("TARGET_SAMPLE_FPS", 24.0))

# Pose coverage over the STORED 30-frame window, as a fraction of that window.
#
# MIN_POSE_COVERAGE (above) uses detected_hand_frames as its denominator, which
# answers a different question than the phone asks. PredictionService's
# hasSufficientPoseCoverage requires MIN_POSE_FRAMES (24) of the 30-frame window
# to carry a pose block — a fraction of the WINDOW, not of the frames that
# happened to have hands. With hand coverage allowed down to 0.35 those two
# diverge sharply: a clip can clear "80% of hand frames" while the equivalent
# live window sits far below 24/30 and is refused outright. Training on windows
# the phone would reject is exactly the skew this closes. 24/30 = 0.80.
MIN_POSE_WINDOW_COVERAGE = float(os.getenv("MIN_POSE_WINDOW_COVERAGE", 24.0 / 30.0))


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
