import os
import json
import numpy as np
import httpx
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    147))  # 126 hand + 21 pose
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))

# Pose block layout (must match extract.py and mobile): 7 upper-body keypoints
# (nose, L/R shoulder, L/R elbow, L/R wrist) × 3 = 21 floats at offset 126.
POSE_BASE   = 126
POSE_POINTS = 7
# Local indices within the pose block for shoulders (used for normalization):
# keypoints order = [nose, Lshoulder, Rshoulder, Lelbow, Relbow, Lwrist, Rwrist].
_POSE_LSHOULDER = 1
_POSE_RSHOULDER = 2

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
    Make a 147-float frame position- and scale-invariant.

    Hands (per present hand, slots 0/1):
      1. Wrist-center: subtract landmark 0 (x,y,z) from all 21 landmarks.
      2. Scale: divide all by the 2D wrist→middle-finger-MCP (landmark 9) distance.
    Pose block (offset 126, 7 keypoints):
      1. Center: subtract the shoulder-midpoint (x,y,z) from all 7 keypoints.
      2. Scale: divide all by the 2D shoulder width (L↔R shoulder distance).
    Absent hand (63 zeros) or absent pose (21 zeros) are left untouched (sentinels).

    MUST stay byte-identical to the mobile normalization.
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

    # Pose block — center on shoulder-midpoint, scale by shoulder width.
    pblock = out[POSE_BASE:POSE_BASE + POSE_POINTS * 3]
    if np.any(pblock):
        lsx, lsy, lsz = pblock[_POSE_LSHOULDER * 3], pblock[_POSE_LSHOULDER * 3 + 1], pblock[_POSE_LSHOULDER * 3 + 2]
        rsx, rsy, rsz = pblock[_POSE_RSHOULDER * 3], pblock[_POSE_RSHOULDER * 3 + 1], pblock[_POSE_RSHOULDER * 3 + 2]
        cx, cy, cz = (lsx + rsx) / 2.0, (lsy + rsy) / 2.0, (lsz + rsz) / 2.0
        sw = float(np.sqrt((rsx - lsx) ** 2 + (rsy - lsy) ** 2))  # 2D shoulder width
        if sw < 1e-6:
            sw = 1e-6
        for k in range(POSE_POINTS):
            out[POSE_BASE + k * 3]     = (pblock[k * 3]     - cx) / sw
            out[POSE_BASE + k * 3 + 1] = (pblock[k * 3 + 1] - cy) / sw
            out[POSE_BASE + k * 3 + 2] = (pblock[k * 3 + 2] - cz) / sw
    return out


def normalize_sequence(seq: np.ndarray) -> np.ndarray:
    """Apply normalize_frame to every frame of a (T, FEATURE_SIZE) sequence."""
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

    Decision is made ONCE per sequence, from the SINGLE most hands-apart frame —
    the frame maximizing |cross_z(slot0)| + |cross_z(slot1)|. Summing cross_z over
    all frames (the old approach) let ambiguous edge-on / hands-together frames
    (e.g. "thank you") drag the sign near zero and flip the decision, scrambling
    two-handed features. The most-separated frame is where chirality is most
    reliable, so we trust only that frame. MUST match mobile canonicalizeSlots.
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

    # Find the frame where the two hands are most clearly distinguishable — the one
    # with the largest combined chirality magnitude — and decide the swap from it.
    best_sep = -1.0
    best_cz0 = 0.0
    best_cz1 = 0.0
    for t in range(T):
        cz0 = _hand_cross_z(seq[t, 0:63])
        cz1 = _hand_cross_z(seq[t, 63:126])
        sep = abs(cz0) + abs(cz1)
        if sep > best_sep:
            best_sep = sep
            best_cz0 = cz0
            best_cz1 = cz1

    slot0_is_right = _is_right_hand(best_cz0)
    slot1_is_right = _is_right_hand(best_cz1)

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

            # Canonical hand-slot ordering DISABLED — the geometry-based swap never
            # recovered two-handed signs (THANK YOU stayed 0/5) and traded wins for
            # losses, so hands stay in MediaPipe's original slot order. Kept off to
            # match the mobile app (SLOT_CANONICALIZATION_ENABLED=false); both sides
            # MUST agree. canonicalize_slots() remains defined for reference.

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

    print(f"Motion dataset — X: {X.shape}, y: {y.shape}, classes: {len(labels)}")
    return X, y, label_map


def _preprocess_sample(sample: dict):
    """Turn one stored sample into a processed (SEQUENCE_LENGTH, 126) array, or None."""
    sequence = sample.get("sequence", [])
    if not sequence:
        return None
    if len(sequence[0]) != FEATURE_SIZE:
        return None
    seq = np.array(sequence, dtype=np.float32)
    seq = normalize_sequence(seq)              # wrist-center + scale (matches mobile)
    seq = center_on_peak_velocity(seq)         # temporal alignment (matches inference)
    return seq


def prepare_motion_dataset_split(dataset: dict, test_size: float = 0.2, seed: int = 42):
    """
    Build an HONEST train/test split for motion data.

    The critical difference from prepare_motion_dataset: the real clips are split
    into train/test FIRST, and augmentation is applied to the TRAIN clips ONLY.
    The test set is real, held-out clips that were never augmented and never seen
    in training — so test accuracy reflects real generalization, not memorized
    augmented copies of the training clips (which is why the old combined split
    reported a meaningless ~100%).

    Per class:
      1. Split the class's real clips into train/test (at least 1 test clip if the
         class has ≥2 clips; classes with a single clip go entirely to train).
      2. Augment ONLY the train clips (same augmentation as prepare_motion_dataset).
      3. Test clips stay real and untouched.

    Returns X_train, y_train, X_test, y_test, label_map.
    """
    labels = sorted(dataset.keys())
    label_map = { i: label for i, label in enumerate(labels) }
    label_idx = { label: i for i, label in enumerate(labels) }

    rng = np.random.default_rng(seed)
    X_train, y_train, X_test, y_test = [], [], [], []

    for label, samples in dataset.items():
        # Preprocess every real clip for this class.
        real = [s for s in (_preprocess_sample(smp) for smp in samples) if s is not None]
        if not real:
            continue

        # Shuffle then split real clips into train / held-out test.
        idx = rng.permutation(len(real))
        n_test = int(round(len(real) * test_size)) if len(real) >= 2 else 0
        test_idx  = set(idx[:n_test].tolist())
        train_real = [real[i] for i in range(len(real)) if i not in test_idx]
        test_real  = [real[i] for i in range(len(real)) if i in test_idx]

        # Held-out test clips: REAL only, no augmentation.
        for seq in test_real:
            X_test.append(seq)
            y_test.append(label_idx[label])

        # Training clips: real + augmentation (augment only what's in train).
        train_seqs = list(train_real)
        if train_seqs:
            target = max(len(train_seqs) * 6, 150)
            augmented = augment_motion_sequences(
                [s.tolist() for s in train_seqs], target_count=target
            )
            train_seqs.extend([np.array(a, dtype=np.float32) for a in augmented])
        for seq in train_seqs:
            X_train.append(seq)
            y_train.append(label_idx[label])

    X_train = np.array(X_train, dtype=np.float32)
    y_train = np.array(y_train, dtype=np.int32)
    X_test  = np.array(X_test,  dtype=np.float32)
    y_test  = np.array(y_test,  dtype=np.int32)

    print(
        f"Motion split — train X: {X_train.shape} (real+aug), "
        f"test X: {X_test.shape} (real held-out only), classes: {len(labels)}"
    )
    if X_test.shape[0] == 0:
        print("WARNING: held-out test set is EMPTY — every class has <2 real clips. "
              "Test accuracy cannot be measured honestly; collect more clips per word.")
    return X_train, y_train, X_test, y_test, label_map


def list_signers(dataset: dict) -> list:
    """Return the sorted list of distinct signer ids (submitted_by) in the dataset.
    Samples with no signer id are grouped under the sentinel None."""
    signers = set()
    for samples in dataset.values():
        for smp in samples:
            signers.add(smp.get("submitted_by"))
    # Sort with None last for stable ordering.
    return sorted(signers, key=lambda s: (s is None, s))


def prepare_loso_split(dataset: dict, holdout_signer):
    """
    Build a Leave-One-Signer-Out split: TRAIN on every signer except
    `holdout_signer`, TEST on `holdout_signer`'s real clips only.

    This measures generalization to an UNSEEN person — the metric that matters
    for "will this work for a new user." Train clips are augmented; the held-out
    signer's clips are real and untouched.

    Returns X_train, y_train, X_test, y_test, label_map.
    """
    labels = sorted(dataset.keys())
    label_map = { i: label for i, label in enumerate(labels) }
    label_idx = { label: i for i, label in enumerate(labels) }

    X_train, y_train, X_test, y_test = [], [], [], []

    for label, samples in dataset.items():
        train_real, test_real = [], []
        for smp in samples:
            seq = _preprocess_sample(smp)
            if seq is None:
                continue
            if smp.get("submitted_by") == holdout_signer:
                test_real.append(seq)
            else:
                train_real.append(seq)

        for seq in test_real:
            X_test.append(seq)
            y_test.append(label_idx[label])

        train_seqs = list(train_real)
        if train_seqs:
            target = max(len(train_seqs) * 6, 150)
            augmented = augment_motion_sequences(
                [s.tolist() for s in train_seqs], target_count=target
            )
            train_seqs.extend([np.array(a, dtype=np.float32) for a in augmented])
        for seq in train_seqs:
            X_train.append(seq)
            y_train.append(label_idx[label])

    X_train = np.array(X_train, dtype=np.float32)
    y_train = np.array(y_train, dtype=np.int32)
    X_test  = np.array(X_test,  dtype=np.float32)
    y_test  = np.array(y_test,  dtype=np.int32)
    return X_train, y_train, X_test, y_test, label_map


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
