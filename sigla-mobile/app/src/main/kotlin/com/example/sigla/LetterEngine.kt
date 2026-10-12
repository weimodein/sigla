package com.example.sigla

/** The two letter models, behind an interface so the engine is testable on the JVM. */
internal interface LetterClassifier {
    val labels: List<String>
    /** Probabilities over [labels]; motion-only letters are 0. */
    fun classifyStatic(hand: FloatArray): FloatArray
    /** Probabilities over [labels] plus a final "_none" column. */
    fun classifyMotion(frames: Array<FloatArray>): FloatArray
}

internal data class LetterStep(val progress: Float, val commit: LetterCommit?)

/**
 * Letters mode, one frame at a time: hold voting for static letters, the
 * segmenter + motion model for J/Z. [cooldownMs] keeps the existing gap
 * between HELD-letter results. A traced J/Z is exempt: it is one movement, so it
 * cannot repeat the way a held hand can, and dropping it would also leave the
 * stabilizer's state (repeat-block, last letter) changed by a result nobody saw.
 * Not thread-safe — PredictionService calls it under its lock.
 */
internal class LetterEngine(private val classifier: LetterClassifier, private val cooldownMs: Long) {
    private val segmenter = LetterSegmenter()
    private val stabilizer = LetterStabilizer()
    private var lastCommitMs: Long? = null

    fun onFrame(tMs: Long, hand: FloatArray?): LetterStep {
        val seg = segmenter.onFrame(tMs, hand)
        var commit: LetterCommit? = null
        seg.segment?.let { s ->
            val c = stabilizer.onMotion(tMs, s.startMs, motionGuess(classifier.classifyMotion(s.frames)))
            if (c != null) commit = c
        }
        val guess = hand?.let { staticGuess(classifier.classifyStatic(it)) }
        val held = stabilizer.onFrame(
            tMs, guess, handPresent = hand != null, moving = seg.moving,
            mayCommit = commit == null && !coolingDown(tMs),
        )
        if (commit == null) commit = held
        if (commit != null) lastCommitMs = tMs
        return LetterStep(stabilizer.progress(), commit)
    }

    fun reset() {
        segmenter.reset()
        stabilizer.reset()
        lastCommitMs = null
    }

    private fun coolingDown(tMs: Long): Boolean = lastCommitMs?.let { tMs - it < cooldownMs } ?: false

    private fun staticGuess(p: FloatArray): LetterGuess? {
        val n = classifier.labels.size
        if (p.size < n || n == 0) return null
        var best = 0
        for (i in 1 until n) if (p[i] > p[best]) best = i
        return LetterGuess(classifier.labels[best], p[best])
    }

    /** null when "_none" (the last column) wins. */
    private fun motionGuess(p: FloatArray): LetterGuess? {
        val n = classifier.labels.size
        if (p.size != n + 1) return null
        var best = 0
        for (i in 1..n) if (p[i] > p[best]) best = i
        return if (best == n) null else LetterGuess(classifier.labels[best], p[best])
    }
}
