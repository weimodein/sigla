package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LetterStabilizerTest {
    private fun feed(s: LetterStabilizer, label: String, frames: Int, from: Long = 0L, conf: Float = 0.9f): LetterCommit? {
        var out: LetterCommit? = null
        for (i in 0 until frames) {
            s.onFrame(from + i * 66L, LetterGuess(label, conf), handPresent = true, moving = false, mayCommit = true)
                ?.let { out = it }
        }
        return out
    }

    @Test
    fun commitsAfterEightAgreeingFrames() {
        val s = LetterStabilizer()
        assertNull(feed(s, "A", 7))
        val c = feed(s, "A", 1, from = 7 * 66L)!!
        assertEquals("A", c.label)
        assertTrue(!c.isMotion && !c.replacesPrevious)
    }

    @Test
    fun lowConfidenceFramesDoNotVote() {
        assertNull(feed(LetterStabilizer(), "A", 20, conf = 0.5f))
    }

    @Test
    fun holdingTheSameLetterCommitsOnce() {
        val s = LetterStabilizer()
        assertEquals("A", feed(s, "A", 8)!!.label)
        assertNull(feed(s, "A", 30, from = 1000L))
    }

    @Test
    fun handLeavingAllowsTheSameLetterAgain() {
        val s = LetterStabilizer()
        feed(s, "L", 8)
        s.onFrame(700L, null, handPresent = false, moving = false, mayCommit = true)
        assertEquals("L", feed(s, "L", 8, from = 800L)!!.label)
    }

    @Test
    fun movingClearsVotes() {
        val s = LetterStabilizer()
        feed(s, "A", 7)
        s.onFrame(500L, LetterGuess("A", 0.9f), handPresent = true, moving = true, mayCommit = true)
        assertNull(feed(s, "A", 7, from = 600L))
    }

    @Test
    fun jReplacesARecentI() {
        val s = LetterStabilizer()
        feed(s, "I", 8)                                   // committed at t = 462
        val j = s.onMotion(1400L, segmentStartMs = 900L, guess = LetterGuess("J", 0.9f))!!
        assertTrue(j.isMotion && j.replacesPrevious)
    }

    @Test
    fun motionBelowConfidenceIsIgnored() {
        assertNull(LetterStabilizer().onMotion(0L, 0L, LetterGuess("J", 0.5f)))
        assertNull(LetterStabilizer().onMotion(0L, 0L, null))
    }

    @Test
    fun resetClearsVotes() {
        val s = LetterStabilizer()
        feed(s, "A", 7)
        assertTrue(s.progress() > 0f)
        s.reset()
        assertEquals(0f, s.progress(), 0f)
        assertNull(feed(s, "A", 1, from = 1000L))
    }
}
