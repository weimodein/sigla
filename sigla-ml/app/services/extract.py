import os
import tempfile
import numpy as np
import mediapipe as mp
import cv2

from app.utils.preprocessor import center_on_peak_velocity, FEATURE_SIZE, SEQUENCE_LENGTH

_KEY_LANDMARKS = [0, 4, 8, 12, 16, 20]
_KEY_XY = [idx for i in _KEY_LANDMARKS for idx in (i * 3, i * 3 + 1)]

STATIC_FRAMES_PER_SAMPLE = 7  # mirrors CollectionActivity


def _build_feature_vector(multi_hand_landmarks) -> list[float]:
    """Convert up to 2 hands worth of landmarks into a 126-float feature vector."""
    features = [0.0] * FEATURE_SIZE
    for hand_idx, hand_landmarks in enumerate(multi_hand_landmarks[:2]):
        base = hand_idx * 63
        for j, lm in enumerate(hand_landmarks.landmark):
            features[base + j * 3]     = lm.x
            features[base + j * 3 + 1] = lm.y
            features[base + j * 3 + 2] = lm.z
    return features


def extract_static_landmarks(video_bytes: bytes) -> list[float] | None:
    """
    Extract a single 126-float landmark array from a video by sampling
    STATIC_FRAMES_PER_SAMPLE evenly-spaced frames and averaging them.
    Returns None if no hands detected.
    """
    mp_hands = mp.solutions.hands
    with tempfile.NamedTemporaryFile(suffix=".mov", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames < 1:
            return None

        # Pick evenly-spaced frame indices
        indices = np.linspace(0, total_frames - 1, STATIC_FRAMES_PER_SAMPLE, dtype=int)
        frame_features = []

        with mp_hands.Hands(
            static_image_mode=True,
            max_num_hands=2,
            min_detection_confidence=0.5,
        ) as hands:
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
                ret, frame = cap.read()
                if not ret:
                    continue
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = hands.process(rgb)
                if result.multi_hand_landmarks:
                    frame_features.append(_build_feature_vector(result.multi_hand_landmarks))

        cap.release()

        if not frame_features:
            return None

        averaged = np.mean(np.array(frame_features, dtype=np.float32), axis=0).tolist()
        return averaged
    finally:
        os.unlink(tmp_path)


def extract_image_landmarks(image_bytes: bytes) -> list[float] | None:
    """
    Extract a single 126-float landmark array from a still image.
    Returns None if no hands detected or image cannot be decoded.
    """
    mp_hands = mp.solutions.hands
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return None

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    with mp_hands.Hands(
        static_image_mode=True,
        max_num_hands=2,
        min_detection_confidence=0.5,
    ) as hands:
        result = hands.process(rgb)
        if not result.multi_hand_landmarks:
            return None
        return _build_feature_vector(result.multi_hand_landmarks)


def extract_motion_landmarks(video_bytes: bytes) -> list[list[float]] | None:
    """
    Extract a 30-frame motion sequence from a video.
    Samples up to SEQUENCE_LENGTH evenly-spaced frames, then centers on peak velocity.
    Returns None if no hands detected.
    """
    mp_hands = mp.solutions.hands
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

        with mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ) as hands:
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
                ret, frame = cap.read()
                if not ret:
                    continue
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = hands.process(rgb)
                if result.multi_hand_landmarks:
                    sequence.append(_build_feature_vector(result.multi_hand_landmarks))
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
