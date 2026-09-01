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
    A clip is rejected for a dropout run longer than the phone tolerates.

    Live, NO_HAND_TIMEOUT consecutive hands-less frames end the gesture and reset
    the buffer, so a longer run cannot occur inside a single classified window.
    """
    from app.services.extract import MAX_CONSECUTIVE_MISSING_FRAMES

    kotlin = _kotlin_int(_read(_PREDICTION_SERVICE), "NO_HAND_TIMEOUT")
    assert MAX_CONSECUTIVE_MISSING_FRAMES <= kotlin, (
        "MAX_CONSECUTIVE_MISSING_FRAMES must not exceed the phone's NO_HAND_TIMEOUT; "
        "otherwise extraction accepts gaps that end the gesture on-device."
    )


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
