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


def normalize_frame(frame: np.ndarray) -> np.ndarray:
    """
    Make a 126-float frame position- and scale-invariant, per present hand:
      1. Wrist-center: subtract landmark 0 (x,y,z) from all 21 landmarks.
      2. Scale: divide all by the 2D wrist→middle-finger-MCP (landmark 9) distance.
    An absent hand is 63 zeros and is left untouched (keeps the "no hand" sentinel).

    MUST stay identical to the mobile normalization in HandLandmarkHelper.parseResult.
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
    return out


def normalize_sequence(seq: np.ndarray) -> np.ndarray:
    """Apply normalize_frame to every frame of a (T, 126) sequence."""
    return np.array([normalize_frame(f) for f in seq], dtype=np.float32)


# ── Canonical hand-slot ordering (fixes two-handed sign accuracy) ─────────────
# Hands are packed by MediaPipe in arbitrary order; we reorder so the RIGHT hand
# is always slot 0 and the LEFT hand slot 1, using a pure-geometry chirality test
# (no MediaPipe label). This runs identically here and in the mobile app.
# Sign convention: cross_z < 0 ⇒ RIGHT. Verified on-device; flip if reversed.
_CHIRALITY_RIGHT_IS_NEGATIVE_CROSS = True


def _hand_cross_z(block: np.ndarray) -> float:
    """2D cross-product z of (wrist→index-MCP) × (wrist→pinky-MCP).
    Landmarks: 0=wrist, 5=index MCP, 17=pinky MCP. Uses x,y only.
    Sign distinguishes left vs right hand; invariant to wrist-center + positive scale.
    Returns 0.0 for an absent (all-zero) hand.
    """
    if not np.any(block):
        return 0.0
    wx, wy = block[0], block[1]
    v1x, v1y = block[5 * 3] - wx,  block[5 * 3 + 1] - wy
    v2x, v2y = block[17 * 3] - wx, block[17 * 3 + 1] - wy
    return float(v1x * v2y - v1y * v2x)


def _is_right_hand(cross_z: float) -> bool:
    """Map a cross_z value to right(True)/left(False) per the sign convention."""
    return (cross_z < 0) if _CHIRALITY_RIGHT_IS_NEGATIVE_CROSS else (cross_z > 0)


def canonicalize_slots(seq: np.ndarray):
    """
    Reorder the two 63-float hand blocks so RIGHT hand → slot 0, LEFT → slot 1,
    consistently across the whole sequence. One-handed sequences are left as-is
    (single hand stays in slot 0; absent hand stays 63 zeros).

    Decision is made ONCE per sequence (sum cross_z per slot over frames) to avoid
    per-frame flicker on ambiguous edge-on frames. MUST match mobile canonicalizeSlots.
    Assumes normalize_frame has already been applied (chirality is scale-invariant).

    Returns (seq, two_handed: bool, swapped: bool) so the caller can log how many
    sequences the canonicalization actually touched (proves the code path ran).
    """
    T = seq.shape[0]
    # Is this a two-handed sequence? (both slots present in at least one frame)
    slot0_present = np.any(seq[:, 0:63] != 0)
    slot1_present = np.any(seq[:, 63:126] != 0)
    if not (slot0_present and slot1_present):
        return seq, False, False  # one-handed (or empty): no reordering — zero regression

    # Sum chirality signal per slot over all frames, then decide.
    sum0 = float(np.sum([_hand_cross_z(seq[t, 0:63])   for t in range(T)]))
    sum1 = float(np.sum([_hand_cross_z(seq[t, 63:126]) for t in range(T)]))
    slot0_is_right = _is_right_hand(sum0)
    slot1_is_right = _is_right_hand(sum1)

    # Already canonical (slot0 right, slot1 left) → no-op. Swap only if slot0 is the
    # left hand and slot1 is the right hand (unambiguous case).
    if (not slot0_is_right) and slot1_is_right:
        swapped = seq.copy()
        swapped[:, 0:63]   = seq[:, 63:126]
        swapped[:, 63:126] = seq[:, 0:63]
        return swapped, True, True
    return seq, True, False


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

    n_two_handed = 0
    n_swapped    = 0
    for label, samples in dataset.items():
        sequences_for_label = []
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

            # Canonical hand-slot ordering (RIGHT→slot0, LEFT→slot1) via pure geometry,
            # so two-handed signs are consistent. Must run AFTER normalize (chirality is
            # scale-invariant) and match mobile canonicalizeSlots.
            seq, two_handed, was_swapped = canonicalize_slots(seq)
            if two_handed:
                n_two_handed += 1
            if was_swapped:
                n_swapped += 1

            # Center on peak-velocity frame — mirrors PredictionService.extractMotionWindow()
            seq = center_on_peak_velocity(seq)

            sequences_for_label.append(seq)

        # 25 sequences × 6 = 150 augmented + 25 real = 175 total
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

    print(
        f"[slot-canonicalization] two-handed sequences: {n_two_handed}, "
        f"swapped to canonical order: {n_swapped}"
    )
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
