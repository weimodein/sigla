"""
Cross-language guards.

These read the real Kotlin sources rather than a copy of their values, so a change
on the mobile side is caught here instead of silently desynchronising the pipeline.
Constants that MUST agree across the two languages are asserted pair-by-pair.
"""
import os
import re

import pytest

_ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_MOBILE = os.path.abspath(os.path.join(
    _ML_ROOT, "..", "sigla-mobile", "app", "src", "main", "kotlin", "com", "example", "sigla"
))

_MAIN_ACTIVITY = os.path.join(_MOBILE, "MainActivity.kt")
_PREDICTION_SERVICE = os.path.join(_MOBILE, "PredictionService.kt")
_LANDMARK_HELPER = os.path.join(_MOBILE, "HandLandmarkHelper.kt")

pytestmark = pytest.mark.skipif(
    not os.path.isdir(_MOBILE),
    reason="sigla-mobile checkout not present next to sigla-ml",
)


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _kotlin_const(source: str, name: str) -> str:
    m = re.search(rf"\bval\s+{re.escape(name)}\s*(?::\s*\w+\s*)?=\s*([^\s/]+)", source)
    assert m, f"constant {name} not found in Kotlin source"
    return m.group(1).strip().rstrip("f")


def _kotlin_bool(source: str, name: str) -> bool:
    raw = _kotlin_const(source, name)
    assert raw in ("true", "false"), f"{name} is not a boolean literal: {raw!r}"
    return raw == "true"


def _kotlin_int(source: str, name: str) -> int:
    return int(_kotlin_const(source, name))


def test_slot_canonicalization_stays_paired():
    """
    preprocessor must not canonicalize slots unless the phone does too.

    A mismatch here is exactly what sank the first attempt at this feature: the
    model trains on one slot ordering and inference feeds the other, silently.
    The Python side currently does NOT call canonicalize_slots(), so the Kotlin
    flag must be off as well.
    """
    from app.utils import preprocessor

    src = _read(preprocessor.__file__.replace(".pyc", ".py"))
    body = src.split("def prepare_motion_dataset", 1)[0]
    python_calls = bool(re.search(r"^\s*seq\s*=\s*canonicalize_slots\(", body, re.M))

    kotlin_enabled = _kotlin_bool(_read(_MAIN_ACTIVITY), "SLOT_CANONICALIZATION_ENABLED")
    assert python_calls == kotlin_enabled, (
        "SLOT_CANONICALIZATION_ENABLED (Kotlin) and the canonicalize_slots() call in "
        "_load_real_sequences must be enabled or disabled TOGETHER. "
        f"python_calls={python_calls} kotlin_enabled={kotlin_enabled}"
    )


def test_chirality_convention_matches():
    from app.utils.preprocessor import _CHIRALITY_RIGHT_IS_NEGATIVE_CROSS

    kotlin = _kotlin_bool(_read(_MAIN_ACTIVITY), "CHIRALITY_RIGHT_IS_NEGATIVE_CROSS")
    assert kotlin == _CHIRALITY_RIGHT_IS_NEGATIVE_CROSS


def test_pose_cadence_matches_device_interval():
    """The cadence augmentation must model the interval the phone actually uses."""
    from app.utils.preprocessor import POSE_CADENCE_INTERVAL

    kotlin = _kotlin_int(_read(_LANDMARK_HELPER), "POSE_DETECT_INTERVAL")
    assert kotlin == POSE_CADENCE_INTERVAL, (
        "POSE_CADENCE_INTERVAL (training augmentation) must equal the phone's "
        "POSE_DETECT_INTERVAL, or training models a cadence the device never emits."
    )


def test_missing_frame_gate_matches_no_hand_timeout():
    """
    A clip is rejected for a dropout longer than the phone tolerates.

    Live, NO_HAND_TIMEOUT consecutive CAMERA frames end the gesture and reset the
    buffer. Extraction subsamples, so its gate is expressed in SECONDS and must
    correspond to that same wall-clock duration at the app's minimum frame rate.
    """
    from app.services.extract import MAX_MISSING_HAND_SECONDS

    no_hand_frames = _kotlin_int(_read(_PREDICTION_SERVICE), "NO_HAND_TIMEOUT")
    min_fps = _kotlin_int(_read(_MAIN_ACTIVITY), "MIN_ACCEPTABLE_FPS")
    device_seconds = no_hand_frames / min_fps

    assert abs(MAX_MISSING_HAND_SECONDS - device_seconds) < 1e-6, (
        f"MAX_MISSING_HAND_SECONDS ({MAX_MISSING_HAND_SECONDS}) must equal the "
        f"phone's NO_HAND_TIMEOUT/MIN_ACCEPTABLE_FPS "
        f"({no_hand_frames}/{min_fps} = {device_seconds:.4f}s)."
    )


def test_gap_gate_is_measured_in_time_not_sampled_frames():
    """
    The dropout gate must convert sampled frames to seconds.

    Extraction analyzes only `sample_budget` frames spread across the whole video,
    so one sampled frame spans `total_frames / analyzed_frames` real ones. Counting
    sampled frames directly made the gate mean 0.21s on a 3s/30fps clip and 0.70s
    on a 10s/60fps one — the same recording passing or failing on length alone.
    """
    from app.services import extract

    src = _read(extract.__file__.replace(".pyc", ".py"))
    assert "MAX_CONSECUTIVE_MISSING_FRAMES" not in src, (
        "the frame-counted gap gate is back; it is length-dependent by construction"
    )
    assert "stride = (total_frames / analyzed_frames)" in src, (
        "the gap must be scaled by the sampling stride before comparing to seconds"
    )
    assert "CAP_PROP_FPS" in src, "source fps must be read to convert frames to time"


def test_pose_window_coverage_matches_device_gate():
    """Server-side stored-window pose gate must match hasSufficientPoseCoverage."""
    from app.services.extract import MIN_POSE_WINDOW_COVERAGE
    from app.utils.preprocessor import SEQUENCE_LENGTH

    src = _read(_PREDICTION_SERVICE)
    min_pose_frames = _kotlin_int(src, "MIN_POSE_FRAMES")
    expected = min_pose_frames / SEQUENCE_LENGTH
    assert abs(MIN_POSE_WINDOW_COVERAGE - expected) < 1e-9, (
        f"MIN_POSE_WINDOW_COVERAGE ({MIN_POSE_WINDOW_COVERAGE}) must equal "
        f"MIN_POSE_FRAMES/SEQUENCE_LENGTH ({min_pose_frames}/{SEQUENCE_LENGTH})."
    )


def test_layout_constants_match():
    """FEATURE_SIZE / SEQUENCE_LENGTH / POSE_KEYPOINTS must agree across languages."""
    from app.utils.preprocessor import FEATURE_SIZE, SEQUENCE_LENGTH
    from app.services.extract import _POSE_KEYPOINTS

    helper = _read(_LANDMARK_HELPER)
    assert _kotlin_int(helper, "FEATURE_SIZE") == FEATURE_SIZE
    assert _kotlin_int(_read(_PREDICTION_SERVICE), "SEQUENCE_LENGTH") == SEQUENCE_LENGTH

    m = re.search(r"POSE_KEYPOINTS\s*=\s*intArrayOf\(([^)]*)\)", helper)
    assert m, "POSE_KEYPOINTS not found"
    kotlin_kps = [int(x) for x in m.group(1).split(",") if x.strip()]
    assert kotlin_kps == list(_POSE_KEYPOINTS)


def test_offline_reference_path_pairs_pose_with_same_frame():
    """
    HandLandmarkHelper.detect() is the documented reference for extract.py's
    offline path: pose is detected ONLY on frames that have hands, from the SAME
    image. It has no production caller, so nothing else would notice it drifting.
    """
    src = _read(_LANDMARK_HELPER)
    m = re.search(
        r"fun detect\(bitmap: Bitmap\): LandmarkResult \{(.+?)\n    \}", src, re.S
    )
    assert m, "HandLandmarkHelper.detect() not found — if it was deleted, delete this test"
    body = m.group(1)
    assert "poseLandmarker?.detect(mpImage)" in body, (
        "detect() must run pose on the SAME mpImage as the hands (extract.py parity)"
    )
    assert "result.landmarks().isNotEmpty()" in body, (
        "detect() must gate pose on hands being present, matching extract.py"
    )


def test_extraction_drops_rather_than_repeats_missing_hand_frames():
    """
    extract.py must not re-introduce the repeat-last-frame gap fill.

    Live, a hands-less frame is never buffered (PredictionService.processFrame
    returns early), so repeating one during extraction is pure train/serve skew.
    """
    from app.services import extract

    src = _read(extract.__file__.replace(".pyc", ".py"))
    assert "sequence.append(sequence[-1])" not in src, (
        "extract.py repeats the previous frame on a hands-less frame again; the "
        "phone drops those frames instead. See MAX_CONSECUTIVE_MISSING_FRAMES."
    )


def test_sampling_budget_makes_coverage_floor_reachable():
    """
    The frame budget must let a clip at MIN_HAND_COVERAGE still yield a full
    window of REAL frames.

    Hands-less frames are dropped, and a sequence shorter than SEQUENCE_LENGTH is
    rejected rather than padded. With a fixed SEQUENCE_LENGTH*2 budget those two
    rules silently pinned the true coverage floor at 0.50 regardless of what
    MIN_HAND_COVERAGE was set to, so lowering the setting did nothing.
    """
    import numpy as np

    from app.services.extract import (
        MAX_ANALYZED_FRAMES,
        MIN_HAND_COVERAGE,
    )
    from app.utils.preprocessor import SEQUENCE_LENGTH

    needed = int(np.ceil(SEQUENCE_LENGTH / max(MIN_HAND_COVERAGE, 1e-6)))
    budget = min(max(SEQUENCE_LENGTH * 2, needed), MAX_ANALYZED_FRAMES)
    effective_floor = SEQUENCE_LENGTH / budget

    assert effective_floor <= MIN_HAND_COVERAGE + 1e-9, (
        f"effective hand-coverage floor is {effective_floor:.2f} but "
        f"MIN_HAND_COVERAGE is {MIN_HAND_COVERAGE:.2f} — raise MAX_ANALYZED_FRAMES "
        "or the setting is a no-op."
    )


def test_no_padding_floor_is_enforced():
    """A stored window must be all real frames — never repeat-padded."""
    from app.services import extract

    src = _read(extract.__file__.replace(".pyc", ".py"))
    assert "if len(sequence) < SEQUENCE_LENGTH:" in src, (
        "extract.py must reject short sequences instead of letting "
        "center_on_peak_velocity pad them by repeating the last frame."
    )


def test_motion_gate_measures_the_stored_window():
    """
    MIN_SEQUENCE_MOTION must be applied to the final SEQUENCE_LENGTH window.

    frame_velocity is SUMMED over transitions, so measuring the pre-window
    sequence made the threshold length-dependent: once the sampling budget began
    scaling with MIN_HAND_COVERAGE, a long clip could clear a gate that an equally
    static short one failed, purely from having more terms in the sum.
    """
    from app.services import extract

    src = _read(extract.__file__.replace(".pyc", ".py"))
    window_at = src.find("center_on_peak_velocity(seq_np, force=True)")
    motion_at = src.find("motion_energy = sum(")
    assert window_at != -1 and motion_at != -1
    assert motion_at > window_at, (
        "the motion-energy gate must run AFTER center_on_peak_velocity, so it "
        "measures the fixed-length stored window rather than a variable-length "
        "pre-window sequence."
    )


def _kotlin_float(source: str, name: str) -> float:
    return float(_kotlin_const(source, name))


def test_sequence_motion_gate_matches_device():
    """
    MIN_SEQUENCE_MOTION must mean the same thing offline and live.

    extract.py refuses to STORE a window whose summed frame-to-frame velocity is
    below this floor ("a held pose or frozen clip"). PredictionService applies the
    same floor to the window it is about to classify. Both sum frame_velocity /
    frameVelocity over the SEQUENCE_LENGTH window, so the numbers are directly
    comparable — but only while they stay equal, which nothing but this test
    enforces. A device floor BELOW the training floor lets the phone classify
    windows no training sample could ever have looked like.
    """
    from app.services.extract import MIN_SEQUENCE_MOTION

    kotlin = _kotlin_float(_read(_PREDICTION_SERVICE), "MIN_SEQUENCE_MOTION")
    assert abs(kotlin - MIN_SEQUENCE_MOTION) < 1e-6, (
        f"PredictionService.MIN_SEQUENCE_MOTION ({kotlin}) must equal extract.py's "
        f"MIN_SEQUENCE_MOTION ({MIN_SEQUENCE_MOTION})."
    )


def test_fire_floor_leaves_no_padding_only_windows():
    """
    A window the phone may FIRE on must be mostly real frames.

    extractMotionWindow pads a short buffer by repeating its last frame, so the
    firing floor sets how much of the model's input may be frozen padding. Stored
    training samples always carry at least SEQUENCE_LENGTH real frames, so a window
    that is mostly padding is out of distribution by construction.

    Asserted as a RATIO rather than a fixed number so SEQUENCE_LENGTH can change
    without silently loosening the guarantee.
    """
    from app.utils.preprocessor import SEQUENCE_LENGTH

    src = _read(_PREDICTION_SERVICE)
    fire_floor = _kotlin_int(src, "MIN_REAL_FRAMES_FOR_FIRE")
    run_floor = _kotlin_int(src, "MIN_MOTION_FRAMES")

    assert fire_floor >= run_floor, (
        "MIN_REAL_FRAMES_FOR_FIRE must not be below MIN_MOTION_FRAMES — inference "
        "may run early to build a streak, but firing needs at least as much evidence."
    )
    real_ratio = fire_floor / SEQUENCE_LENGTH
    assert real_ratio >= 0.60, (
        f"firing at {fire_floor} real frames means {SEQUENCE_LENGTH - fire_floor} of "
        f"{SEQUENCE_LENGTH} model inputs ({1 - real_ratio:.0%}) are repeated padding; "
        "no stored training sample looks like that."
    )


def test_mirror_augmentation_and_camera_scope_stay_paired():
    """
    Mirror augmentation is what makes the model work on BOTH camera orientations.

    The front camera delivers a horizontally flipped image. Training on mirrored
    copies is the only thing that covers it — measured at 96.1% -> 24.8% when clips
    were mirrored against a non-mirror-augmented model (see MainActivity's
    LEFT_HANDED_SUPPORT_ENABLED comment).

    So the two must move together: if the app can select the front camera, training
    MUST mirror-augment. Pinning the lens (FORCE_BACK_CAMERA_ONLY) is what makes
    disabling mirroring safe. Re-enabling the camera toggle without re-enabling
    mirroring silently reintroduces that collapse, which is the failure this pairs
    against — the same trap as SLOT_CANONICALIZATION_ENABLED.
    """
    from app.utils.preprocessor import MIRROR_AUGMENTATION_ENABLED

    back_only = _kotlin_bool(_read(_MAIN_ACTIVITY), "FORCE_BACK_CAMERA_ONLY")
    assert MIRROR_AUGMENTATION_ENABLED or back_only, (
        "MIRROR_AUGMENTATION_ENABLED is off while the app can still select the "
        "front camera. Either pin the lens (FORCE_BACK_CAMERA_ONLY=true) or turn "
        "mirror augmentation back on — a flipped image against a non-mirrored "
        "model is the measured 24.8% case."
    )


def test_offline_sampling_rate_matches_device_fps_floor():
    """
    Extraction must sample a clip at the rate the phone actually delivers.

    TARGET_SAMPLE_FPS controls how much wall-clock time one analyzed frame covers.
    If it drifts from the device's MIN_ACCEPTABLE_FPS floor, the stored 30-frame
    window spans a different real duration than the live one, and the LSTM sees a
    speed difference the signer never made.
    """
    from app.services.extract import TARGET_SAMPLE_FPS

    device_floor = _kotlin_int(_read(_MAIN_ACTIVITY), "MIN_ACCEPTABLE_FPS")
    assert abs(TARGET_SAMPLE_FPS - device_floor) < 1e-6, (
        f"extract.TARGET_SAMPLE_FPS ({TARGET_SAMPLE_FPS}) must equal "
        f"MainActivity.MIN_ACCEPTABLE_FPS ({device_floor})."
    )
