package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class LetterSegmenterTest {
    private fun hand(x: Float, y: Float) = FloatArray(LETTER_FLOATS) { i ->
        val p = i / 3
        when (i % 3) { 0 -> x + 0.02f * (p % 5); 1 -> y + 0.02f * (p / 5); else -> 0f }
    }

    @Test
    fun movementThenStillnessMakesOneSegment() {
        val s = LetterSegmenter()
        var seg: LetterSegmenter.Segment? = null
        var t = 0L
        repeat(5) { s.onFrame(t, hand(0.5f, 0.5f)); t += 40 }
        repeat(15) { k -> s.onFrame(t, hand(0.5f + 0.02f * k, 0.5f)).segment?.let { seg = it }; t += 40 }
        repeat(10) { s.onFrame(t, hand(0.8f, 0.5f)).segment?.let { seg = it }; t += 40 }
        assertNotNull(seg)
        assertEquals(LETTER_MOTION_FRAMES, seg!!.frames.size)
    }

    @Test
    fun handLossEndsSegment() {
        val s = LetterSegmenter()
        var seg: LetterSegmenter.Segment? = null
        var t = 0L
        repeat(3) { s.onFrame(t, hand(0.5f, 0.5f)); t += 40 }
        repeat(12) { k -> s.onFrame(t, hand(0.5f + 0.02f * k, 0.5f)); t += 40 }
        repeat(8) { s.onFrame(t, null).segment?.let { seg = it }; t += 40 }
        assertNotNull(seg)
    }

    @Test
    fun tooShortMovementIsDropped() {
        // 20 ms frames: a 3-frame flick plus the 150 ms pad spans ~250 ms,
        // under LETTER_MIN_MS, so no segment is produced once it settles.
        val s = LetterSegmenter()
        var seg: LetterSegmenter.Segment? = null
        var t = 0L
        repeat(3) { s.onFrame(t, hand(0.5f, 0.5f)); t += 20 }
        repeat(2) { k -> s.onFrame(t, hand(0.55f + 0.05f * k, 0.5f)); t += 20 }
        repeat(20) { s.onFrame(t, hand(0.6f, 0.5f)).segment?.let { seg = it }; t += 20 }
        assertNull(seg)
    }

    /** One movement that ends by stillness; with [gap], frames 1..5 of it have no hand (200 ms, not
     *  long enough to end the movement, but more than 25 % of the segment). */
    private fun runMovement(gap: Boolean): LetterSegmenter.Segment? {
        val s = LetterSegmenter()
        var seg: LetterSegmenter.Segment? = null
        var t = 0L
        repeat(3) { s.onFrame(t, hand(0.5f, 0.5f)); t += 40 }
        for (k in 0 until 10) {
            val h = if (gap && k in 1..5) null else hand(0.5f + 0.02f * (k + 1), 0.5f)
            s.onFrame(t, h).segment?.let { seg = it }
            t += 40
        }
        repeat(10) { s.onFrame(t, hand(0.7f, 0.5f)).segment?.let { seg = it }; t += 40 }
        return seg
    }

    @Test
    fun tooManyMissingFramesDropsTheSegment() {
        assertNotNull("the same movement without the gap must be found", runMovement(gap = false))
        assertNull(runMovement(gap = true))
    }
}
