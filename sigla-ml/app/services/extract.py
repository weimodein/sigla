import os
import tempfile
import numpy as np
import cv2

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from app.utils.preprocessor import (
    center_on_peak_velocity,
    frame_velocity,
    hand_extent_ok,
    normalize_frame,
    normalize_sequence,
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
)

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

# Fallback fps when a container does not report a usable rate.
DEFAULT_SOURCE_FPS = float(os.getenv("DEFAULT_SOURCE_FPS", 30.0))

# ── Signing-span trim ────────────────────────────────────────────────────────
#
# Clips are recorded as "stand still, sign, stand still". The idle head and tail
# are not part of the gesture and actively break extraction: they are long runs
# of hands-less frames, which MAX_MISSING_HAND_SECONDS (0.25s) rejects outright.
#
# This used to live ONLY in tools/import_fsl105.py, so the two import paths
# disagreed. Measured on class 4 / signer-01: the script (which trimmed first)
# accepted 10/10, while the admin UI's "Upload Dataset Clips" — which posts the
# raw file straight to /extract-landmarks — accepted 0/8, every rejection being
# "the signing hand left the frame for 0.54-1.59s". That is pure idle time.
# Trimming here means both paths run the same code and produce the same sequence.
#
# The trim is LOGICAL, not a re-encode: find the first and last frame carrying a
# hand, then restrict the sampling window below to that span. Physically writing
# a trimmed file (what import_fsl105 did) costs ~4-5s per clip in re-encoding and
# produces the same frames, since the sampling math is driven by a frame count
# and an offset either way.
TRIM_TO_SIGNING_SPAN = os.getenv("TRIM_TO_SIGNING_SPAN", "true").lower() == "true"

# Frames scanned across the clip to locate the signing span. Each one costs a
# hand detection, so this is the dominant cost of trimming.
#
# 30, not the 60 import_fsl105.py used. Measured per clip on this machine: scan
# 23-26s at 60 against a 33-38.5s total, versus the backend's 60s axios timeout
# for /extract-landmarks — around 21s of headroom, too thin. Halving the scan
# takes it to ~11s (total ~22s, headroom ~38s) while the detected span moves by
# only 1-7 frames out of the ~110-130 kept. At 20 or 12 the span drifts
# materially, so 30 is the floor rather than a free knob.
TRIM_SCAN_FRAMES = int(os.getenv("TRIM_SCAN_FRAMES", 30))

# Real frames of padding kept on each side of the detected span, so the start of
# the raise and the end of the lower — which carry gesture velocity — survive.
# Matches import_fsl105.TRIM_PAD_FRAMES, whose value this replaces.
TRIM_PAD_FRAMES = int(os.getenv("TRIM_PAD_FRAMES", 4))

# Feature layout — MUST match sigla-mobile (HandLandmarkHelper.kt):
# [0..125]   2 hands x 21 landmarks x (x,y,z), normalized per hand block.
# [126..146] 7 upper-body pose keypoints x (x,y,z), normalized as one block.
POSE_BASE = 126
# MediaPipe Pose indices kept, in order: nose, Lshoulder, Rshoulder, Lelbow,
# Relbow, Lwrist, Rwrist. MUST equal HandLandmarkHelper.kt POSE_KEYPOINTS.
_POSE_KEYPOINTS = [0, 11, 12, 13, 14, 15, 16]

# Path to the MediaPipe Tasks HandLandmarker model bundle. Override via env if needed.
_MODEL_PATH = os.getenv(
    "HAND_LANDMARKER_MODEL",
    os.path.join(os.path.dirname(__file__), "..", "models", "hand_landmarker.task"),
)
# Path to the MediaPipe Tasks PoseLandmarker model bundle (same bundle shipped
# on-device — see sigla-mobile/app/src/main/assets/pose_landmarker_lite.task).
_POSE_MODEL_PATH = os.getenv(
    "POSE_LANDMARKER_MODEL",
    os.path.join(os.path.dirname(__file__), "..", "models", "pose_landmarker_lite.task"),
)


def _make_landmarker() -> "vision.HandLandmarker":
    """
    Create an IMAGE-mode HandLandmarker (Tasks API). Detects up to 2 hands per
    frame — the same configuration the legacy mp.solutions.hands pipeline used.
    Caller is responsible for closing it (use as a context manager).
    """
    model_path = os.path.abspath(_MODEL_PATH)
    if not os.path.isfile(model_path):
        raise FileNotFoundError(
            f"HandLandmarker model not found: {model_path}\n"
            "Download hand_landmarker.task — see app/models/README.md"
        )
    options = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return vision.HandLandmarker.create_from_options(options)


def _make_pose_landmarker() -> "vision.PoseLandmarker":
    """
    Create an IMAGE-mode PoseLandmarker (Tasks API). Matches
    HandLandmarkHelper.buildPoseLandmarker: 1 pose, all confidences 0.5.
    Caller is responsible for closing it (use as a context manager).
    """
    model_path = os.path.abspath(_POSE_MODEL_PATH)
    if not os.path.isfile(model_path):
        raise FileNotFoundError(
            f"PoseLandmarker model not found: {model_path}\n"
            "Download pose_landmarker_lite.task — see app/models/README.md"
        )
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return vision.PoseLandmarker.create_from_options(options)


def _detect(landmarker, bgr_frame: np.ndarray):
    """Run detection on a BGR frame; returns the Tasks result (has .hand_landmarks)."""
    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    return landmarker.detect(mp_image)


def _detect_pose(pose_landmarker, bgr_frame: np.ndarray):
    """Run pose detection on a BGR frame; returns the Tasks result (has .pose_landmarks)."""
    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    return pose_landmarker.detect(mp_image)


def _build_feature_vector(hand_landmarks_list, pose_landmarks=None) -> list[float]:
    """
    Convert up to 2 hands worth of landmarks (+ optional pose) into a 147-float
    feature vector. Tasks API returns result.hand_landmarks: a list (per hand)
    of 21 landmark objects, each with .x/.y/.z — same coordinate layout as the
    legacy API. pose_landmarks is result.pose_landmarks[0] (33 landmarks) or
    None if pose wasn't detected — absent pose stays the 21-zero sentinel,
    matching HandLandmarkHelper.parseResult.
    """
    features = [0.0] * FEATURE_SIZE
    for hand_idx, hand_landmarks in enumerate(hand_landmarks_list[:2]):
        base = hand_idx * 63
        for j, lm in enumerate(hand_landmarks):
            features[base + j * 3]     = lm.x
            features[base + j * 3 + 1] = lm.y
            features[base + j * 3 + 2] = lm.z

    if pose_landmarks is not None:
        for k, kp in enumerate(_POSE_KEYPOINTS):
            if kp < len(pose_landmarks):
                lm = pose_landmarks[kp]
                features[POSE_BASE + k * 3]     = lm.x
                features[POSE_BASE + k * 3 + 1] = lm.y
                features[POSE_BASE + k * 3 + 2] = lm.z

    return features


def _find_signing_span(cap, total_frames: int, landmarker) -> tuple[int, int] | None:
    """
    First and last frame index carrying a detected hand, padded by
    TRIM_PAD_FRAMES on each side.

    Returns (start, end) inclusive, or None when no hand is found anywhere —
    the caller treats that as "no gesture in this clip" rather than trimming to
    nothing.

    Takes an already-open VideoCapture so the clip is not decoded twice; the
    caller's own sampling loop seeks the same handle afterwards.
    """
    idxs = np.linspace(0, total_frames - 1,
                       min(total_frames, TRIM_SCAN_FRAMES), dtype=int)
    hits = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, frame = cap.read()
        if not ok:
            continue
        if _detect(landmarker, frame).hand_landmarks:
            hits.append(int(i))
    if not hits:
        return None
    return (max(hits[0] - TRIM_PAD_FRAMES, 0),
            min(hits[-1] + TRIM_PAD_FRAMES, total_frames - 1))


def extract_motion_landmarks(video_bytes: bytes, filename: str | None = None) -> list[list[float]] | None:
    """
    Extract a 30-frame motion sequence from a video.
    Samples up to twice SEQUENCE_LENGTH evenly-spaced frames, then centers on peak velocity.
    Returns None if no hands detected.
    """
    # Preserve the real extension — on Windows, OpenCV's backend picks its
    # decoder based on the file suffix, so forcing an unrelated one (e.g. a
    # .mp4 upload saved as .mov) makes decoding silently fail.
    suffix = os.path.splitext(filename)[1] if filename else ".mp4"
    if not suffix:
        suffix = ".mp4"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    cap = cv2.VideoCapture(tmp_path)
    try:
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        # Source frame rate, for converting the sampled-frame gap into real time.
        # Containers occasionally report 0 or a nonsense value; fall back rather
        # than dividing by it.
        source_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if not np.isfinite(source_fps) or source_fps <= 1.0:
            source_fps = DEFAULT_SOURCE_FPS
        if total_frames < 1:
            return None

        # Trim to the signing span before anything else looks at the clip.
        #
        # `span_start` becomes the origin for every frame index computed below,
        # and `total_frames` the length of the span rather than of the file, so
        # the sampling maths downstream is unchanged — it just operates on the
        # gesture instead of on the gesture plus the idle head and tail. See
        # TRIM_TO_SIGNING_SPAN for why this has to happen here rather than in the
        # caller.
        span_start = 0
        if TRIM_TO_SIGNING_SPAN:
            with _make_landmarker() as trim_landmarker:
                span = _find_signing_span(cap, total_frames, trim_landmarker)
            if span is None:
                # No hand anywhere. Returning None (rather than raising) matches
                # what this function already does for an undecodable clip, and
                # the router turns it into a 422 "No hands detected in video".
                return None
            span_start, span_end = span
            total_frames = span_end - span_start + 1
            if total_frames < 1:
                return None

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
    finally:
        # Release the capture BEFORE unlinking — on Windows the file stays
        # locked until this happens, otherwise os.unlink raises WinError 32
        # and masks whatever actually went wrong above.
        cap.release()
        os.unlink(tmp_path)
