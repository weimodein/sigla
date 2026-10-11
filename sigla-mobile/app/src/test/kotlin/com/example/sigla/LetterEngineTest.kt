package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LetterEngineTest {
    /** Static: always "A" at 0.9. Motion: always "J" at 0.95. */
    private class Fake : LetterClassifier {
        override val labels = listOf("A", "I", "J")
        override fun classifyStatic(hand: FloatArray) = floatArrayOf(0.9f, 0.1f, 0f)
        override fun classifyMotion(frames: Array<FloatArray>) = floatArrayOf(0f, 0f, 0.95f, 0.05f)
    }

    private val still = FloatArray(LETTER_FLOATS) { i -> if (i % 3 == 2) 0f else 0.5f + 0.01f * (i / 3 % 5) }

    @Test
    fun heldHandCommitsOnceThenCoolsDown() {
        val e = LetterEngine(Fake(), cooldownMs = 2000L)
        val commits = (0 until 40).mapNotNull { e.onFrame(it * 66L, still).commit }
        assertEquals(listOf("A"), commits.map { it.label })
    }

    @Test
    fun progressFollowsVotes() {
        val e = LetterEngine(Fake(), cooldownMs = 0L)
        val p = (0 until 4).map { e.onFrame(it * 66L, still).progress }.last()
        assertEquals(4f / LETTER_VOTES, p, 1e-6f)
    }

    @Test
    fun resetDropsProgress() {
        val e = LetterEngine(Fake(), cooldownMs = 0L)
        repeat(5) { e.onFrame(it * 66L, still) }
        e.reset()
        assertEquals(0f, e.onFrame(1000L, null).progress, 0f)
    }

    @Test
    fun noHandNoCommit() {
        val e = LetterEngine(Fake(), cooldownMs = 0L)
        repeat(20) { assertNull(e.onFrame(it * 66L, null).commit) }
    }
}
