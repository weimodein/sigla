import os
import json
import numpy as np
import httpx
from sklearn.model_selection import train_test_split
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    147))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))

# Backend API configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000/api")
ML_API_KEY  = os.getenv("ML_API_KEY")  # Must be set in .env

# Key landmark x,y indices for velocity (wrist + fingertips) — matches PredictionService KEY_XY
_KEY_LANDMARKS = [0, 4, 8, 12, 16, 20]
_KEY_XY = [idx for i in _KEY_LANDMARKS for idx in (i * 3, i * 3 + 1)]

# Pose block layout — MUST match HandLandmarkHelper.kt (POSE_BASE / POSE_KEYPOINTS /
# POSE_LSHOULDER / POSE_RSHOULDER). [126..146] = 7 pose keypoints x (x,y,z).
_POSE_BASE      = 126
_POSE_LSHOULDER = 1  # local pose-block index (mediapipe landmark 11)
_POSE_RSHOULDER = 2  # local pose-block index (mediapipe landmark 12)


def fetch_approved_samples() -> dict:
    """
    Fetch all approved gesture samples from the backend API.
    Returns a dict: { label: [sample_array, ...] }
    """
    print("Fetching approved samples from backend API...")

    if not ML_API_KEY:
        raise ValueError("ML_API_KEY environment variable is not set")

    url = f"{BACKEND_URL}/ml/dataset"
    headers = {"X-API-Key": ML_API_KEY}

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url, headers=headers)
            response.raise_for_status()
            dataset = response.json()
    except httpx.HTTPStatusError as e:
        raise ValueError(f"Backend API returned error {e.response.status_code}: {e.response.text}")
    except httpx.RequestError as e:
        raise ValueError(f"Failed to connect to backend API: {e}")

    if not dataset:
        raise ValueError("No approved samples found in backend database.")

    total_classes = len(dataset)
    total_samples = sum(len(samples) for samples in dataset.values())
    print(f"Fetched {total_samples} samples across {total_classes} classes")
    return dataset


def normalize_frame(frame: np.ndarray) -> np.ndarray:
    """
    Make a 147-float frame position- and scale-invariant:
      1. Per hand (2 x 63): wrist-center (landmark 0), scale by 2D
         wrist→middle-finger-MCP (landmark 9) distance. Absent hand (63 zeros)
         is left untouched.
      2. Pose block (21): center on the shoulder midpoint, scale by the 2D
         L↔R shoulder distance. Absent pose (21 zeros) is left untouched.

    MUST stay identical to the mobile normalization in HandLandmarkHelper.kt
    (normalizeHandBlock / normalizePoseBlock).
    """
    out = frame.copy()
    for hand in range(2):
        base = hand * 63
        block = out[base:base + 63]
        if not np.any(block):
            continue  # absent hand — leave zeros
        wx, wy, wz = block[0], block[1], block[2]            # landmark 0 (wrist)
        mx, my     = block[9 * 3], block[9 * 3 + 1]          # landmark 9 (middle MCP)
        d = float(np.sqrt((mx - wx) ** 2 + (my - wy) ** 2))
        if d < 1e-6:
            d = 1e-6
        for j in range(21):
            out[base + j * 3]     = (block[j * 3]     - wx) / d
            out[base + j * 3 + 1] = (block[j * 3 + 1] - wy) / d
            out[base + j * 3 + 2] = (block[j * 3 + 2] - wz) / d

    pose_block = out[_POSE_BASE:_POSE_BASE + 21]
    if np.any(pose_block):
        lsx, lsy, lsz = pose_block[_POSE_LSHOULDER * 3], pose_block[_POSE_LSHOULDER * 3 + 1], pose_block[_POSE_LSHOULDER * 3 + 2]
        rsx, rsy, rsz = pose_block[_POSE_RSHOULDER * 3], pose_block[_POSE_RSHOULDER * 3 + 1], pose_block[_POSE_RSHOULDER * 3 + 2]
        cx, cy, cz = (lsx + rsx) / 2, (lsy + rsy) / 2, (lsz + rsz) / 2
        sw = float(np.sqrt((rsx - lsx) ** 2 + (rsy - lsy) ** 2))
        if sw < 1e-6:
            sw = 1e-6
        for k in range(7):
            out[_POSE_BASE + k * 3]     = (pose_block[k * 3]     - cx) / sw
            out[_POSE_BASE + k * 3 + 1] = (pose_block[k * 3 + 1] - cy) / sw
            out[_POSE_BASE + k * 3 + 2] = (pose_block[k * 3 + 2] - cz) / sw
    return out


def normalize_sequence(seq: np.ndarray) -> np.ndarray:
    """Apply normalize_frame to every frame of a (T, 126) sequence."""
    return np.array([normalize_frame(f) for f in seq], dtype=np.float32)


def center_on_peak_velocity(sequence: np.ndarray) -> np.ndarray:
    """
    Center a motion sequence on its peak-velocity frame.
    Mirrors PredictionService.extractMotionWindow() so training and inference
    see the same temporal alignment.
    """
    n = len(sequence)
    if n == SEQUENCE_LENGTH:
        return sequence

    # Find peak-velocity frame
    peak_idx = n // 2
    peak_vel = 0.0
    for i in range(1, n):
        diff = sequence[i][_KEY_XY] - sequence[i - 1][_KEY_XY]
        v = float(np.sqrt(np.sum(diff ** 2)))
        if v > peak_vel:
            peak_vel = v
            peak_idx = i

    half  = SEQUENCE_LENGTH // 2
    start = max(peak_idx - half, 0)
    end   = start + SEQUENCE_LENGTH
    if end > n:
        end   = n
        start = max(end - SEQUENCE_LENGTH, 0)

    window = list(sequence[start:end])
    while len(window) < SEQUENCE_LENGTH:
        window.append(window[-1])
    return np.array(window[:SEQUENCE_LENGTH], dtype=np.float32)


# Sign convention: cross_z < 0 => RIGHT. MUST equal Kotlin CHIRALITY_RIGHT_IS_NEGATIVE_CROSS.
_CHIRALITY_RIGHT_IS_NEGATIVE_CROSS = True


def _hand_cross_z(frame: np.ndarray, base: int) -> float:
    """2D cross-product z of (wrist->index-MCP)x(wrist->pinky-MCP) for one hand block.
    Landmarks 0=wrist, 5=index MCP, 17=pinky MCP. Byte-identical to Kotlin handCrossZ."""
    wx, wy = frame[base], frame[base + 1]
    v1x, v1y = frame[base + 5 * 3] - wx,  frame[base + 5 * 3 + 1] - wy
    v2x, v2y = frame[base + 17 * 3] - wx, frame[base + 17 * 3 + 1] - wy
    return float(v1x * v2y - v1y * v2x)


def _is_right_hand(cross_z: float) -> bool:
    return cross_z < 0 if _CHIRALITY_RIGHT_IS_NEGATIVE_CROSS else cross_z > 0


def canonicalize_slots(seq: np.ndarray) -> np.ndarray:
    """
    For two-handed sequences, reorder the two 63-float hand blocks so slot0 is always
    the RIGHT hand and slot1 always LEFT — matching Kotlin's canonicalizeSlots() exactly
    (one swap decision per sequence, taken from whichever frame has the two hands most
    spatially separated, since chirality is most reliable there). One-handed and
    no-hand sequences are returned unchanged. MUST match the mobile logic byte-for-byte
    or a live-canonicalized frame and a train-time-canonicalized frame would disagree.
    """
    best_sep = -1.0
    swap = False
    for frame in seq:
        slot0_present = bool(np.any(frame[0:63]))
        slot1_present = bool(np.any(frame[63:126]))
        if not (slot0_present and slot1_present):
            continue
        cz0 = _hand_cross_z(frame, 0)
        cz1 = _hand_cross_z(frame, 63)
        sep = abs(cz0) + abs(cz1)
        if sep > best_sep:
            best_sep = sep
            swap = (not _is_right_hand(cz0)) and _is_right_hand(cz1)

    if not swap:
        return seq
    out = seq.copy()
    out[:, 0:63], out[:, 63:126] = seq[:, 63:126].copy(), seq[:, 0:63].copy()
    return out


def _load_real_sequences(dataset: dict) -> dict:
    """
    Normalize + peak-center every stored real sequence, grouped by label. No
    augmentation — this is the actual recorded data, used as the basis for both the
    augmented training set and the untouched evaluation set below.
    """
    real = {}
    for label, samples in dataset.items():
        sequences = []
        for sample in samples:
            sequence = sample.get("sequence", [])
            if not sequence:
                continue
            if len(sequence[0]) != FEATURE_SIZE:
                continue

            seq = np.array(sequence, dtype=np.float32)

            # Position/scale-invariant normalization (per hand: wrist-center + hand-size
            # scale). Applied here so existing stored samples are normalized at train
            # time — no re-upload. MUST match mobile HandLandmarkHelper.parseResult.
            seq = normalize_sequence(seq)

            # Center on peak-velocity frame — mirrors PredictionService.extractMotionWindow()
            seq = center_on_peak_velocity(seq)

            # NOT calling canonicalize_slots() here on purpose — see
            # SLOT_CANONICALIZATION_ENABLED in MainActivity.kt. It fixed two-handed signs
            # (BREAD) but regressed one-handed ones (HELLO) via false-positive second-hand
            # detections, so both sides were reverted together. Keep this call disabled
            # unless MainActivity.kt's flag is re-enabled to match — a mismatch here is
            # exactly the bug that sank the FIRST attempt at this feature.

            sequences.append(seq)
        if sequences:
            real[label] = sequences
    return real


def prepare_motion_dataset(dataset: dict, test_size: float = 0.2, random_state: int = 42):
    """
    Prepare a motion dataset split BEFORE augmentation, so the evaluation split is
    always pure real (unaugmented) data. Augmenting first and splitting after (the
    previous approach) let noise/stretch/dropout copies of the same real clip land on
    both sides of the split — inflating both the training-time val_accuracy (which
    drives EarlyStopping/ReduceLROnPlateau) and test.py's reported accuracy, since
    neither was evaluating against genuinely unseen data.

    Returns (X_train, y_train, X_val, y_val, label_map). label_map (index -> label) is
    identical for both splits — computed once from every label present.
    """
    real   = _load_real_sequences(dataset)
    labels = sorted(real.keys())

    label_map = { i: label for i, label in enumerate(labels) }
    label_idx = { label: i for i, label in enumerate(labels) }

    X_train, y_train = [], []
    X_val,   y_val   = [], []

    for label in labels:
        sequences = real[label]
        idx = label_idx[label]

        if len(sequences) >= 2:
            train_seqs, val_seqs = train_test_split(
                sequences, test_size=test_size, random_state=random_state
            )
        else:
            # Too few real samples to hold any out — everything goes to training;
            # this class just won't have a data point in the evaluation split.
            train_seqs, val_seqs = sequences, []

        # Augment the TRAIN portion only — evaluation stays 100% real, unaugmented.
        # 25 sequences × 6 = 150 augmented + 25 real = 175 total
        target = max(len(train_seqs) * 6, 150)
        augmented = augment_motion_sequences(
            [s.tolist() for s in train_seqs], target_count=target
        )
        train_seqs_all = train_seqs + [np.array(a, dtype=np.float32) for a in augmented]

        X_train.extend(train_seqs_all)
        y_train.extend([idx] * len(train_seqs_all))
        X_val.extend(val_seqs)
        y_val.extend([idx] * len(val_seqs))

    X_train = np.array(X_train, dtype=np.float32)
    y_train = np.array(y_train, dtype=np.int32)
    X_val   = np.array(X_val,   dtype=np.float32)
    y_val   = np.array(y_val,   dtype=np.int32)

    print(f"Motion dataset — train: {X_train.shape}, val (real, unaugmented): {X_val.shape}, classes: {len(labels)}")
    return X_train, y_train, X_val, y_val, label_map


def save_label_map(label_map: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(label_map, f, indent=2)
    print(f"Label map saved to {path}")


def augment_motion_sequences(sequences: list, target_count: int = 100) -> list:
    """
    Augment motion sequences with temporal speed variation, noise, and frame jitter.
    """
    augmented = []
    if not sequences:
        return augmented

    rng = np.random.default_rng(42)
    needed = target_count - len(sequences)

    while len(augmented) < needed:
        base = np.array(sequences[rng.integers(len(sequences))], dtype=np.float32)

        aug_type = rng.integers(3)
        if aug_type == 0:
            # Temporal speed variation (±20%)
            stretch = rng.uniform(0.80, 1.20)
            new_len = int(SEQUENCE_LENGTH * stretch)
            indices = np.linspace(0, SEQUENCE_LENGTH - 1, new_len)
            stretched = np.array([
                np.interp(indices, np.arange(SEQUENCE_LENGTH), base[:, i])
                for i in range(base.shape[1])
            ]).T
            # Re-center on peak velocity after stretching
            result = center_on_peak_velocity(stretched)
        elif aug_type == 1:
            # Per-frame Gaussian noise. No [0,1] clip: coordinates are wrist-relative
            # after normalize_frame and legitimately fall outside [0,1].
            noise = rng.normal(0, 0.010, base.shape)
            result = base + noise
        else:
            # Random frame dropout — replace up to 4 frames with adjacent frame
            result = base.copy()
            n_drop = rng.integers(1, 5)
            drop_indices = rng.choice(SEQUENCE_LENGTH - 1, size=n_drop, replace=False)
            for idx in drop_indices:
                result[idx] = result[idx + 1]

        augmented.append(result.tolist())

    return augmented
