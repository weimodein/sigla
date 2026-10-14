package com.example.sigla

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Rebuilds the frames MediaPipe dropped, so the words buffer runs at the rate
 * the model was trained at.
 *
 * WHY
 *
 * Training samples every clip at TARGET_SAMPLE_FPS (24), and every frame count
 * in PredictionService (the 30-frame window, MIN_COMPLETE_GESTURE_FRAMES,
 * MIN_REAL_FRAMES_FOR_FIRE, the streaks) means "at 24 fps". Measured 2026-10-14
 * on a Xiaomi 25078RA3EA: the camera delivers ~26 fps but hand + pose detection
 * in LIVE_STREAM mode drops frames while busy, so only ~12 per second reach
 * processFrame while signing. CaptureRateMonitor cannot see this — it counts
 * frames arriving, not frames that survive detection.
 *
 * At 12 fps a sign reaches the model at half speed and short signs never collect
 * enough frames to fire. Replaying 747 held-out clips through a copy of the live
 * path (sigla-ml/tools/live_replay.py): 70.8% right at 24 fps, 41.5% at 12 fps,
 * 71.6% at 12 fps with this bridge.
 *
 * HOW
 *
 * For each real frame, the time since the previous one says how many 24 fps
 * slots it covers. Between two consecutive hand frames the missing slots get
 * in-between frames (each block interpolated only when present in both, see
 * [blendFrames]); a hands-down frame stands for as many hands-down slots. At most
 * [maxFill] frames are added per gap, and a gap longer than [maxGapMs] is a
 * pause, not dropped frames, so nothing is invented across it.
 *
 * MUST stay identical to sigla-ml tools/live_replay.py upsample_stream /
 * _blend_frames, which is what the accuracy above was measured with.
 */
internal class FrameRateBridge(
    private val targetFps: Float = TARGET_FPS,
    private val maxFill: Int = MAX_FILL,
    private val maxGapMs: Long = MAX_GAP_MS,
) {
    private var lastTimeMs = -1L
    private var lastFrame: FloatArray? = null
    private var lastHands = 0
    private var carry = 0f

    /** One frame for processFrame's per-frame logic: features and usable hand count. */
    data class Frame(val features: FloatArray, val hands: Int)

    /** The real frame preceded by the frames rebuilt in front of it, oldest first. */
    fun expand(features: FloatArray, hands: Int, timeMs: Long): List<Frame> {
        val prevTime = lastTimeMs
        val prev = lastFrame
        val prevHands = lastHands
        lastTimeMs = timeMs
        lastFrame = features
        lastHands = hands

        val dt = timeMs - prevTime
        if (prevTime < 0 || dt <= 0 || dt > maxGapMs || prev == null) {
            carry = 0f
            return listOf(Frame(features, hands))
        }
        carry += dt * targetFps / 1000f
        val slots = max(1, carry.roundToInt())
        carry -= slots
        val fill = min(slots - 1, maxFill)
        if (fill == 0) return listOf(Frame(features, hands))

        val out = ArrayList<Frame>(fill + 1)
        if (hands > 0 && prevHands > 0) {
            for (k in 1..fill) out.add(Frame(blendFrames(prev, features, k / (fill + 1f)), hands))
        } else {
            val filler = if (hands == 0) FloatArray(features.size) else features
            repeat(fill) { out.add(Frame(filler, hands)) }
        }
        out.add(Frame(features, hands))
        return out
    }

    fun reset() {
        lastTimeMs = -1L
        lastFrame = null
        lastHands = 0
        carry = 0f
    }

    companion object {
        const val TARGET_FPS = 24f   // sigla-ml clip_prep.TARGET_SAMPLE_FPS
        const val MAX_FILL = 3       // a 6 fps stall is the most this will bridge
        const val MAX_GAP_MS = 500L  // longer than this is a pause, not drops
    }
}

/**
 * A frame [w] of the way from [a] to [b]. Each hand block and the pose block is
 * interpolated only when present in BOTH; otherwise [b]'s block is kept, so a hand
 * never fades in from the all-zero absent sentinel.
 */
internal fun blendFrames(a: FloatArray, b: FloatArray, w: Float): FloatArray {
    val out = b.copyOf()
    for ((lo, hi) in BLOCKS) {
        if (blockPresent(a, lo, hi) && blockPresent(b, lo, hi)) {
            for (k in lo until hi) out[k] = a[k] + (b[k] - a[k]) * w
        }
    }
    return out
}

private val BLOCKS = listOf(0 to 63, 63 to 126, 126 to 147)

private fun blockPresent(f: FloatArray, lo: Int, hi: Int): Boolean {
    for (k in lo until hi) if (f[k] != 0f) return true
    return false
}
