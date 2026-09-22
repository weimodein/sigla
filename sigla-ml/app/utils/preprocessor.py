import os
import json
import hashlib
import numpy as np
import httpx
from sklearn.model_selection import train_test_split, KFold
from dotenv import load_dotenv

load_dotenv()

FEATURE_SIZE    = int(os.getenv("FEATURE_SIZE",    147))
SEQUENCE_LENGTH = int(os.getenv("SEQUENCE_LENGTH", 30))

# Pose blocks the phone requires in a 30-frame window before it will run the model
# (PredictionService.MIN_POSE_FRAMES). Mirrored here so augmentation can be derived
# from the device's real tolerance rather than a hand-picked number.
MIN_POSE_WINDOW_FRAMES = int(os.getenv("MIN_POSE_WINDOW_FRAMES", 24))

# Train-time mirror augmentation (doubles every real training sample with a
# horizontally-flipped copy, so the model sees both hand orientations) — see
# mirror_sequence() below. Enabled after held-out-signer A/B validation showed
# 96.2% original-orientation and 94.2% mirrored-orientation accuracy, versus the
# non-augmented deployed model's 24.8% sensitivity result when mirrored.
MIRROR_AUGMENTATION_ENABLED = os.getenv("MIRROR_AUGMENTATION_ENABLED", "true").lower() == "true"
MIRROR_AUGMENTATION_RATIO = float(os.getenv("MIRROR_AUGMENTATION_RATIO", 1.0))

# Live MediaPipe occasionally loses a pose or one hand for a few frames even when
# the gesture itself is clear. The uploaded dataset currently has pose in 100% of
# stored frames, so without this bounded augmentation the model has never seen the
# zero-block sentinel that the phone legitimately emits. Keep the maximum aligned
# with PredictionService.MIN_POSE_FRAMES, which is the widest gap the phone will
# still hand to the model: SEQUENCE_LENGTH - MIN_POSE_FRAMES = 30 - 24 = 6.
#
# This was 4, which left frames with 5 or 6 missing pose blocks accepted live but
# never seen in training — a narrow out-of-distribution band on exactly the windows
# the app is most likely to be unsure about. Deriving it from the device constant
# closes the band and keeps the two from drifting apart again.
LANDMARK_DROPOUT_ENABLED = os.getenv("LANDMARK_DROPOUT_ENABLED", "true").lower() == "true"
LANDMARK_DROPOUT_MAX_FRAMES = int(
    os.getenv("LANDMARK_DROPOUT_MAX_FRAMES", SEQUENCE_LENGTH - MIN_POSE_WINDOW_FRAMES)
)

# Rotation augmentation: small in-plane (xy) rotations of already-normalized
# sequences. Normalization removes translation and scale but NOT rotation, so
# camera tilt / signer lean is otherwise unmodelled. Applied about the origin,
# which is the wrist for hand blocks and the shoulder midpoint for the pose block
# (both are exactly (0,0) post-normalize_frame) — the same convention that makes
# mirror_sequence a plain `-x`.
ROTATION_AUGMENTATION_ENABLED = os.getenv("ROTATION_AUGMENTATION_ENABLED", "true").lower() == "true"
ROTATION_MAX_DEGREES = float(os.getenv("ROTATION_MAX_DEGREES", 12.0))

# The phone runs pose inference every second camera frame and merges the newest
# completed pose result into every hand frame. That makes the live pose trajectory
# stepwise and normally one frame stale, while uploaded clips are extracted with a
# same-frame pose on every frame. Include this live-domain pattern in training.
POSE_CADENCE_AUGMENTATION_ENABLED = os.getenv(
    "POSE_CADENCE_AUGMENTATION_ENABLED", "true"
).lower() == "true"
POSE_CADENCE_INTERVAL = max(1, int(os.getenv("POSE_CADENCE_INTERVAL", 2)))
POSE_CADENCE_LAG = max(0, int(os.getenv("POSE_CADENCE_LAG", 1)))

# Fraction of augmented samples that get the phone's pose cadence applied.
#
# Cadence used to be one of N mutually-exclusive augmentation TYPES, drawn ~1/6 of
# the time — so ~83% of training frames paired hands with a pose captured on the
# SAME frame, a pairing the phone never produces. Live, pose is submitted every
# POSE_CADENCE_INTERVAL frames and read back POSE_CADENCE_LAG callbacks later, so
# every live frame carries a stale, repeated pose block.
#
# It is now a composable POST-STEP instead: any augmentation type may additionally
# be cadence-shifted, so the transform composes with stretch/noise/rotation rather
# than competing with them for draws. Kept below 1.0 so the model still sees some
# same-frame pairings — the offline extractor genuinely produces those, and a clip
# re-extracted server-side should not become out-of-distribution.
POSE_CADENCE_APPLY_RATIO = min(max(
    float(os.getenv("POSE_CADENCE_APPLY_RATIO", 0.60)), 0.0), 1.0)

# Cover real signer-speed and effective device-FPS variation. These bounds remain
# conservative enough to avoid implausibly static or hyper-fast gestures.
TEMPORAL_STRETCH_MIN = float(os.getenv("TEMPORAL_STRETCH_MIN", 0.80))
TEMPORAL_STRETCH_MAX = float(os.getenv("TEMPORAL_STRETCH_MAX", 1.20))

# Truncated-prefix augmentation is opt-in. Labelling a shared opening as the final
# word taught the model to make confident guesses before the distinguishing tail
# arrived, which inflated full-clip validation while hurting live precision. The
# mobile evidence gate now waits for a complete-enough gesture instead. Only enable
# this after tools/simulate_early_fire.py demonstrates a vocabulary-wide benefit.
PREFIX_AUGMENTATION_ENABLED = os.getenv("PREFIX_AUGMENTATION_ENABLED", "false").lower() == "true"
PREFIX_KEEP_MIN = float(os.getenv("PREFIX_KEEP_MIN", 0.40))
PREFIX_KEEP_MAX = float(os.getenv("PREFIX_KEEP_MAX", 0.85))

# Augmented copies per real training sequence. There used to be a `max(..., 150)`
# floor here, which did two bad things at once: it turned a 3-clip class into 150
# samples (~98% synthetic copies of 3 originals), and by padding every class to the
# SAME count it made compute_class_weight('balanced') return exactly 1.0 for every
# class — weighting that appeared to handle imbalance while doing nothing.
AUGMENTATION_FACTOR = int(os.getenv("AUGMENTATION_FACTOR", 6))

# Accuracy-first gate used by train.py. Many clips from one person do not replace
# signer diversity; that pattern yields high random-split accuracy and weak live
# accuracy for a new user.
MIN_REAL_SAMPLES_PER_CLASS = int(os.getenv("MIN_REAL_SAMPLES_PER_CLASS", 20))
MIN_SIGNERS_PER_CLASS = int(os.getenv("MIN_SIGNERS_PER_CLASS", 4))
MIN_SAMPLES_PER_SIGNER = int(os.getenv("MIN_SAMPLES_PER_SIGNER", 4))

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

    # The whole dataset arrives as ONE JSON body — every sample's full 30x147 float
    # sequence inlined. Measured at 1726 samples / 42 classes: 98.2 MB taking 88.7s
    # on a cold backend cache, which blew straight through the previous hardcoded
    # 30s and failed training before a single epoch ran. The payload grows linearly
    # with the dataset, so a fixed short timeout gets tighter every time a clip is
    # added — exactly backwards.
    #
    # This is a read timeout on a large but healthy transfer, not a hung server, so a
    # generous ceiling is correct. Override with ML_FETCH_TIMEOUT if a backend is
    # genuinely unreachable and you want to fail fast instead.
    timeout = float(os.getenv("ML_FETCH_TIMEOUT", 600.0))

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(url, headers=headers)
            response.raise_for_status()
            dataset = response.json()
    except httpx.HTTPStatusError as e:
        raise ValueError(f"Backend API returned error {e.response.status_code}: {e.response.text}")
    except httpx.RequestError as e:
        raise ValueError(
            f"Failed to connect to backend API after {timeout:.0f}s: {e}. "
            f"If the dataset is large this may be a transfer timeout rather than an "
            f"unreachable backend — raise ML_FETCH_TIMEOUT."
        )

    if not dataset:
        raise ValueError("No approved samples found in backend database.")

    total_classes = len(dataset)
    total_samples = sum(len(samples) for samples in dataset.values())
    print(f"Fetched {total_samples} samples across {total_classes} classes")
    return dataset


# Largest plausible hand extent, in hand-widths, AFTER normalization.
#
# Normalization divides every landmark by the 2D wrist→middle-MCP distance, so a
# real hand spans about 1-2 by construction; measured across the dataset, normal
# frames sit near 1.2. The `d < 1e-6` clamp in normalize_frame catches an exactly
# degenerate hand but not a merely small one: when MediaPipe returns a collapsed
# detection, d lands near 0.01 and the whole hand is scaled ~100x. The result is
# still perfectly normalized — wrist at the origin, |wrist→MCP9| exactly 1.000 —
# so nothing downstream notices, and 2.19% of stored hand-frames carry it (TODAY
# 31.8%, SLOW 18.6%). See artifacts/device_tests/landmark_corruption.md.
#
# 5 is far above any real hand and far below the corrupted ones (which reach 96),
# so the threshold does not need to be precise to separate them.
#
# MUST stay identical to MAX_HAND_EXTENT in HandLandmarkHelper.kt.
MAX_HAND_EXTENT = float(os.getenv("MAX_HAND_EXTENT", 5.0))


def hand_extent_ok(frame: np.ndarray) -> bool:
    """
    True when every PRESENT hand in an already-normalized frame is a plausible
    size.

    Takes a normalized frame: the check is meaningless on raw image coordinates,
    where the scale is the frame rather than the hand.

    MUST stay identical to handExtentOk in HandLandmarkHelper.kt.
    """
    for hand in range(2):
        base = hand * 63
        block = frame[base:base + 63]
        if not np.any(block):
            continue  # absent hand — nothing to judge
        xs = block[0:63:3]
        ys = block[1:63:3]
        if (float(xs.max() - xs.min()) > MAX_HAND_EXTENT or
                float(ys.max() - ys.min()) > MAX_HAND_EXTENT):
            return False
    return True


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


# Temporal window search parameters. MUST match PredictionService.kt.
#
# Source clips are "raise, sign, lower": the signer's hands enter the frame, make
# the sign, then drop. The ENTRY movement is a bigger velocity spike than the sign
# itself — measured on a real stored clip, the hand-raise hit 0.4844 at frame 2
# while the actual gesture peaked at 0.2098 (f16) and 0.1861 (f22), ~2.3x smaller.
# A plain argmax therefore centres the window on the hand-raise and cuts off the
# sign, which is what made GOOD MORNING / GOOD AFTERNOON / I'M FINE mutually
# confusable: every one of them looks like "hands coming up".
#
# Two guards, both needed:
#   * smoothing — a 5-frame moving average, so a single sharp frame cannot beat a
#     sustained gesture movement. NOT sufficient alone: the entry spike is broad
#     as well as tall, and a smoothed argmax still picked frame 3 on the real clip.
#   * edge margin — exclude the first and last VELOCITY_EDGE_MARGIN of the
#     sequence from the search, since that is where entry/exit motion lives. This
#     is what actually moves the pick to f17 (the real sign). Margins from 0.15 to
#     0.30 all converge on the same frame, so the exact value is not delicate.
VELOCITY_SMOOTH_WINDOW = 5
VELOCITY_EDGE_MARGIN   = 0.20

# Two smoothed velocities within this are treated as tied. Sized well above
# float32-vs-float64 rounding (~1e-7 at these magnitudes) but far below any real
# difference in movement. See the tie-breaking comment in peak_velocity_index.
_VELOCITY_TIE_EPS = 1e-5


def peak_velocity_index(sequence: np.ndarray) -> int:
    """
    Index of the frame that best represents the gesture's motion.

    Returns an index into `sequence` (1..n-1, matching the velocity transitions).
    Falls back to the un-margined argmax when the sequence is too short for a
    margin to leave anything to search.

    MUST stay byte-identical to Kotlin peakVelocityIndex.
    """
    n = len(sequence)
    if n < 2:
        return 0

    vel = np.array(
        [frame_velocity(sequence[i - 1], sequence[i]) for i in range(1, n)],
        dtype=np.float64,
    )

    # Moving average. 'same' keeps the index alignment of `vel`; the shorter
    # effective window at the ends is harmless because the ends are excluded below.
    if len(vel) >= VELOCITY_SMOOTH_WINDOW:
        kernel = np.ones(VELOCITY_SMOOTH_WINDOW) / VELOCITY_SMOOTH_WINDOW
        smoothed = np.convolve(vel, kernel, mode="same")
    else:
        smoothed = vel

    lo = int(len(vel) * VELOCITY_EDGE_MARGIN)
    hi = len(vel) - lo
    if hi <= lo:
        # Too short to trim — search everything rather than return nothing.
        lo, hi = 0, len(vel)

    # Ties are the normal case, not an edge case: smoothing a single sharp spike
    # over VELOCITY_SMOOTH_WINDOW frames produces a flat plateau where several
    # frames share the maximum. Python accumulates in float64 and Kotlin in
    # float32, so "pick whichever compares greater" resolves those plateaus
    # differently on the two sides and the windows silently diverge.
    #
    # Break ties on distance from the sequence centre (then on lower index), which
    # is both deterministic across languages and the better choice anyway — the
    # centre of a plateau is the middle of the movement.
    centre = len(vel) / 2.0
    best = lo
    for i in range(lo, hi):
        if smoothed[i] > smoothed[best] + _VELOCITY_TIE_EPS:
            best = i
        elif abs(smoothed[i] - smoothed[best]) <= _VELOCITY_TIE_EPS:
            if abs(i - centre) < abs(best - centre):
                best = i

    return best + 1


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

    # Find the frame that best represents the GESTURE — see peak_velocity_index
    # for why a plain argmax picks the hand-raise instead.
    peak_idx = peak_velocity_index(sequence)

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


def _load_real_sequences(dataset: dict, with_groups: bool = False):
    """
    Normalize + peak-center every stored real sequence, grouped by label. No
    augmentation — this is the actual recorded data, used as the basis for both the
    augmented training set and the untouched evaluation set below.

    `with_groups=True` additionally returns a parallel dict of per-sequence grouping
    keys (session_id, falling back to a unique per-sample token when absent), for
    signer-grouped cross-validation. Returned separately rather than bundled into the
    sequence list so the default return shape is unchanged.
    """
    real = {}
    groups = {}
    # Exact duplicates must not become extra training votes. They commonly arise
    # when the same upload is retried, and otherwise make the model overfit that
    # recording while making random holdouts look better than they are. Hash the
    # stored float32 bytes before normalization so the check is deterministic and
    # independent of later feature-pipeline changes.
    seen_hashes = {}
    for label, samples in dataset.items():
        sequences = []
        seq_groups = []
        skipped_empty = 0
        skipped_shape = 0
        skipped_duplicate = 0
        for sample in samples:
            sequence = sample.get("sequence", [])
            if not sequence:
                skipped_empty += 1
                continue
            try:
                seq = np.array(sequence, dtype=np.float32)
            except (TypeError, ValueError):
                skipped_shape += 1
                continue
            if seq.ndim != 2 or seq.shape[1] != FEATURE_SIZE or not np.isfinite(seq).all():
                skipped_shape += 1
                continue

            digest = hashlib.sha256(seq.tobytes()).hexdigest()
            previous_label = seen_hashes.get(digest)
            if previous_label is not None:
                if previous_label != label:
                    raise ValueError(
                        "Identical gesture sequence is approved under conflicting "
                        f"labels '{previous_label}' and '{label}'. Resolve the bad "
                        "sample before training; learning both labels is impossible."
                    )
                skipped_duplicate += 1
                continue
            seen_hashes[digest] = label

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

            # Grouping key. A NULL session_id means provenance was never recorded, so
            # the sample gets a UNIQUE key rather than sharing a "None" bucket —
            # merging unknowns would assert that they came from one signer, which was
            # never observed and would corrupt a grouped split.
            sid = sample.get("session_id")
            normalized_sid = str(sid).strip().casefold() if sid else ""
            seq_groups.append(
                normalized_sid if normalized_sid
                else f"__unknown_{label}_{sample.get('sample_id', len(seq_groups))}"
            )

        if skipped_empty or skipped_shape or skipped_duplicate:
            print(f"[preprocessor] '{label}': skipped {skipped_empty} empty and "
                  f"{skipped_shape} invalid-shape/non-finite and "
                  f"{skipped_duplicate} exact-duplicate sample(s) "
                  f"(expected {FEATURE_SIZE} features/frame)")

        if sequences:
            real[label] = sequences
            groups[label] = seq_groups
        else:
            # A dropped label is NOT a class in the trained model, but it may
            # still exist in the word bank — and every class index at or after
            # it shifts by one. That silently remaps predictions to neighbouring
            # words, so it must be loud.
            print(f"[preprocessor] WARNING: '{label}' has NO usable samples and is "
                  f"excluded from the model's classes. Every later class index shifts.")
    return (real, groups) if with_groups else real


def validate_training_coverage(dataset: dict) -> dict:
    """Fail fast when a class lacks enough real, signer-diverse recordings.

    Exact duplicates are removed before counting, so re-uploading a clip cannot
    satisfy the gate. Unknown-provenance samples count toward total clips but not
    toward signer coverage.
    """
    real, groups = _load_real_sequences(dataset, with_groups=True)
    issues = []
    report = {}

    for label in sorted(real):
        signer_counts = {}
        for group in groups[label]:
            if group.startswith("__unknown_"):
                continue
            signer_counts[group] = signer_counts.get(group, 0) + 1

        qualified = {
            signer: count for signer, count in signer_counts.items()
            if count >= MIN_SAMPLES_PER_SIGNER
        }
        report[label] = {
            "real_samples": len(real[label]),
            "signers": signer_counts,
            "qualified_signers": len(qualified),
        }

        problems = []
        if len(real[label]) < MIN_REAL_SAMPLES_PER_CLASS:
            problems.append(
                f"{len(real[label])}/{MIN_REAL_SAMPLES_PER_CLASS} unique clips"
            )
        if len(qualified) < MIN_SIGNERS_PER_CLASS:
            problems.append(
                f"{len(qualified)}/{MIN_SIGNERS_PER_CLASS} signers with at least "
                f"{MIN_SAMPLES_PER_SIGNER} clips"
            )
        if problems:
            issues.append(f"{label}: " + ", ".join(problems))

    if issues:
        raise ValueError(
            "Training dataset does not meet the signer-diversity quality gate. "
            "Upload more real clips and reuse the same signer ID across words.\n  - "
            + "\n  - ".join(issues)
        )

    print(
        f"[preprocessor] coverage gate passed: >= {MIN_REAL_SAMPLES_PER_CLASS} clips, "
        f">= {MIN_SIGNERS_PER_CLASS} signers/class, >= {MIN_SAMPLES_PER_SIGNER} clips/signer"
    )
    return report


def prepare_motion_dataset(dataset: dict, test_size: float = 0.2, random_state: int = 42,
                           fold: int | None = None, n_splits: int = 5,
                           group_by_session: bool = False,
                           train_all: bool = False):
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

    `train_all=True` is the final-fit mode: it creates no holdout and assigns every
    unique real sequence to training. Use it only after the stopping epoch has been
    selected independently (train.py does this with its first, holdout-based fit).

    Returns (X_train, y_train, X_val, y_val, label_map, real_train_counts).

    label_map (index -> label) is identical for both splits — computed once from
    every label present, so the model's output contract does not shift between folds.

    real_train_counts (index -> int) is each class's REAL, pre-augmentation training
    count, for computing class weights independently of the augmentation policy.
    The old max(...,150) floor padded every class to the same size, which made
    'balanced' weights on y_train come out exactly 1.0 — weighting that silently did
    nothing. Deriving weights from these counts instead keeps that from recurring if
    the augmentation policy ever changes again.
    """
    real, all_groups = _load_real_sequences(dataset, with_groups=True)
    labels = sorted(real.keys())

    # Signer-grouped folds. Splitting per class (below) means a global
    # StratifiedGroupKFold is unnecessary — stratification is already guaranteed by
    # construction — so grouping is applied WITHIN each class: hold out whole signers,
    # never individual clips.
    #
    # This is what makes the number mean "accuracy for a NEW signer". Ungrouped folds
    # put the same signer on both sides, so the model can score by recognising the
    # person rather than the sign.
    held_out_session = None
    if group_by_session:
        distinct = {g for gs in all_groups.values() for g in gs}
        real_sessions = {g for g in distinct if not g.startswith("__unknown_")}
        if len(real_sessions) < 2:
            raise ValueError(
                f"group_by_session requires >=2 distinct session_id values, found "
                f"{len(real_sessions)}. Samples without a session_id cannot be grouped "
                f"(they are treated as singletons). Backfill gesture_samples.session_id "
                f"first — see migrations/002_gesture_samples_session_id.sql."
            )
        print(f"[preprocessor] grouped split ON — {len(real_sessions)} session(s): "
              f"{', '.join(sorted(real_sessions))}")
        if fold is not None:
            ordered_sessions = sorted(real_sessions)
            held_out_session = ordered_sessions[fold % len(ordered_sessions)]
            print(f"[preprocessor] globally held-out signer: {held_out_session}")

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
    real_train_counts = {}   # class index -> real (pre-augmentation) train count

    for label in labels:
        sequences = real[label]
        idx = label_idx[label]

        if train_all:
            # Final deployment fit: epoch count has already been selected on a
            # separate holdout, so use every approved real recording here.
            train_seqs, val_seqs = sequences, []
        elif len(sequences) < 2:
            # Too few real samples to hold any out — everything goes to training;
            # this class just won't have a data point in the evaluation split.
            train_seqs, val_seqs = sequences, []
        elif group_by_session and fold is not None:
            # Hold out one GLOBAL signer across every class. Choosing the k-th group
            # independently inside each class could silently evaluate a different
            # person per word when a class contained a missing/legacy session.
            seq_groups = all_groups[label]
            train_seqs = [s for s, g in zip(sequences, seq_groups) if g != held_out_session]
            val_seqs   = [s for s, g in zip(sequences, seq_groups) if g == held_out_session]
            if not train_seqs:
                # Every sample of this class belongs to the held-out signer, so it
                # cannot be learned this fold. Train on it anyway rather than emit a
                # class the model has never seen.
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

        # Real (unaugmented) training count for this class, captured BEFORE any
        # augmentation. This is what class weighting must be based on — see the
        # real_counts note in this function's docstring.
        real_train_counts[idx] = len(train_seqs)

        # Per-class generator. A single default_rng(42) inside the callee gave every
        # class identical augmentation draws; deriving from [seed, idx] keeps runs
        # reproducible while decorrelating classes.
        class_rng = np.random.default_rng([random_state, idx])

        # Mirror-augment the TRAIN portion only. Mirrored copies join the source
        # pool but stay inside the existing real_count * AUGMENTATION_FACTOR budget;
        # enabling handedness robustness must not silently double training time or
        # double the synthetic-to-real ratio. A tunable subset avoids making the
        # training distribution artificially 50/50 when the primary phone camera
        # domain has a consistent orientation.
        real_train_count = len(train_seqs)
        mirror_count = 0
        if MIRROR_AUGMENTATION_ENABLED:
            ratio = min(max(MIRROR_AUGMENTATION_RATIO, 0.0), 1.0)
            mirror_count = min(real_train_count, int(round(real_train_count * ratio)))
            if mirror_count:
                chosen = (
                    np.arange(real_train_count)
                    if mirror_count == real_train_count else
                    class_rng.choice(real_train_count, size=mirror_count, replace=False)
                )
                train_seqs = train_seqs + [mirror_sequence(train_seqs[i]) for i in chosen]

        # Augment the TRAIN portion only — evaluation stays 100% real, unaugmented.
        #
        # No `max(..., 150)` floor: it used to inflate a 3-clip class to 150 samples
        # (~98% synthetic copies of 3 originals), which both overfit those originals
        # and — because it equalized every class to the same count — made the
        # downstream compute_class_weight('balanced') a no-op. Scaling purely by the
        # real count keeps the genuine imbalance visible so class weights can act on it.
        target = real_train_count * AUGMENTATION_FACTOR

        augmented = augment_motion_sequences(
            [s.tolist() for s in train_seqs], target_count=target, rng=class_rng
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

    # Real-vs-augmented counts per class. Printed because augmentation hides the
    # true data imbalance in X_train's shape: a class with 3 real clips and one with
    # 30 both look large after augmentation, so a collection gap is otherwise
    # invisible at exactly the moment it matters.
    weakest = sorted(real_train_counts.items(), key=lambda kv: kv[1])[:3]
    print("[preprocessor] real train samples per class (pre-augmentation); "
          f"lowest: {', '.join(f'{label_map[i]}={n}' for i, n in weakest)}")

    return X_train, y_train, X_val, y_val, label_map, real_train_counts


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


def rotate_sequence(seq: np.ndarray, radians: float) -> np.ndarray:
    """
    Rotate an already-normalized motion sequence by `radians` in the xy-plane.

    Operates on post-normalize_frame coordinates, where each present hand block is
    wrist-centered and the pose block is shoulder-midpoint-centered — so the origin
    IS the anatomical centre and a plain rotation about it is correct. z is left
    untouched (it is a depth estimate on a different scale, and rotating it into x/y
    would mix incompatible units).

    Absent (all-zero) hand/pose blocks stay zero: rotating (0,0) yields (0,0), but
    they are skipped explicitly so the absent-block sentinel can never be perturbed
    by floating-point noise.
    """
    out = seq.copy()
    cos_r, sin_r = float(np.cos(radians)), float(np.sin(radians))

    for f in range(out.shape[0]):
        frame = out[f]
        for hand in range(2):
            base = hand * 63
            if not np.any(frame[base:base + 63]):
                continue
            for j in range(21):
                x, y = frame[base + j * 3], frame[base + j * 3 + 1]
                frame[base + j * 3]     = x * cos_r - y * sin_r
                frame[base + j * 3 + 1] = x * sin_r + y * cos_r
        if np.any(frame[_POSE_BASE:_POSE_BASE + 21]):
            for k in range(7):
                x, y = frame[_POSE_BASE + k * 3], frame[_POSE_BASE + k * 3 + 1]
                frame[_POSE_BASE + k * 3]     = x * cos_r - y * sin_r
                frame[_POSE_BASE + k * 3 + 1] = x * sin_r + y * cos_r
    return out


def truncated_prefix_sequence(seq: np.ndarray, keep_fraction: float) -> np.ndarray:
    """
    Keep the first `keep_fraction` of the sequence, then right-pad by repeating the
    last kept frame back up to SEQUENCE_LENGTH.

    This reproduces EXACTLY what live inference feeds the model mid-gesture:
    PredictionService runs on a growing buffer and pads a short buffer by repeating
    its last frame (see extractMotionWindow / the `while (window.size < SEQUENCE_LENGTH)`
    loop in PredictionService.kt, mirrored by center_on_peak_velocity's padding here).

    Without this, the model is trained only on complete, peak-centered gestures but
    is asked to classify partial ones on every early fire.
    """
    n = len(seq)
    keep = int(round(n * keep_fraction))
    keep = max(1, min(keep, n))

    window = [seq[i] for i in range(keep)]
    while len(window) < SEQUENCE_LENGTH:
        window.append(window[-1])
    return np.array(window[:SEQUENCE_LENGTH], dtype=np.float32)


def landmark_dropout_sequence(seq: np.ndarray, rng: np.random.Generator,
                              max_frames: int = LANDMARK_DROPOUT_MAX_FRAMES) -> np.ndarray:
    """Hide one landmark block in a few frames, reproducing live detector loss.

    A whole block is set to zero because zero is the shared ML/mobile sentinel for
    "not detected". We never perturb individual coordinates (which would describe
    an anatomically impossible hand), never hide more than max_frames, and only
    choose blocks that were present in the source frame.
    """
    out = seq.copy()
    limit = max(0, min(int(max_frames), len(out)))
    if limit == 0:
        return out

    candidates = []
    for frame_idx, frame in enumerate(out):
        if np.any(frame[0:63]):
            candidates.append((frame_idx, 0, 63))
        if np.any(frame[63:126]):
            candidates.append((frame_idx, 63, 126))
        if np.any(frame[_POSE_BASE:_POSE_BASE + 21]):
            candidates.append((frame_idx, _POSE_BASE, _POSE_BASE + 21))
    if not candidates:
        return out

    count = int(rng.integers(1, min(limit, len(out)) + 1))
    # Use distinct frames so one augmentation cannot erase several blocks from
    # the same instant or exceed the documented missing-frame bound.
    selected_frames = rng.choice(len(out), size=count, replace=False)
    for frame_idx in selected_frames:
        available = [item for item in candidates if item[0] == int(frame_idx)]
        if not available:
            continue
        _, start, end = available[int(rng.integers(len(available)))]
        out[int(frame_idx), start:end] = 0.0
    return out


def pose_cadence_sequence(seq: np.ndarray, interval: int = POSE_CADENCE_INTERVAL,
                          lag: int = POSE_CADENCE_LAG) -> np.ndarray:
    """Reproduce the phone's cached-pose cadence without changing hand features.

    Pose is submitted every ``interval`` frames and becomes visible after ``lag``
    hand callbacks. Frames between updates reuse the newest completed pose, while
    startup frames carry the all-zero absent-pose sentinel.
    """
    out = seq.copy()
    out[:, _POSE_BASE:_POSE_BASE + 21] = 0.0
    interval = max(1, int(interval))
    lag = max(0, int(lag))
    last_pose = None

    for frame_idx in range(len(out)):
        source_idx = frame_idx - lag
        if source_idx >= 0 and (source_idx + 1) % interval == 0:
            last_pose = seq[source_idx, _POSE_BASE:_POSE_BASE + 21].copy()
        if last_pose is not None:
            out[frame_idx, _POSE_BASE:_POSE_BASE + 21] = last_pose
    return out


def augment_motion_sequences(sequences: list, target_count: int = 100,
                             rng: np.random.Generator | None = None) -> list:
    """
    Augment motion sequences with temporal speed variation, noise, frame jitter, and
    (when enabled) in-plane rotation and truncated prefixes.

    `rng` should be supplied by the caller, seeded per class. It used to be created
    here as an unconditional default_rng(42) — but this function is called once per
    class, so every class received the identical sequence of augmentation types and
    the identical noise/stretch draws. That is correlated noise across classes rather
    than independent augmentation, and it can introduce a spurious shared signal.
    """
    augmented = []
    if not sequences:
        return augmented

    if rng is None:
        rng = np.random.default_rng(42)

    # Build the enabled augmentation menu. Optional transforms stay independently
    # switchable so each can be A/B'd with signer-grouped cross-validation.
    aug_types = [0, 1, 2]
    if ROTATION_AUGMENTATION_ENABLED:
        aug_types.append(3)
    if LANDMARK_DROPOUT_ENABLED:
        aug_types.append(4)
    if PREFIX_AUGMENTATION_ENABLED:
        aug_types.append(6)
    # NOTE: pose cadence (formerly type 5) is deliberately NOT in this menu. It is
    # applied as a composable post-step below — see POSE_CADENCE_APPLY_RATIO.

    needed = target_count - len(sequences)

    while len(augmented) < needed:
        base = np.array(sequences[rng.integers(len(sequences))], dtype=np.float32)

        aug_type = aug_types[rng.integers(len(aug_types))]
        if aug_type == 0:
            # Temporal speed variation (default ±20%)
            low = min(TEMPORAL_STRETCH_MIN, TEMPORAL_STRETCH_MAX)
            high = max(TEMPORAL_STRETCH_MIN, TEMPORAL_STRETCH_MAX)
            stretch = rng.uniform(low, high)
            new_len = int(SEQUENCE_LENGTH * stretch)
            indices = np.linspace(0, SEQUENCE_LENGTH - 1, new_len)
            stretched = np.array([
                np.interp(indices, np.arange(SEQUENCE_LENGTH), base[:, i])
                for i in range(base.shape[1])
            ]).T
            # Re-center on peak velocity after stretching. force=True because a
            # stretch factor near 1.0 can land new_len on exactly SEQUENCE_LENGTH,
            # which would hit the `n == SEQUENCE_LENGTH` shortcut and make this
            # augmentation a partial no-op (the interpolation would survive but the
            # re-centering would silently not happen).
            result = center_on_peak_velocity(stretched, force=True)
        elif aug_type == 1:
            # Per-frame Gaussian noise. No [0,1] clip: coordinates are wrist-relative
            # after normalize_frame and legitimately fall outside [0,1].
            noise = rng.normal(0, 0.010, base.shape)
            result = base + noise
        elif aug_type == 2:
            # Random frame dropout — replace up to 4 frames with adjacent frame
            result = base.copy()
            n_drop = rng.integers(1, 5)
            drop_indices = rng.choice(SEQUENCE_LENGTH - 1, size=n_drop, replace=False)
            for idx in drop_indices:
                result[idx] = result[idx + 1]
        elif aug_type == 3:
            # In-plane rotation (camera tilt / signer lean). Normalization removes
            # translation and scale but leaves orientation unmodelled.
            degrees = rng.uniform(-ROTATION_MAX_DEGREES, ROTATION_MAX_DEGREES)
            result = rotate_sequence(base, float(np.radians(degrees)))
        elif aug_type == 4:
            result = landmark_dropout_sequence(base, rng)
        else:
            # Truncated prefix — a partial gesture padded the way inference pads it.
            keep = rng.uniform(PREFIX_KEEP_MIN, PREFIX_KEEP_MAX)
            result = truncated_prefix_sequence(base, float(keep))

        # Composable post-step: reproduce the phone's stale/repeated pose cadence on
        # a share of every augmentation type, rather than as a competing type that
        # only ~1/6 of samples ever drew.
        #
        # NOT applied on top of landmark dropout (type 4). Cadence resamples the pose
        # track by REUSING the newest completed pose, so running it after a dropout
        # both refills frames the dropout deliberately zeroed and relocates the zeros
        # to whichever frames the cadence lands on. On-device the two effects are
        # sequential, not nested: a failed detection overwrites lastPoseResult with an
        # empty result (so that frame's block really is 21 zeros), and the cadence then
        # holds THAT state. Composing them here would manufacture a pose track the
        # device never emits, which is the opposite of what this augmentation is for.
        if (POSE_CADENCE_AUGMENTATION_ENABLED and POSE_CADENCE_APPLY_RATIO > 0
                and aug_type != 4):
            if rng.random() < POSE_CADENCE_APPLY_RATIO:
                result = pose_cadence_sequence(np.asarray(result, dtype=np.float32))

        augmented.append(np.asarray(result, dtype=np.float32).tolist())

    return augmented
