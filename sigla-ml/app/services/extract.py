import os
import tempfile
import numpy as np
import cv2

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from app.utils.preprocessor import center_on_peak_velocity, FEATURE_SIZE, SEQUENCE_LENGTH

_KEY_LANDMARKS = [0, 4, 8, 12, 16, 20]
_KEY_XY = [idx for i in _KEY_LANDMARKS for idx in (i * 3, i * 3 + 1)]

# Path to the MediaPipe Tasks HandLandmarker model bundle. Override via env if needed.
_MODEL_PATH = os.getenv(
    "HAND_LANDMARKER_MODEL",
    os.path.join(os.path.dirname(__file__), "..", "models", "hand_landmarker.task"),
)

# Path to the MediaPipe Tasks PoseLandmarker model bundle.
_POSE_MODEL_PATH = os.getenv(
    "POSE_LANDMARKER_MODEL",
    os.path.join(os.path.dirname(__file__), "..", "models", "pose_landmarker_lite.task"),
)

# Upper-body pose keypoints we keep (MediaPipe Pose indices): nose, shoulders,
# elbows, wrists. These give body context (hand-vs-body position, arm motion)
# that hand-only landmarks lack. 7 points × 3 = 21 floats appended after the 126
# hand floats → 147 total. MUST match the mobile pose feature order exactly.
_POSE_KEYPOINTS = [0, 11, 12, 13, 14, 15, 16]
_POSE_FLOATS = len(_POSE_KEYPOINTS) * 3  # 21


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
    """Create an IMAGE-mode PoseLandmarker (Tasks API), 1 pose per frame."""
    model_path = os.path.abspath(_POSE_MODEL_PATH)
    if not os.path.isfile(model_path):
        raise FileNotFoundError(
            f"PoseLandmarker model not found: {model_path}\n"
            "Download pose_landmarker_lite.task into app/models/."
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
    """Run pose detection on a BGR frame; returns the Tasks result (.pose_landmarks)."""
    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    return pose_landmarker.detect(mp_image)


def _build_feature_vector(hand_landmarks_list, pose_landmarks_list=None) -> list[float]:
    """
    Build the 147-float per-frame feature vector:
      [0..125]   = up to 2 hands × 21 landmarks × (x,y,z), MediaPipe order.
      [126..146] = 7 upper-body pose keypoints × (x,y,z), RAW coords.
    Raw pose is stored (like raw hands); normalization happens later in
    preprocessor/mobile identically. Absent hand/pose = zeros (sentinel).
    MUST match the mobile feature builder exactly.
    """
    features = [0.0] * FEATURE_SIZE
    for hand_idx, hand_landmarks in enumerate(hand_landmarks_list[:2]):
        base = hand_idx * 63
        for j, lm in enumerate(hand_landmarks):
            features[base + j * 3]     = lm.x
            features[base + j * 3 + 1] = lm.y
            features[base + j * 3 + 2] = lm.z

    # Pose block (raw). pose_landmarks_list is a list per detected pose; take the first.
    if pose_landmarks_list:
        pose = pose_landmarks_list[0]
        pbase = 126
        for k, kp in enumerate(_POSE_KEYPOINTS):
            if kp < len(pose):
                lm = pose[kp]
                features[pbase + k * 3]     = lm.x
                features[pbase + k * 3 + 1] = lm.y
                features[pbase + k * 3 + 2] = lm.z
    return features


def _safe_unlink(path: str, attempts: int = 10, delay: float = 0.1) -> None:
    """Delete a temp file, retrying briefly. On Windows a just-closed VideoCapture
    can leave the handle held for a few ms, so a single unlink may raise WinError 32."""
    import time
    for i in range(attempts):
        try:
            os.unlink(path)
            return
        except PermissionError:
            if i == attempts - 1:
                # Give up quietly — the temp dir is cleaned by the OS eventually.
                return
            time.sleep(delay)
        except FileNotFoundError:
            return


def extract_motion_landmarks(video_bytes: bytes) -> list[list[float]] | None:
    """
    Extract a 30-frame motion sequence from a video.
    Samples up to SEQUENCE_LENGTH evenly-spaced frames, then centers on peak velocity.
    Returns None if no hands detected.
    """
    with tempfile.NamedTemporaryFile(suffix=".mov", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    cap = None
    try:
        cap = cv2.VideoCapture(tmp_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames < 1:
            return None

        sample_count = min(total_frames, SEQUENCE_LENGTH * 2)
        indices = np.linspace(0, total_frames - 1, sample_count, dtype=int)
        sequence = []

        with _make_landmarker() as landmarker, _make_pose_landmarker() as pose_lm:
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
                ret, frame = cap.read()
                if not ret:
                    continue
                result = _detect(landmarker, frame)
                if result.hand_landmarks:
                    pose_result = _detect_pose(pose_lm, frame)
                    sequence.append(_build_feature_vector(
                        result.hand_landmarks, pose_result.pose_landmarks
                    ))
                elif sequence:
                    # Repeat last frame to fill gaps
                    sequence.append(sequence[-1])

        if len(sequence) < 4:
            return None

        seq_np = np.array(sequence, dtype=np.float32)
        seq_np = center_on_peak_velocity(seq_np)
        return seq_np.tolist()
    finally:
        # Release the capture BEFORE deleting the temp file — on Windows the file
        # stays locked while VideoCapture holds a handle, causing WinError 32.
        if cap is not None:
            cap.release()
        _safe_unlink(tmp_path)
