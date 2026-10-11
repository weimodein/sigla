package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LetterHandTest {
    private fun hand(cx: Float, cy: Float, spread: Float) = FloatArray(LETTER_FLOATS) { i ->
        val p = i / 3
        when (i % 3) {
            0 -> cx + if (p == 0) 0f else spread * (p % 5)
            1 -> cy + if (p == 0) 0f else spread * (p / 5)
            else -> 0.01f * p
        }
    }

    @Test
    fun selectPicksLargerHand() {
        val small = hand(0.3f, 0.5f, 0.01f)
        val big = hand(0.6f, 0.5f, 0.03f)
        val out = LetterHand.select(listOf(small, big), 640, 480)!!
        assertEquals(big[3] * 640f / 480f, out[3], 1e-6f)   // x scaled
        assertEquals(big[4], out[4], 1e-6f)                  // y unchanged
        assertEquals(big[5] * 640f / 480f, out[5], 1e-6f)   // z scaled
    }

    @Test
    fun selectNullWithoutHandsOrSize() {
        assertNull(LetterHand.select(emptyList(), 640, 480))
        assertNull(LetterHand.select(listOf(hand(0.5f, 0.5f, 0.02f)), 640, 0))
        assertNull(LetterHand.select(listOf(FloatArray(10)), 640, 480))
    }
}
