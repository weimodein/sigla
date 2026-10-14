package com.example.sigla

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameRateBridgeTest {

    private fun hand(x: Float) = FloatArray(147) { if (it < 126) x + 1f else 0.5f }  // never all-zero
    private val noHand = FloatArray(147)

    @Test
    fun `at 24 fps nothing is added`() {
        val b = FrameRateBridge()
        var t = 0L
        repeat(10) {
            assertEquals(1, b.expand(hand(it.toFloat()), 2, t).size)
            t += 42
        }
    }

    @Test
    fun `at 12 fps one in-between frame is rebuilt per gap, halfway`() {
        val b = FrameRateBridge()
        b.expand(hand(0f), 2, 0L)
        val out = b.expand(hand(1f), 2, 83L)
        assertEquals(2, out.size)
        assertEquals(1.5f, out[0].features[0], 1e-6f)
        assertEquals(2f, out[1].features[0], 1e-6f)
    }

    @Test
    fun `12 fps for one second gives about 24 frames`() {
        val b = FrameRateBridge()
        var n = 0
        for (i in 0 until 12) n += b.expand(hand(i.toFloat()), 2, i * 1000L / 12).size
        assertTrue("got $n", n in 22..24)
    }

    @Test
    fun `hands-down frames count as hands-down slots`() {
        val b = FrameRateBridge()
        b.expand(noHand, 0, 0L)
        val out = b.expand(noHand, 0, 83L)
        assertEquals(2, out.size)
        assertTrue(out.all { it.hands == 0 })
    }

    @Test
    fun `a hand never fades in from the absent sentinel`() {
        val b = FrameRateBridge()
        b.expand(noHand, 0, 0L)
        val out = b.expand(hand(1f), 2, 83L)
        assertArrayEquals(hand(1f), out[0].features, 0f)
    }

    @Test
    fun `a long pause is not bridged`() {
        val b = FrameRateBridge()
        b.expand(hand(0f), 2, 0L)
        assertEquals(1, b.expand(hand(1f), 2, 2_000L).size)
    }

    @Test
    fun `a stall adds at most MAX_FILL frames`() {
        val b = FrameRateBridge()
        b.expand(hand(0f), 2, 0L)
        val out = b.expand(hand(1f), 2, 400L)
        assertEquals(FrameRateBridge.MAX_FILL + 1, out.size)
    }

    @Test
    fun `blend interpolates only blocks present in both frames`() {
        val a = hand(0f).also { for (k in 63 until 126) it[k] = 0f }   // second hand absent
        val b = hand(1f)
        val mid = blendFrames(a, b, 0.5f)
        assertEquals(1.5f, mid[0], 1e-6f)     // first hand: interpolated
        assertEquals(2f, mid[63], 1e-6f)      // second hand: taken from b
        assertEquals(0.5f, mid[126], 1e-6f)   // pose present in both, same value
    }
}
