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


def _detect(landmarker, bgr_frame: np.ndarray):
    """Run detection on a BGR frame; returns the Tasks result (has .hand_landmarks)."""
    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    return landmarker.detect(mp_image)


def _build_feature_vector(hand_landmarks_list) -> list[float]:
    """
    Convert up to 2 hands worth of landmarks into a 126-float feature vector.
    Tasks API returns result.hand_landmarks: a list (per hand) of 21 landmark
    objects, each with .x/.y/.z — same coordinate layout as the legacy API.
    """
    features = [0.0] * FEATURE_SIZE
    for hand_idx, hand_landmarks in enumerate(hand_landmarks_list[:2]):
        base = hand_idx * 63
        for j, lm in enumerate(hand_landmarks):
            features[base + j * 3]     = lm.x
            features[base + j * 3 + 1] = lm.y
            features[base + j * 3 + 2] = lm.z
    return features


def extract_motion_landmarks(video_bytes: bytes) -> list[list[float]] | None:
    """
    Extract a 30-frame motion sequence from a video.
    Samples up to SEQUENCE_LENGTH evenly-spaced frames, then centers on peak velocity.
    Returns None if no hands detected.
    """
    with tempfile.NamedTemporaryFile(suffix=".mov", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames < 1:
            return None

        sample_count = min(total_frames, SEQUENCE_LENGTH * 2)
        indices = np.linspace(0, total_frames - 1, sample_count, dtype=int)
        sequence = []

        with _make_landmarker() as landmarker:
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
                ret, frame = cap.read()
                if not ret:
                    continue
                result = _detect(landmarker, frame)
                if result.hand_landmarks:
                    sequence.append(_build_feature_vector(result.hand_landmarks))
                elif sequence:
                    # Repeat last frame to fill gaps
                    sequence.append(sequence[-1])

        cap.release()

        if len(sequence) < 4:
            return None

        seq_np = np.array(sequence, dtype=np.float32)
        seq_np = center_on_peak_velocity(seq_np)
        return seq_np.tolist()
    finally:
        os.unlink(tmp_path)
