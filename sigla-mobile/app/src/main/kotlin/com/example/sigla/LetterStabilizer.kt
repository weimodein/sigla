package com.example.sigla

// Turns per-frame letter guesses into committed letters. Ported from Senya's
// PredictionStabilizer, without spaces (SigLa shows one result at a time).
internal const val LETTER_MIN_CONFIDENCE = 0.70f
internal const val LETTER_WINDOW = 10
internal const val LETTER_VOTES = 8
internal const val LETTER_MOTION_MIN_CONFIDENCE = 0.70f
internal const val LETTER_REPLACE_WINDOW_MS = 1000L
/** Static letters a motion letter starts from: J is traced from I. */
internal val LETTER_START_SHAPES: Map<String, Set<String>> = mapOf("J" to setOf("I"), "Z" to emptySet())

internal data class LetterGuess(val label: String, val confidence: Float)

internal data class LetterCommit(
    val label: String,
    val confidence: Float,
    val isMotion: Boolean,
    /** The previous result was this letter's start shape (I before J): replace it. */
    val replacesPrevious: Boolean,
)

internal class LetterStabilizer {
    private val window = ArrayDeque<LetterGuess?>()
    /** Cannot commit again until another letter commits or the hand leaves. */
    private var lastStatic: String? = null
    /** Start shapes of the last motion letter, blocked the same way. */
    private var blocked: Set<String> = emptySet()
    private var last: Committed? = null

    private class Committed(val label: String, val atMs: Long, val isStatic: Boolean)

    fun onFrame(tMs: Long, guess: LetterGuess?, handPresent: Boolean, moving: Boolean, mayCommit: Boolean): LetterCommit? {
        if (!handPresent) {
            window.clear()
            lastStatic = null
            blocked = emptySet()
            return null
        }
        if (moving) {
            window.clear()
            return null
        }
        window.addLast(guess?.takeIf { it.confidence >= LETTER_MIN_CONFIDENCE })
        while (window.size > LETTER_WINDOW) window.removeFirst()
        if (!mayCommit) return null

        val (label, votes) = leader() ?: return null
        if (votes < LETTER_VOTES || label == lastStatic || label in blocked) return null
        val confidence = window.filterNotNull().filter { it.label == label }.map { it.confidence }.average().toFloat()
        window.clear()
        lastStatic = label
        blocked = emptySet()
        last = Committed(label, tMs, isStatic = true)
        return LetterCommit(label, confidence, isMotion = false, replacesPrevious = false)
    }

    fun onMotion(tMs: Long, segmentStartMs: Long, guess: LetterGuess?): LetterCommit? {
        if (guess == null || guess.confidence < LETTER_MOTION_MIN_CONFIDENCE) return null
        val shapes = LETTER_START_SHAPES[guess.label].orEmpty()
        val prev = last
        val replace = prev != null && prev.isStatic && prev.label in shapes &&
            prev.atMs >= segmentStartMs - LETTER_REPLACE_WINDOW_MS
        window.clear()
        lastStatic = null
        blocked = shapes
        last = Committed(guess.label, tMs, isStatic = false)
        return LetterCommit(guess.label, guess.confidence, isMotion = true, replacesPrevious = replace)
    }

    /** Agreeing votes for the current leader over [LETTER_VOTES], capped at 1. */
    fun progress(): Float {
        val votes = leader()?.second ?: return 0f
        return (votes.toFloat() / LETTER_VOTES).coerceAtMost(1f)
    }

    fun reset() {
        window.clear()
        lastStatic = null
        blocked = emptySet()
        last = null
    }

    private fun leader(): Pair<String, Int>? =
        window.filterNotNull().groupingBy { it.label }.eachCount().maxByOrNull { it.value }?.toPair()
}
