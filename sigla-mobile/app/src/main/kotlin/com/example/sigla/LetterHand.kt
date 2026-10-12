package com.example.sigla

import kotlin.math.hypot

// One-hand letter input. MUST match sigla-ml app/utils/letters.py
// (hand_extent / select_hand); LetterParityTest checks it against Python.
// Design: docs-internal/specs/2026-10-11-letters-accuracy-design.md
internal const val LETTER_POINTS = 21
internal const val LETTER_FLOATS = LETTER_POINTS * 3

internal object LetterHand {

    /** Largest 2D distance from the wrist (point 0) to any other point. */
    fun extent(p: FloatArray): Float {
        var max = 0f
        for (i in 1 until LETTER_POINTS) {
            max = maxOf(max, hypot(p[i * 3] - p[0], p[i * 3 + 1] - p[1]))
        }
        return max
    }

    /**
     * The signing hand from raw MediaPipe hands (63 floats each, x/y in 0..1 of
     * the image), with x and z multiplied by width / height so x and y share one
     * unit. The signing hand is the one with the largest extent after that
     * correction — the hand closest to the camera. Ties keep the earlier hand.
     */
    fun select(hands: List<FloatArray>, width: Int, height: Int): FloatArray? {
        if (hands.isEmpty() || width <= 0 || height <= 0) return null
        val sx = width.toFloat() / height
        var best: FloatArray? = null
        var bestExtent = -1f
        for (h in hands) {
            if (h.size != LETTER_FLOATS) continue
            val p = FloatArray(LETTER_FLOATS) { i -> if (i % 3 == 1) h[i] else h[i] * sx }
            val e = extent(p)
            if (e > bestExtent) {
                best = p
                bestExtent = e
            }
        }
        return best
    }
}
