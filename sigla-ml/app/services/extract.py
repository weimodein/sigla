import os
import tempfile
import numpy as np
import cv2

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from app.utils.preprocessor import (
    center_on_peak_velocity,
    frame_velocity,
    normalize_sequence,
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
)

MIN_DETECTED_HAND_FRAMES = int(os.getenv("MIN_DETECTED_HAND_FRAMES", 12))
MIN_HAND_COVERAGE = float(os.getenv("MIN_HAND_COVERAGE", 0.35))
MIN_POSE_COVERAGE = float(os.getenv("MIN_POSE_COVERAGE", 0.75))
MIN_SEQUENCE_MOTION = float(os.getenv("MIN_SEQUENCE_MOTION", 0.50))

# Longest tolerated run of consecutive hands-less frames once signing has started.
#
# MIN_HAND_COVERAGE bounds the TOTAL missing fraction but says nothing about how
# that loss is distributed: one 35-frame blackout and 35 single-frame flickers
# score identically, yet only the second is a recoverable recording. Live, a run
# this long trips NO_HAND_TIMEOUT (6 frames) and resets the buffer outright, so a
# clip containing one is not a gesture the phone could ever classify.
# MIN_SEQUENCE_MOTION does not catch it either — dropped frames contribute no
# velocity at all, so the surviving frames can carry the total over the line.
# Kept equal to PredictionService.NO_HAND_TIMEOUT on purpose.
MAX_CONSECUTIVE_MISSING_FRAMES = int(os.getenv("MAX_CONSECUTIVE_MISSING_FRAMES", 6))

# Hard ceiling on frames analyzed per clip. The sampling budget scales with
# MIN_HAND_COVERAGE (see extract_motion_landmarks) so a low coverage floor stays
# reachable; this bounds the cost of that, since each analyzed frame runs a hand
# detection and, when hands are found, a pose detection too.
MAX_ANALYZED_FRAMES = int(os.getenv("MAX_ANALYZED_FRAMES", 120))

# Pose coverage over the STORED 30-frame window, as a fraction of that window.
#
# MIN_POSE_COVERAGE (above) uses detected_hand_frames as its denominator, which
# answers a different question than the phone asks. PredictionService's
# hasSufficientPoseCoverage requires MIN_POSE_FRAMES (24) of the 30-frame window
# to carry a pose block — a fraction of the WINDOW, not of the frames that
# happened to have hands. With hand coverage allowed down to 0.35 those two
# diverge sharply: a clip can clear "80% of hand frames" while the equivalent
# live window sits far below 24/30 and is refused outright. Training on windows
# the phone would reject is exactly the skew this closes. 24/30 = 0.80.
MIN_POSE_WINDOW_COVERAGE = float(os.getenv("MIN_POSE_WINDOW_COVERAGE", 24.0 / 30.0))


class ExtractionQualityError(ValueError):
    """The video decoded, but does not contain enough reliable training signal."""

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


def extract_motion_landmarks(video_bytes: bytes, filename: str | None = None) -> list[list[float]] | None:
    """
    Extract a 30-frame motion sequence from a video.
    Samples up to twice SEQUENCE_LENGTH evenly-spaced frames, then centers on peak velocity.
    Returns None if no hands detected.
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

        # Sample enough frames that a clip at the MIN_HAND_COVERAGE floor can still
        # yield SEQUENCE_LENGTH frames WITH a hand in them.
        #
        # This used to be SEQUENCE_LENGTH * 2 (60). Combined with the no-padding
        # floor below, that silently pinned the real minimum hand coverage at
        # 30/60 = 0.50 no matter what MIN_HAND_COVERAGE said — so lowering that
        # setting to 0.35 would have had no effect at all, and every clip it was
        # meant to admit would still have been rejected, just with a different
        # message. Scale the budget with the configured floor instead, and keep a
        # ceiling so a long recording cannot blow up extraction time.
        needed_for_floor = int(np.ceil(SEQUENCE_LENGTH / max(MIN_HAND_COVERAGE, 1e-6)))
        sample_budget = min(max(SEQUENCE_LENGTH * 2, needed_for_floor), MAX_ANALYZED_FRAMES)
        sample_count = min(total_frames, sample_budget)
        indices = np.linspace(0, total_frames - 1, sample_count, dtype=int)
        sequence = []
        analyzed_frames = 0
        detected_hand_frames = 0
        detected_pose_frames = 0
        # Longest run of consecutive analyzed frames with no detected hand, counted
        # only once the sequence has started (leading hand-less frames are not a gap).
        current_gap = 0
        max_consecutive_gap = 0

        with _make_landmarker() as landmarker, _make_pose_landmarker() as pose_landmarker:
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
                ret, frame = cap.read()
                if not ret:
                    continue
                analyzed_frames += 1
                result = _detect(landmarker, frame)
                if result.hand_landmarks:
                    detected_hand_frames += 1
                    # Pose is only detected on frames that have hands — matches
                    # HandLandmarkHelper.detect() (IMAGE-mode / offline extraction path).
                    pose_result = _detect_pose(pose_landmarker, frame)
                    pose_landmarks = (
                        pose_result.pose_landmarks[0]
                        if pose_result.pose_landmarks else None
                    )
                    if pose_landmarks is not None:
                        detected_pose_frames += 1
                    sequence.append(_build_feature_vector(result.hand_landmarks, pose_landmarks))
                    if current_gap > max_consecutive_gap:
                        max_consecutive_gap = current_gap
                    current_gap = 0
                elif sequence:
                    # A frame with no detected hand is DROPPED, not repeated.
                    #
                    # It used to append sequence[-1], which is the one thing live
                    # inference never does: PredictionService.processFrame buffers
                    # nothing on a hands-less frame and, after NO_HAND_TIMEOUT of
                    # them, flushes and resets. Repeating here taught the model that
                    # long frozen stretches are part of a gesture, a pattern the
                    # phone cannot reproduce — pure train/serve skew, and it grew
                    # worse when MIN_HAND_COVERAGE was lowered to admit clips whose
                    # hands leave frame for most of the take.
                    #
                    # The gap is still counted so the run-length gate below can
                    # reject a clip that is mostly one long dropout.
                    current_gap += 1

        if detected_hand_frames < MIN_DETECTED_HAND_FRAMES:
            raise ExtractionQualityError(
                f"Only {detected_hand_frames} frames had a detectable hand; "
                f"at least {MIN_DETECTED_HAND_FRAMES} are required. Keep the hand "
                "fully visible and record the complete sign."
            )

        hand_coverage = detected_hand_frames / max(analyzed_frames, 1)
        if hand_coverage < MIN_HAND_COVERAGE:
            raise ExtractionQualityError(
                f"A hand was visible in only {hand_coverage:.0%} of analyzed frames; "
                f"at least {MIN_HAND_COVERAGE:.0%} is required. Keep the signing "
                "hand(s) inside the frame for the whole clip."
            )

        pose_coverage = detected_pose_frames / max(detected_hand_frames, 1)
        if pose_coverage < MIN_POSE_COVERAGE:
            raise ExtractionQualityError(
                f"Upper-body pose was visible in only {pose_coverage:.0%} of hand "
                f"frames; at least {MIN_POSE_COVERAGE:.0%} is required. Frame the "
                "head, shoulders, elbows, wrists, and hands."
            )

        # Trailing gap counts too: a clip whose hands leave and never return ends
        # with current_gap unflushed, and that is precisely the "hand exits early"
        # recording this gate exists to reject.
        if current_gap > max_consecutive_gap:
            max_consecutive_gap = current_gap
        if max_consecutive_gap > MAX_CONSECUTIVE_MISSING_FRAMES:
            raise ExtractionQualityError(
                f"The signing hand left the frame for {max_consecutive_gap} frames in a "
                f"row; at most {MAX_CONSECUTIVE_MISSING_FRAMES} are allowed. Re-record "
                "with the hand(s) staying in view — a dropout this long ends the "
                "gesture on-device instead of being classified."
            )

        # Dropping (rather than repeating) hands-less frames means `sequence` is now
        # exactly the count of frames that had a hand. If that is under
        # SEQUENCE_LENGTH, center_on_peak_velocity pads the remainder by repeating
        # the LAST frame — reintroducing through the windower exactly the frozen
        # padding the drop above removed, and with no window choice at all.
        #
        # MIN_DETECTED_HAND_FRAMES (12) is far too low to prevent this: a clip at the
        # 0.35 coverage floor over 60 analyzed frames yields 21 real frames, so 9 of
        # the stored 30 would be one repeated frame. Require a full window of real
        # frames instead, and say so plainly rather than silently storing padding.
        if len(sequence) < SEQUENCE_LENGTH:
            # Distinguish the two causes, because the fix differs. A clip can be too
            # SHORT (few frames to sample) or too SPARSE (long enough, but the hand
            # is rarely in view). Reporting "not enough hand frames" for a 1.5 s clip
            # sends the signer off to re-frame their hands when the real problem is
            # that they need to record for longer.
            observed = detected_hand_frames / max(analyzed_frames, 1)
            frames_needed = int(np.ceil(SEQUENCE_LENGTH / max(observed, 1e-6)))
            if analyzed_frames < frames_needed and total_frames <= sample_budget:
                raise ExtractionQualityError(
                    f"The clip is too short: {len(sequence)} of {analyzed_frames} "
                    f"analyzed frames had a detectable hand, but {SEQUENCE_LENGTH} "
                    "are needed to fill the model's window without padding. At this "
                    f"hand visibility ({observed:.0%}) the clip needs roughly "
                    f"{frames_needed} frames (~{frames_needed / 30.0:.1f}s at 30fps). "
                    "Record for longer, or keep the hand(s) in frame more of the time."
                )
            raise ExtractionQualityError(
                f"Only {len(sequence)} of {analyzed_frames} analyzed frames had a "
                f"detectable hand, but {SEQUENCE_LENGTH} are needed to fill the "
                "model's window without padding. Keep the signing hand(s) in frame "
                "for more of the clip."
            )

        seq_np = np.array(sequence, dtype=np.float32)
        # Normalize BEFORE windowing, not after — matches the mobile pipeline
        # (HandLandmarkHelper normalizes each frame as it's captured, then
        # PredictionService/CollectionActivity window the normalized buffer).
        # Picking the peak-velocity window on raw image-space coordinates instead
        # measures whole-hand/arm translation across the frame, not just intra-hand
        # articulation, so it can select a different moment of the gesture than what
        # live inference's extractMotionWindow() would pick for the same clip.
        seq_np = normalize_sequence(seq_np)

        # A sequence of EXACTLY SEQUENCE_LENGTH frames cannot be windowed: the only
        # possible window is [0:SEQUENCE_LENGTH], the clip unchanged. It used to hit
        # center_on_peak_velocity's `n == SEQUENCE_LENGTH` early return and get stored
        # with no window ever chosen — the velocity signal was never consulted.
        #
        # This is easy to land on. `sequence` is not `sample_count`: leading frames
        # with no detected hand are dropped entirely (the `elif sequence:` above only
        # appends once the sequence has started), so a 45-frame clip whose signer's
        # hands enter 15 frames in survives at exactly 30. With 1-2 s source clips
        # that was most of the dataset.
        #
        # Resample slightly above SEQUENCE_LENGTH so the windower always has real
        # choice. Linear interpolation along the time axis preserves the trajectory;
        # it only changes where frame boundaries fall.
        if len(seq_np) == SEQUENCE_LENGTH:
            target = SEQUENCE_LENGTH * 2
            src = np.linspace(0, SEQUENCE_LENGTH - 1, target)
            seq_np = np.array(
                [np.interp(src, np.arange(SEQUENCE_LENGTH), seq_np[:, c])
                 for c in range(seq_np.shape[1])],
                dtype=np.float32,
            ).T

        # force=True so the shortcut can never silently fire here again, even if the
        # resample above is ever removed or bypassed.
        seq_np = center_on_peak_velocity(seq_np, force=True)

        if len(seq_np) != SEQUENCE_LENGTH:
            print(f"[extract] WARNING: windowed sequence is {len(seq_np)} frames, "
                  f"expected {SEQUENCE_LENGTH} — refusing to store a wrong-width sample")
            return None

        # Motion energy of the FINAL stored window, not of the pre-window sequence.
        #
        # frame_velocity is summed over len(seq)-1 transitions, so the total scales
        # with how many frames were sampled. Measuring it before windowing made the
        # threshold mean different things for different clips — and once the sampling
        # budget started scaling with MIN_HAND_COVERAGE (up to MAX_ANALYZED_FRAMES
        # rather than a fixed 60), a long clip could clear a gate that an equally
        # static short one failed, purely from having more terms in the sum.
        # The stored window is always SEQUENCE_LENGTH frames, so the same number now
        # means the same thing for every clip — and it gates what is actually trained
        # on rather than material the windower may have discarded.
        motion_energy = sum(
            frame_velocity(seq_np[i - 1], seq_np[i])
            for i in range(1, len(seq_np))
        )
        if motion_energy < MIN_SEQUENCE_MOTION:
            raise ExtractionQualityError(
                f"The stored window contains too little gesture motion "
                f"({motion_energy:.3f}); minimum is {MIN_SEQUENCE_MOTION:.3f}. "
                "Record the complete movement, not a held pose or frozen clip."
            )

        # Pose coverage of the FINAL stored window, in the same terms the phone
        # uses (see MIN_POSE_WINDOW_COVERAGE). Checked here, after windowing,
        # because only now do we know which 30 frames are actually kept: the
        # earlier hand-frame-denominated gate can pass while the selected window
        # is the pose-poor part of the clip.
        window_pose_frames = int(
            sum(1 for f in seq_np if np.any(f[POSE_BASE:POSE_BASE + 21]))
        )
        window_pose_coverage = window_pose_frames / SEQUENCE_LENGTH
        if window_pose_coverage < MIN_POSE_WINDOW_COVERAGE:
            raise ExtractionQualityError(
                f"Upper-body pose is present in only {window_pose_frames}/"
                f"{SEQUENCE_LENGTH} frames of the stored window "
                f"({window_pose_coverage:.0%}); at least "
                f"{MIN_POSE_WINDOW_COVERAGE:.0%} is required. The app refuses to "
                "classify a window this sparse, so it cannot be trained on either."
            )
        return seq_np.tolist()
    finally:
        # Release the capture BEFORE unlinking — on Windows the file stays
        # locked until this happens, otherwise os.unlink raises WinError 32
        # and masks whatever actually went wrong above.
        cap.release()
        os.unlink(tmp_path)
