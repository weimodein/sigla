import os
import tempfile
import numpy as np
import cv2

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from app.utils.preprocessor import (
    center_on_peak_velocity,
    normalize_sequence,
    normalize_frame,
    classify_motion_or_static,
    most_stable_frame,
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
)

_KEY_LANDMARKS = [0, 4, 8, 12, 16, 20]
_KEY_XY = [idx for i in _KEY_LANDMARKS for idx in (i * 3, i * 3 + 1)]

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


def extract_motion_landmarks(video_bytes: bytes, filename: str | None = None) -> dict | None:
    """
    Extract landmarks from a video clip and auto-classify the clip's own content
    as "static" or "motion" (see preprocessor.classify_motion_or_static) — a clip
    is not assumed to be motion just because it's a video. Returns None if no
    hands detected, otherwise one of:
      {"type": "static", "features": [FEATURE_SIZE floats]}      — a held pose
      {"type": "motion", "sequence": [[FEATURE_SIZE floats], ...]} — SEQUENCE_LENGTH frames
    Samples up to SEQUENCE_LENGTH*2 evenly-spaced frames from the source video.
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
        if total_frames < 1:
            return None

        sample_count = min(total_frames, SEQUENCE_LENGTH * 2)
        indices = np.linspace(0, total_frames - 1, sample_count, dtype=int)
        sequence = []

        with _make_landmarker() as landmarker, _make_pose_landmarker() as pose_landmarker:
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
                ret, frame = cap.read()
                if not ret:
                    continue
                result = _detect(landmarker, frame)
                if result.hand_landmarks:
                    # Pose is only detected on frames that have hands — matches
                    # HandLandmarkHelper.detect() (IMAGE-mode / offline extraction path).
                    pose_result = _detect_pose(pose_landmarker, frame)
                    pose_landmarks = (
                        pose_result.pose_landmarks[0]
                        if pose_result.pose_landmarks else None
                    )
                    sequence.append(_build_feature_vector(result.hand_landmarks, pose_landmarks))
                elif sequence:
                    # Repeat last frame to fill gaps
                    sequence.append(sequence[-1])

        if len(sequence) < 4:
            return None

        seq_np = np.array(sequence, dtype=np.float32)
        # Normalize BEFORE windowing, not after — matches the mobile pipeline
        # (HandLandmarkHelper normalizes each frame as it's captured, then
        # PredictionService/CollectionActivity window the normalized buffer).
        # Picking the peak-velocity window on raw image-space coordinates instead
        # measures whole-hand/arm translation across the frame, not just intra-hand
        # articulation, so it can select a different moment of the gesture than what
        # live inference's extractMotionWindow() would pick for the same clip.
        seq_np = normalize_sequence(seq_np)

        # Classify on the full normalized clip BEFORE windowing — windowing to
        # SEQUENCE_LENGTH first would measure only a slice's velocity, not
        # whether the clip as a whole ever really moves. Stored as a length-1
        # "sequence" (not a separate field) so gesture_samples needs no schema
        # change — static vs motion is re-derived from this array's own
        # length/velocity at train time, see preprocessor.classify_motion_or_static.
        if classify_motion_or_static(seq_np) == "static":
            return {"type": "static", "sequence": [most_stable_frame(seq_np).tolist()]}

        seq_np = center_on_peak_velocity(seq_np)
        return {"type": "motion", "sequence": seq_np.tolist()}
    finally:
        # Release the capture BEFORE unlinking — on Windows the file stays
        # locked until this happens, otherwise os.unlink raises WinError 32
        # and masks whatever actually went wrong above.
        cap.release()
        os.unlink(tmp_path)


def extract_static_landmarks(image_bytes: bytes) -> list[float] | None:
    """
    Extract a single-frame FEATURE_SIZE landmark vector from a still image —
    always "static" by definition (a single frame has no velocity to measure).
    Returns None if no hands detected.
    """
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return None

    with _make_landmarker() as landmarker, _make_pose_landmarker() as pose_landmarker:
        result = _detect(landmarker, frame)
        if not result.hand_landmarks:
            return None
        pose_result = _detect_pose(pose_landmarker, frame)
        pose_landmarks = pose_result.pose_landmarks[0] if pose_result.pose_landmarks else None
        features = _build_feature_vector(result.hand_landmarks, pose_landmarks)

    return normalize_frame(np.array(features, dtype=np.float32)).tolist()
