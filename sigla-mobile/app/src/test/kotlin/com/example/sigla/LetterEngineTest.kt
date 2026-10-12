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

    // ── the 2 s gap is for held letters; a traced J/Z is one movement and must not be dropped by it ──

    /** Static always [staticLabel] at 0.9; motion always [motionLabel] at 0.95. */
    private class Scripted(private val staticLabel: String, private val motionLabel: String) : LetterClassifier {
        override val labels = listOf("A", "I", "J", "Z")
        override fun classifyStatic(hand: FloatArray) =
            FloatArray(labels.size).also { it[labels.indexOf(staticLabel)] = 0.9f }
        override fun classifyMotion(frames: Array<FloatArray>) =
            FloatArray(labels.size + 1).also { it[labels.indexOf(motionLabel)] = 0.95f }
    }

    private fun handAt(x: Float) = FloatArray(LETTER_FLOATS) { i ->
        val p = i / 3
        when (i % 3) { 0 -> x + 0.02f * (p % 5); 1 -> 0.5f + 0.02f * (p / 5); else -> 0f }
    }

    /** Holds the hand still (a held letter), then traces a movement and holds still again. All 40 ms frames. */
    private fun holdThenTrace(e: LetterEngine): List<LetterCommit> {
        val commits = ArrayList<LetterCommit>()
        var t = 0L
        repeat(12) { e.onFrame(t, handAt(0.5f)).commit?.let { c -> commits += c }; t += 40 }
        repeat(15) { k -> e.onFrame(t, handAt(0.5f + 0.02f * (k + 1))).commit?.let { c -> commits += c }; t += 40 }
        repeat(12) { e.onFrame(t, handAt(0.8f)).commit?.let { c -> commits += c }; t += 40 }
        return commits
    }

    @Test
    fun aTracedZStillAppearsWithinTheGapAfterAHeldLetter() {
        val commits = holdThenTrace(LetterEngine(Scripted(staticLabel = "A", motionLabel = "Z"), cooldownMs = 2000L))
        assertEquals(listOf("A", "Z"), commits.map { it.label })     // Z comes ~1 s after A, inside the 2 s gap
        assertEquals(true, commits[1].isMotion)
    }

    @Test
    fun jReplacesTheIItStartedFromThroughTheWholeEngine() {
        val commits = holdThenTrace(LetterEngine(Scripted(staticLabel = "I", motionLabel = "J"), cooldownMs = 2000L))
        assertEquals(listOf("I", "J"), commits.map { it.label })
        assertEquals(true, commits[1].replacesPrevious)
    }
}
