import os
import json
import numpy as np
import httpx
from sklearn.model_selection import train_test_split, KFold
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    147))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))

# Train-time mirror augmentation (doubles every real training sample with a
# horizontally-flipped copy, so the model sees both hand orientations) — see
# mirror_sequence() below. Off by default; flip only after validating per-class
# recall across the full vocabulary, not just the words currently of interest.
MIRROR_AUGMENTATION_ENABLED = os.getenv("MIRROR_AUGMENTATION_ENABLED", "false").lower() == "true"

# Backend API configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000/api")
ML_API_KEY  = os.getenv("ML_API_KEY")  # Must be set in .env

# Pose block layout — MUST match HandLandmarkHelper.kt (POSE_BASE / POSE_KEYPOINTS /
# POSE_LSHOULDER / POSE_RSHOULDER). [126..146] = 7 pose keypoints x (x,y,z).
_POSE_BASE      = 126
_POSE_LSHOULDER = 1  # local pose-block index (mediapipe landmark 11)
_POSE_RSHOULDER = 2  # local pose-block index (mediapipe landmark 12)
_POSE_LWRIST    = 5  # local pose-block index (mediapipe landmark 15)
_POSE_RWRIST    = 6  # local pose-block index (mediapipe landmark 16)

# ── Velocity signal for temporal window selection ────────────────────────────
#
# Measured on the POSE WRIST keypoints, NOT the hand blocks.
#
# normalize_frame wrist-centers each hand block (landmark 0 becomes exactly
# (0,0,0)) and divides by hand size. That deliberately removes ALL whole-hand
# translation, leaving only finger articulation — but for most signs the
# discriminative motion IS the hand's trajectory through space. The previous
# signal also read only hand slot 0 and included landmark 0, so it summed a term
# that is identically zero and went completely blind on left-hand-only sequences
# (all data in slot 1), falling back to peak_idx = n // 2 every time.
#
# The pose block is normalized SHOULDER-relative (centered on the shoulder
# midpoint, scaled by shoulder width), so pose wrists retain full arm translation
# in a signer-scale-invariant frame — and they are anatomically left/right rather
# than detection-slot-ordered, so slot assignment cannot blind them.
#
# MUST stay byte-identical to PredictionService.kt POSE_WRIST_XY / frameVelocity.
_POSE_WRIST_XY = [
    _POSE_BASE + _POSE_LWRIST * 3, _POSE_BASE + _POSE_LWRIST * 3 + 1,
    _POSE_BASE + _POSE_RWRIST * 3, _POSE_BASE + _POSE_RWRIST * 3 + 1,
]

# Fallback when either frame has the 21-zero absent-pose sentinel: fingertip x,y
# of BOTH hand slots. Landmark 0 is excluded on purpose — post-normalization it
# is exactly 0 and contributes nothing.
_FALLBACK_LANDMARKS = [4, 8, 12, 16, 20]
_FALLBACK_XY = [
    hand * 63 + idx
    for hand in range(2)
    for i in _FALLBACK_LANDMARKS
    for idx in (i * 3, i * 3 + 1)
]


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


def _pose_present(frame: np.ndarray) -> bool:
    """True when the frame carries a pose block (not the 21-zero sentinel)."""
    return bool(np.any(frame[_POSE_BASE:_POSE_BASE + 21]))


def frame_velocity(prev: np.ndarray, cur: np.ndarray) -> float:
    """
    L2 velocity between two consecutive NORMALIZED frames.

    Uses the pose wrists when both frames have a pose block, else falls back to
    both hands' fingertips. See the _POSE_WRIST_XY comment above for why the hand
    blocks alone are a near-dead signal.

    MUST match Kotlin frameVelocity byte-for-byte.
    """
    idxs = _POSE_WRIST_XY if (_pose_present(prev) and _pose_present(cur)) else _FALLBACK_XY
    total = 0.0
    for j in idxs:
        d = float(cur[j]) - float(prev[j])
        total += d * d
    return float(np.sqrt(total))


def center_on_peak_velocity(sequence: np.ndarray, force: bool = False) -> np.ndarray:
    """
    Center a motion sequence on its peak-velocity frame.
    Mirrors PredictionService.extractMotionWindow() so training and inference
    see the same temporal alignment.

    `force=False` (default) keeps the `n == SEQUENCE_LENGTH` shortcut, which is
    correct for the TRAIN path: stored rows are already exactly SEQUENCE_LENGTH
    frames, so there is no wider sequence to choose a window from and re-running
    the search would return the same frames at extra cost.

    `force=True` is for the EXTRACTION path. It skips that shortcut so the caller
    can never silently store an unwindowed clip. Note this alone cannot rescue an
    n == SEQUENCE_LENGTH input — with exactly 30 frames the only possible window
    IS [0:30] — so extract.py must also hand in MORE than SEQUENCE_LENGTH frames.
    The flag exists so that if it ever doesn't, the behaviour is a deliberate
    identity rather than an invisible early return.

    History: extract.py used to call this without `force` while sampling
    `min(total_frames, SEQUENCE_LENGTH * 2)` frames and dropping leading
    hand-less frames. Any clip that landed on exactly 30 was stored with NO
    window ever selected — the velocity signal was never consulted. With 1-2 s
    source clips that was most of the dataset.
    """
    n = len(sequence)
    if n == SEQUENCE_LENGTH and not force:
        return sequence

    # Find peak-velocity frame
    peak_idx = n // 2
    peak_vel = 0.0
    for i in range(1, n):
        v = frame_velocity(sequence[i - 1], sequence[i])
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
        skipped_empty = 0
        skipped_shape = 0
        for sample in samples:
            sequence = sample.get("sequence", [])
            if not sequence:
                skipped_empty += 1
                continue
            if len(sequence[0]) != FEATURE_SIZE:
                skipped_shape += 1
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

        if skipped_empty or skipped_shape:
            print(f"[preprocessor] '{label}': skipped {skipped_empty} empty and "
                  f"{skipped_shape} wrong-width sample(s) "
                  f"(expected {FEATURE_SIZE} features/frame)")

        if sequences:
            real[label] = sequences
        else:
            # A dropped label is NOT a class in the trained model, but it may
            # still exist in the word bank — and every class index at or after
            # it shifts by one. That silently remaps predictions to neighbouring
            # words, so it must be loud.
            print(f"[preprocessor] WARNING: '{label}' has NO usable samples and is "
                  f"excluded from the model's classes. Every later class index shifts.")
    return real


def prepare_motion_dataset(dataset: dict, test_size: float = 0.2, random_state: int = 42,
                           fold: int | None = None, n_splits: int = 5):
    """
    Prepare a motion dataset split BEFORE augmentation, so the evaluation split is
    always pure real (unaugmented) data. Augmenting first and splitting after (the
    previous approach) let noise/stretch/dropout copies of the same real clip land on
    both sides of the split — inflating both the training-time val_accuracy (which
    drives EarlyStopping/ReduceLROnPlateau) and test.py's reported accuracy, since
    neither was evaluating against genuinely unseen data.

    Two modes:

    * fold=None (default) — single stratified holdout of `test_size`. This is the
      path /train uses, unchanged.
    * fold=k, 0 <= k < n_splits — the k-th fold of a stratified K-fold split, for
      cross-validation via tools/cross_validate.py. Preferred at the current data
      scale: a 3-way train/val/test split would cost ~4 real training sequences per
      class (16.8 -> 12.6 at 206 samples / 10 classes), and training data is the
      binding constraint on accuracy. K-fold keeps every sample in training for most
      folds while still predicting each one exactly once while held out, and the
      spread across folds says whether a change is real or noise.

    Returns (X_train, y_train, X_val, y_val, label_map). label_map (index -> label)
    is identical for both splits — computed once from every label present, so the
    model's output contract does not shift between folds.
    """
    real   = _load_real_sequences(dataset)
    labels = sorted(real.keys())

    label_map = { i: label for i, label in enumerate(labels) }
    label_idx = { label: i for i, label in enumerate(labels) }

    # This mapping IS the model's output contract — index i means labels[i] and
    # nothing else. It ships as labels_motion.json and the app refuses to run a
    # model whose class count disagrees with it. Printed so a retrain's mapping
    # can be diffed against what a device actually has.
    print(f"[preprocessor] {len(labels)} classes (index -> label):")
    for i, label in label_map.items():
        print(f"[preprocessor]   {i:>3} -> {label}  ({len(real[label])} sample(s))")

    X_train, y_train = [], []
    X_val,   y_val   = [], []

    for label in labels:
        sequences = real[label]
        idx = label_idx[label]

        if len(sequences) < 2:
            # Too few real samples to hold any out — everything goes to training;
            # this class just won't have a data point in the evaluation split.
            train_seqs, val_seqs = sequences, []
        elif fold is None:
            train_seqs, val_seqs = train_test_split(
                sequences, test_size=test_size, random_state=random_state
            )
        else:
            # Per-class K-fold. Splitting within each label keeps every fold
            # stratified by construction, including for classes with too few
            # samples to appear in every fold of a global split.
            k = min(n_splits, len(sequences))
            kf = KFold(n_splits=k, shuffle=True, random_state=random_state)
            tr_idx, va_idx = list(kf.split(sequences))[fold % k]
            train_seqs = [sequences[i] for i in tr_idx]
            val_seqs   = [sequences[i] for i in va_idx]

        # Mirror-augment the TRAIN portion only (doubles it with flipped copies) —
        # same train-only rule as the noise/speed/dropout augmentation below, so the
        # validation split stays 100% real and unmirrored.
        if MIRROR_AUGMENTATION_ENABLED:
            train_seqs = train_seqs + [mirror_sequence(s) for s in train_seqs]

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


def mirror_sequence(seq: np.ndarray) -> np.ndarray:
    """
    Horizontally mirror an already-normalized motion sequence: negate x for every
    present hand block, and negate+swap the pose block's L/R paired points (same
    convention as MainActivity.kt's mirrorHandX/mirrorPoseBlock — operates on
    wrist/shoulder-relative coordinates post-normalize_frame, so the mirror is
    `-x`, not `1-x`). Absent (all-zero) hand/pose blocks are left untouched.
    """
    out = seq.copy()
    for f in range(out.shape[0]):
        frame = out[f]
        for hand in range(2):
            base = hand * 63
            if not np.any(frame[base:base + 63]):
                continue
            for j in range(21):
                frame[base + j * 3] = -frame[base + j * 3]
        if np.any(frame[_POSE_BASE:_POSE_BASE + 21]):
            for k in range(7):
                frame[_POSE_BASE + k * 3] = -frame[_POSE_BASE + k * 3]
            for a, b in ((1, 2), (3, 4), (5, 6)):
                for off in range(3):
                    ai, bi = _POSE_BASE + a * 3 + off, _POSE_BASE + b * 3 + off
                    frame[ai], frame[bi] = frame[bi], frame[ai]
    return out


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
