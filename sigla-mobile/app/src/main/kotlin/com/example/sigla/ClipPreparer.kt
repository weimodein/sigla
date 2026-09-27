package com.example.sigla

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// ── Mirrored from sigla-ml/app/services/clip_prep.py and extract.py ───────────
// Tap mode prepares a recorded sign the way training clips were prepared, so
// these MUST equal their Python twins. test_mobile_parity_flags.py checks each
// one, and ClipPreparerParityTest pins the behaviour to Python-generated goldens.
internal const val TAP_SEQUENCE_LENGTH = 30             // preprocessor.SEQUENCE_LENGTH
internal const val TAP_FEATURE_SIZE = 147               // preprocessor.FEATURE_SIZE
internal const val TAP_TARGET_SAMPLE_FPS = 24.0         // clip_prep.TARGET_SAMPLE_FPS
internal const val TAP_MIN_DETECTED_HAND_FRAMES = 12    // clip_prep.MIN_DETECTED_HAND_FRAMES
internal const val TAP_MIN_HAND_COVERAGE = 0.35         // clip_prep.MIN_HAND_COVERAGE
internal const val TAP_MIN_POSE_COVERAGE = 0.75         // clip_prep.MIN_POSE_COVERAGE
internal const val TAP_MAX_MISSING_HAND_SECONDS = 0.25  // clip_prep.MAX_MISSING_HAND_SECONDS
internal const val TAP_MAX_ANALYZED_FRAMES = 120        // clip_prep.MAX_ANALYZED_FRAMES
internal const val TAP_TRIM_PAD_FRAMES = 4              // extract.TRIM_PAD_FRAMES
internal const val TAP_DEFAULT_SOURCE_FPS = 30.0        // extract.DEFAULT_SOURCE_FPS

/** One camera frame captured during a tap recording. [features] is the
 * NORMALIZED 147-float vector when MediaPipe detected a hand, null otherwise. */
class RecordedFrame(val timestampMs: Long, val features: FloatArray?)

/** Why a recording could not be classified. [code] equals clip_prep's REASON_*. */
enum class ClipRejection(val code: String) {
    NO_HANDS("no_hands"),
    MIN_HAND_FRAMES("min_hand_frames"),
    HAND_COVERAGE("hand_coverage"),
    POSE_COVERAGE("pose_coverage"),
    HAND_GAP("hand_gap"),
    TOO_SHORT("too_short"),
    TOO_SPARSE("too_sparse"),
    LOW_MOTION("low_motion"),
    WINDOW_POSE("window_pose"),
}

sealed class ClipOutcome {
    class Window(val frames: List<FloatArray>) : ClipOutcome()
    class Rejected(val reason: ClipRejection) : ClipOutcome()
}

/**
 * Turns one tap recording into the model's 30-frame input, step for step as
 * extract.py does for a training clip: trim → 24 fps sampling → drop hand-less
 * frames → quality gates → 30→60 stretch → peak-velocity window → window gates.
 *
 * Pure: no Android, camera or TFLite dependencies.
 */
object ClipPreparer {

    fun prepare(recording: List<RecordedFrame>): ClipOutcome {
        val fps = estimateSourceFps(recording)
        val span = trimToSigningSpan(recording, fps)
            ?: return ClipOutcome.Rejected(ClipRejection.NO_HANDS)
        val indices = sampleIndices(span.size, fps)
        val sampled = indices.map { span[it].features }
        return finalizeSampled(sampled, span.size, fps)
    }

    /** Average frame rate over the recording, from its timestamps. extract.py
     * reads the container's fps; the phone measures it. */
    internal fun estimateSourceFps(frames: List<RecordedFrame>): Double {
        if (frames.size < 2) return TAP_DEFAULT_SOURCE_FPS
        val durationMs = frames.last().timestampMs - frames.first().timestampMs
        if (durationMs <= 0) return TAP_DEFAULT_SOURCE_FPS
        val fps = (frames.size - 1) * 1000.0 / durationMs
        return if (fps.isFinite() && fps > 1.0) fps else TAP_DEFAULT_SOURCE_FPS
    }

    /**
     * First to last frame with a detected hand, padded by TRIM_PAD_FRAMES.
     *
     * Deliberate deviation from extract.py: the TRAILING pad is capped at
     * floor(MAX_MISSING_HAND_SECONDS × fps) frames. Training clips are ~30 fps,
     * where 4 pad frames are 0.13 s; on a phone throttled below 16 fps the same
     * 4 frames exceed the 0.25 s hand-gap limit and would reject every sign. At
     * 16 fps and above the cap is ≥ 4, so this is exactly extract.py's trim.
     */
    internal fun trimToSigningSpan(frames: List<RecordedFrame>, sourceFps: Double): List<RecordedFrame>? {
        val first = frames.indexOfFirst { it.features != null }
        if (first < 0) return null
        val last = frames.indexOfLast { it.features != null }
        val trailingPad = min(TAP_TRIM_PAD_FRAMES,
                              floor(TAP_MAX_MISSING_HAND_SECONDS * sourceFps).toInt())
        val start = max(first - TAP_TRIM_PAD_FRAMES, 0)
        val end = min(last + trailingPad, frames.size - 1)
        return frames.subList(start, end + 1)
    }

    /** clip_prep.sample_budget(). */
    internal fun sampleBudget(): Int {
        val neededForFloor = ceil(TAP_SEQUENCE_LENGTH / max(TAP_MIN_HAND_COVERAGE, 1e-6)).toInt()
        return min(max(TAP_SEQUENCE_LENGTH * 2, neededForFloor), TAP_MAX_ANALYZED_FRAMES)
    }

    /** clip_prep.sample_indices(...).indices, reproducing numpy's float64 maths. */
    internal fun sampleIndices(totalFrames: Int, sourceFps: Double): IntArray {
        val budget = sampleBudget()
        val stride = max(sourceFps / max(TAP_TARGET_SAMPLE_FPS, 1e-6), 1.0)
        val rateCount = floor(totalFrames / stride).toInt()
        if (rateCount >= TAP_SEQUENCE_LENGTH && rateCount <= budget) {
            return IntArray(rateCount) { k -> (k * stride).toInt().coerceIn(0, totalFrames - 1) }
        }
        return linspaceInt(0, totalFrames - 1, min(totalFrames, budget))
    }

    /** clip_prep.finalize_sampled(); see its docstring. */
    internal fun finalizeSampled(sampled: List<FloatArray?>, totalFrames: Int, sourceFps: Double): ClipOutcome {
        val sequence = ArrayList<FloatArray>()
        var analyzed = 0
        var handFrames = 0
        var poseFrames = 0
        var currentGap = 0
        var maxGap = 0
        for (vec in sampled) {
            analyzed++
            // No hand, or a collapsed detection: dropped, counted as a gap once
            // the sequence has started, never as a hand frame.
            if (vec == null || !handExtentOk(vec)) {
                if (sequence.isNotEmpty()) currentGap++
                continue
            }
            handFrames++
            if (posePresent(vec)) poseFrames++
            sequence.add(vec)
            if (currentGap > maxGap) maxGap = currentGap
            currentGap = 0
        }

        if (handFrames < TAP_MIN_DETECTED_HAND_FRAMES) return rejected(ClipRejection.MIN_HAND_FRAMES)
        val handCoverage = handFrames.toDouble() / max(analyzed, 1)
        if (handCoverage < TAP_MIN_HAND_COVERAGE) return rejected(ClipRejection.HAND_COVERAGE)
        val poseCoverage = poseFrames.toDouble() / max(handFrames, 1)
        if (poseCoverage < TAP_MIN_POSE_COVERAGE) return rejected(ClipRejection.POSE_COVERAGE)
        if (currentGap > maxGap) maxGap = currentGap
        val stride = if (analyzed > 0) totalFrames.toDouble() / analyzed else 1.0
        val maxGapSeconds = (maxGap * stride) / sourceFps
        if (maxGapSeconds > TAP_MAX_MISSING_HAND_SECONDS) return rejected(ClipRejection.HAND_GAP)
        if (sequence.size < TAP_SEQUENCE_LENGTH) {
            val observed = handFrames.toDouble() / max(analyzed, 1)
            val framesNeeded = ceil(TAP_SEQUENCE_LENGTH / max(observed, 1e-6)).toInt()
            return if (analyzed < framesNeeded && totalFrames <= sampleBudget()) {
                rejected(ClipRejection.TOO_SHORT)
            } else {
                rejected(ClipRejection.TOO_SPARSE)
            }
        }

        val seq = if (sequence.size == TAP_SEQUENCE_LENGTH) {
            stretchLinear(sequence, TAP_SEQUENCE_LENGTH * 2)
        } else {
            sequence
        }
        val window = centerOnPeakVelocity(seq)
        if (!hasSufficientMotion(window)) return rejected(ClipRejection.LOW_MOTION)
        if (!hasSufficientPoseCoverage(window)) return rejected(ClipRejection.WINDOW_POSE)
        return ClipOutcome.Window(window)
    }

    private fun rejected(reason: ClipRejection) = ClipOutcome.Rejected(reason)

    /** numpy.linspace(start, stop, num, dtype=int): i*step + start in float64, then floor. */
    internal fun linspaceInt(start: Int, stop: Int, num: Int): IntArray {
        if (num <= 0) return IntArray(0)
        if (num == 1) return intArrayOf(start)
        val step = (stop - start).toDouble() / (num - 1)
        return IntArray(num) { i -> if (i == num - 1) stop else floor(i * step + start).toInt() }
    }

    /** Per-column numpy.interp over linspace(0, n-1, target); extract.py's 30→60 resample. */
    internal fun stretchLinear(frames: List<FloatArray>, target: Int): List<FloatArray> {
        val n = frames.size
        val width = frames[0].size
        val step = (n - 1).toDouble() / (target - 1)
        return List(target) { i ->
            val x = if (i == target - 1) (n - 1).toDouble() else i * step
            val j = min(floor(x).toInt(), n - 2)
            val t = x - j
            FloatArray(width) { c ->
                val y0 = frames[j][c].toDouble()
                val y1 = frames[j + 1][c].toDouble()
                ((y1 - y0) * t + y0).toFloat()
            }
        }
    }

    /** preprocessor.center_on_peak_velocity(force=True). */
    internal fun centerOnPeakVelocity(frames: List<FloatArray>): List<FloatArray> {
        val n = frames.size
        val peak = peakVelocityIndex(frames)
        val half = TAP_SEQUENCE_LENGTH / 2
        var start = max(peak - half, 0)
        var end = start + TAP_SEQUENCE_LENGTH
        if (end > n) {
            end = n
            start = max(end - TAP_SEQUENCE_LENGTH, 0)
        }
        val window = frames.subList(start, end).toMutableList()
        while (window.size < TAP_SEQUENCE_LENGTH) window.add(window.last())
        return window
    }
}
