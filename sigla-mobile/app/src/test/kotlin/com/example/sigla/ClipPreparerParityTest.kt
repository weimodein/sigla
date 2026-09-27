package com.example.sigla

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * ClipPreparer must make the same decisions as sigla-ml's clip_prep, which is
 * the code that prepared every training clip. Goldens come from
 * tools/gen_tap_clip_fixtures.py. A failure is a real divergence: fix the code,
 * never regenerate to make this pass.
 */
class ClipPreparerParityTest {

    @Test
    fun sampleIndicesMatchPython() {
        for (c in TAP_SAMPLE_CASES) {
            assertArrayEquals("${c.totalFrames} frames @ ${c.sourceFps} fps",
                c.expected, ClipPreparer.sampleIndices(c.totalFrames, c.sourceFps))
        }
    }

    @Test
    fun finalizeMatchesPython() {
        for (c in TAP_FINALIZE_CASES) {
            val sampled = TapClipSynth.sampled(c.pattern, c.slope, c.peakAt, c.jump)
            val out = ClipPreparer.finalizeSampled(sampled, c.totalFrames, c.sourceFps)
            if (c.expectedReason != null) {
                assertTrue("${c.name}: expected rejection", out is ClipOutcome.Rejected)
                assertEquals(c.name, c.expectedReason, (out as ClipOutcome.Rejected).reason.code)
            } else {
                assertTrue("${c.name}: expected a window, got ${(out as? ClipOutcome.Rejected)?.reason}",
                    out is ClipOutcome.Window)
                val frames = (out as ClipOutcome.Window).frames
                val expected = c.expectedFrameSums!!
                assertEquals(c.name, expected.size, frames.size)
                for (i in frames.indices) {
                    var sum = 0.0
                    for (v in frames[i]) sum += v
                    // float32 (Kotlin) vs float64 (numpy) intermediates; a wrong
                    // frame selection is off by whole units, not by this much.
                    val tol = maxOf(1e-3, abs(expected[i]) * 1e-4)
                    assertTrue("${c.name} frame $i: expected ${expected[i]} got $sum",
                        abs(sum - expected[i]) <= tol)
                }
            }
        }
    }
}
