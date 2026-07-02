import os
import json
import numpy as np
import httpx
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    126))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))

# Backend API configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000/api")
ML_API_KEY  = os.getenv("ML_API_KEY")  # Must be set in .env

# Key landmark x,y indices for velocity (wrist + fingertips) — matches PredictionService KEY_XY
_KEY_LANDMARKS = [0, 4, 8, 12, 16, 20]
_KEY_XY = [idx for i in _KEY_LANDMARKS for idx in (i * 3, i * 3 + 1)]


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


def mirror_sequence(seq: np.ndarray) -> np.ndarray:
    """
    Horizontally mirror a motion sequence so a right-handed sign becomes its
    left-handed equivalent (and vice-versa). Flips x → 1 - x for every present
    landmark; y and z are unchanged.

    The 126-vector is 2 hands × 21 landmarks × 3 (x,y,z), x at index j*3.
    A missing hand is stored as 63 zeros — those MUST stay zero, so we only flip
    x for hand blocks that are actually present (non-zero), per frame.
    """
    out = seq.copy()
    n_frames = out.shape[0]
    for f in range(n_frames):
        for hand in range(2):
            base = hand * 63
            block = out[f, base:base + 63]
            # Skip zero-padded (absent) hands so 0 doesn't become 1.
            if not np.any(block):
                continue
            # Flip x of the 21 landmarks in this hand block.
            x_idx = [base + j * 3 for j in range(21)]
            out[f, x_idx] = 1.0 - out[f, x_idx]
    return out


def prepare_motion_dataset(dataset: dict):
    """
    Prepare dataset for motion gesture model (LSTM).
    Each sample is a sequence of SEQUENCE_LENGTH frames centered on peak velocity.
    Returns X (sequences), y (labels), label_map (index → label)
    """
    X      = []
    y      = []
    labels = sorted(dataset.keys())

    label_map = { i: label for i, label in enumerate(labels) }
    label_idx = { label: i for i, label in enumerate(labels) }

    for label, samples in dataset.items():
        sequences_for_label = []
        for sample in samples:
            sequence = sample.get("sequence", [])
            if not sequence:
                continue
            if len(sequence[0]) != FEATURE_SIZE:
                continue

            seq = np.array(sequence, dtype=np.float32)

            # Center on peak-velocity frame — mirrors PredictionService.extractMotionWindow()
            seq = center_on_peak_velocity(seq)

            sequences_for_label.append(seq)

        # Mirror-augment: add a horizontally-flipped copy of every real sequence so
        # the model learns both hand orientations (left- and right-handed signers).
        mirrored = [mirror_sequence(s) for s in sequences_for_label]
        sequences_for_label.extend(mirrored)

        # Noise/scale/temporal augmentation on top of the (now doubled) real+mirrored set.
        target = max(len(sequences_for_label) * 6, 150)
        augmented = augment_motion_sequences(
            [s.tolist() for s in sequences_for_label], target_count=target
        )
        sequences_for_label.extend([np.array(a, dtype=np.float32) for a in augmented])

        for sequence in sequences_for_label:
            X.append(sequence)
            y.append(label_idx[label])

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)

    print(f"Motion dataset — X: {X.shape}, y: {y.shape}, classes: {len(labels)}")
    return X, y, label_map


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
            # Per-frame Gaussian noise
            noise = rng.normal(0, 0.010, base.shape)
            result = np.clip(base + noise, 0.0, 1.0)
        else:
            # Random frame dropout — replace up to 4 frames with adjacent frame
            result = base.copy()
            n_drop = rng.integers(1, 5)
            drop_indices = rng.choice(SEQUENCE_LENGTH - 1, size=n_drop, replace=False)
            for idx in drop_indices:
                result[idx] = result[idx + 1]

        augmented.append(result.tolist())

    return augmented
