package com.example.sigla

/** Kotlin twin of sigla-ml/tests/_tap_clip_synth.py. Change both together. */
internal object TapClipSynth {
    const val NO_PEAK = 1_000_000

    fun expand(spec: String): String =
        Regex("(\\d+)([Hh\\-X])").findAll(spec)
            .joinToString("") { m -> m.groupValues[2].repeat(m.groupValues[1].toInt()) }

    fun frame(i: Int, token: Char, slope: Double, peakAt: Int, jump: Double): FloatArray? {
        if (token == '-') return null
        val pos = slope * i + (if (i >= peakAt) jump else 0.0)
        val f = DoubleArray(147)
        for (j in 0 until 21) {
            f[j * 3] = 0.05 * j + pos
            f[j * 3 + 1] = 0.03 * j + 0.5 * pos
            f[j * 3 + 2] = 0.001 * j
        }
        if (token == 'X') f[60] = 50.0
        if (token == 'H' || token == 'X') {
            for (k in 0 until 7) {
                f[126 + k * 3] = 0.1 * k + pos
                f[126 + k * 3 + 1] = 0.2 * k + 0.25 * pos
                f[126 + k * 3 + 2] = 0.0
            }
        }
        return FloatArray(147) { f[it].toFloat() }
    }

    fun sampled(pattern: String, slope: Double, peakAt: Int, jump: Double): List<FloatArray?> =
        pattern.mapIndexed { i, c -> frame(i, c, slope, peakAt, jump) }

    /** A recording at a steady frame rate, one RecordedFrame per pattern token. */
    fun recording(pattern: String, fps: Double, slope: Double = 0.05,
                  peakAt: Int = NO_PEAK, jump: Double = 0.0): List<RecordedFrame> =
        pattern.mapIndexed { i, c ->
            RecordedFrame(timestampMs = (i * 1000.0 / fps).toLong(),
                          features = frame(i, c, slope, peakAt, jump))
        }
}
