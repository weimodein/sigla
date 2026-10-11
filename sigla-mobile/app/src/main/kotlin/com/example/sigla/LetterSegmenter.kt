package com.example.sigla

import kotlin.math.hypot

// MUST equal sigla-ml app/utils/letters.py SEGMENT_CONFIG / MOTION_FRAMES —
// test_mobile_parity_flags.py reads these lines; LetterParityTest replays a
// Python-recorded stream. Speeds are hand sizes per second.
internal const val LETTER_MOTION_FRAMES = 32
internal const val LETTER_START_SPEED = 1.0f
internal const val LETTER_STOP_SPEED = 0.5f
internal const val LETTER_STOP_HOLD_MS = 200L
internal const val LETTER_PAD_MS = 150L
internal const val LETTER_MIN_MS = 300L
internal const val LETTER_MAX_MS = 2500L
internal const val LETTER_MAX_MISSING = 0.25f

/** Finds hand movements in the live stream and resamples each to 32 frames. */
internal class LetterSegmenter {

    /** [startMs] is the movement start minus the pad; [frames] is 32 × 63. */
    class Segment(val startMs: Long, val endMs: Long, val frames: Array<FloatArray>)

    data class Output(val moving: Boolean, val segment: Segment?)

    private class Frame(val tMs: Long, val hand: FloatArray?)

    private val buffer = ArrayDeque<Frame>()
    private var prev: Frame? = null
    private val speeds = ArrayDeque<Float>()
    private var moving = false
    private var startMs = 0L
    private var belowSinceMs: Long? = null
    private var lastHandMs: Long? = null

    fun onFrame(tMs: Long, hand: FloatArray?): Output {
        val frame = Frame(tMs, hand)
        buffer.addLast(frame)
        while (tMs - buffer.first().tMs > LETTER_MAX_MS + LETTER_PAD_MS + LETTER_STOP_HOLD_MS) buffer.removeFirst()
        val smoothed = smoothedSpeed(frame)
        prev = frame
        if (hand != null) lastHandMs = tMs

        if (!moving) {
            if (smoothed != null && smoothed > LETTER_START_SPEED) {
                moving = true
                startMs = tMs
                belowSinceMs = null
            }
            return Output(moving, null)
        }

        val endMs: Long? = when {
            hand == null -> lastHandMs?.takeIf { tMs - it > LETTER_STOP_HOLD_MS }
            smoothed == null -> null
            smoothed < LETTER_STOP_SPEED -> {
                val since = belowSinceMs ?: tMs.also { belowSinceMs = it }
                since.takeIf { tMs - it >= LETTER_STOP_HOLD_MS }
            }
            else -> {
                belowSinceMs = null
                null
            }
        }
        if (endMs == null) return Output(true, null)
        moving = false
        belowSinceMs = null
        return Output(false, buildSegment(startMs - LETTER_PAD_MS, endMs))
    }

    fun reset() {
        buffer.clear()
        prev = null
        speeds.clear()
        moving = false
        belowSinceMs = null
        lastHandMs = null
    }

    private fun smoothedSpeed(frame: Frame): Float? {
        val cur = frame.hand
        if (cur == null) {
            speeds.clear()
            return null
        }
        val p = prev ?: return null
        val before = p.hand ?: return null
        val dtSec = (frame.tMs - p.tMs) / 1000f
        val size = LetterHand.extent(cur)
        if (dtSec <= 0f || size <= 0f) return null
        var moved = 0f
        for (i in 0 until LETTER_POINTS) moved += hypot(cur[i * 3] - before[i * 3], cur[i * 3 + 1] - before[i * 3 + 1])
        speeds.addLast(moved / LETTER_POINTS / size / dtSec)
        while (speeds.size > 3) speeds.removeFirst()
        return speeds.sum() / speeds.size
    }

    private fun buildSegment(fromMs: Long, toMs: Long): Segment? {
        val duration = toMs - fromMs
        if (duration < LETTER_MIN_MS || duration > LETTER_MAX_MS) return null
        val frames = buffer.filter { it.tMs in fromMs..toMs }
        if (frames.isEmpty()) return null
        val missing = frames.count { it.hand == null }.toFloat() / frames.size
        if (missing > LETTER_MAX_MISSING) return null
        val withHand = frames.mapNotNull { f -> f.hand?.let { f.tMs to it } }
        if (withHand.isEmpty()) return null
        return Segment(fromMs, toMs, resample(withHand, fromMs, toMs, LETTER_MOTION_FRAMES))
    }

    companion object {
        /** Linear interpolation at [t] evenly spaced times; clamps at the edges.
         *  MUST match letters.py resample. */
        fun resample(points: List<Pair<Long, FloatArray>>, fromMs: Long, toMs: Long, t: Int): Array<FloatArray> =
            Array(t) { k ->
                val tk = fromMs + k * (toMs - fromMs).toDouble() / (t - 1)
                when (val after = points.indexOfFirst { it.first >= tk }) {
                    -1 -> points.last().second.copyOf()
                    0 -> points.first().second.copyOf()
                    else -> {
                        val (ta, a) = points[after - 1]
                        val (tb, b) = points[after]
                        val w = if (tb == ta) 1f else ((tk - ta) / (tb - ta)).toFloat()
                        FloatArray(a.size) { i -> a[i] + (b[i] - a[i]) * w }
                    }
                }
            }
    }
}
