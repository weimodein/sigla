package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipPreparerTest {

    private fun reason(o: ClipOutcome): ClipRejection? = (o as? ClipOutcome.Rejected)?.reason

    @Test
    fun sampleBudgetIs86() = assertEquals(86, ClipPreparer.sampleBudget())

    @Test
    fun ratePathSamplesAt24fps() {
        val idx = ClipPreparer.sampleIndices(60, 30.0)   // stride 1.25 -> 48
        assertEquals(48, idx.size)
        assertEquals(0, idx.first())
        assertEquals(58, idx.last())                      // floor(47 * 1.25)
    }

    @Test
    fun overBudgetSpreadsEvenly() {
        val idx = ClipPreparer.sampleIndices(250, 60.0)  // wants 100 > 86
        assertEquals(86, idx.size)
        assertEquals(249, idx.last())
    }

    @Test
    fun estimateFpsFromTimestamps() {
        val rec = TapClipSynth.recording(TapClipSynth.expand("31H"), fps = 30.0)
        assertEquals(30.0, ClipPreparer.estimateSourceFps(rec), 0.5)
    }

    @Test
    fun estimateFpsFallsBackForOneFrame() {
        val rec = TapClipSynth.recording("H", fps = 30.0)
        assertEquals(TAP_DEFAULT_SOURCE_FPS, ClipPreparer.estimateSourceFps(rec), 0.0)
    }

    @Test
    fun trimKeepsFourFramesEachSide() {
        val rec = TapClipSynth.recording(TapClipSynth.expand("10-20H10-"), fps = 30.0)
        val span = ClipPreparer.trimToSigningSpan(rec, 30.0)!!
        assertEquals(4 + 20 + 4, span.size)
        assertNull(span.first().features)
        assertTrue(span[4].features != null)
    }

    @Test
    fun trimReturnsNullWithoutHands() =
        assertNull(ClipPreparer.trimToSigningSpan(TapClipSynth.recording("------", 30.0), 30.0))

    @Test
    fun normalSignProducesWindow() {
        val sampled = TapClipSynth.sampled(TapClipSynth.expand("45H"), 0.05, 22, 1.0)
        val out = ClipPreparer.finalizeSampled(sampled, 45, 24.0)
        assertTrue(out is ClipOutcome.Window)
        val w = (out as ClipOutcome.Window).frames
        assertEquals(30, w.size)
        assertEquals(147, w[0].size)
    }

    @Test
    fun exactlyThirtyFramesIsStretchedThenWindowed() {
        val sampled = TapClipSynth.sampled(TapClipSynth.expand("30H"), 0.05, 15, 1.0)
        assertTrue(ClipPreparer.finalizeSampled(sampled, 30, 24.0) is ClipOutcome.Window)
    }

    @Test
    fun rejectionReasons() {
        fun r(spec: String, slope: Double, peak: Int, jump: Double, total: Int, fps: Double) =
            reason(ClipPreparer.finalizeSampled(
                TapClipSynth.sampled(TapClipSynth.expand(spec), slope, peak, jump), total, fps))
        assertEquals(ClipRejection.MIN_HAND_FRAMES, r("11H", 0.05, 5, 1.0, 11, 24.0))
        assertEquals(ClipRejection.HAND_COVERAGE, r("20H60-", 0.05, 10, 1.0, 80, 24.0))
        assertEquals(ClipRejection.POSE_COVERAGE, r("20H20h", 0.05, 20, 1.0, 40, 24.0))
        assertEquals(ClipRejection.HAND_GAP, r("20H7-20H", 0.05, 30, 1.0, 47, 24.0))
        assertEquals(ClipRejection.TOO_SHORT, r("25H", 0.05, 12, 1.0, 25, 24.0))
        assertEquals(ClipRejection.LOW_MOTION,
            r("45H", 0.001, TapClipSynth.NO_PEAK, 0.0, 45, 24.0))
        assertEquals(ClipRejection.WINDOW_POSE, r("15H10h15H", 0.05, 20, 1.0, 40, 24.0))
    }

    @Test
    fun tooSparseWhenLongClipHasFewHandFrames() {
        val pattern = "H--".repeat(22) + "H-".repeat(7)
        val out = ClipPreparer.finalizeSampled(
            TapClipSynth.sampled(pattern, 0.05, 40, 1.0), 200, 30.0)
        assertEquals(ClipRejection.TOO_SPARSE, reason(out))
    }

    @Test
    fun corruptFramesAreDroppedNotFatal() {
        val sampled = TapClipSynth.sampled(TapClipSynth.expand("20H2X20H"), 0.05, 21, 1.0)
        assertTrue(ClipPreparer.finalizeSampled(sampled, 42, 24.0) is ClipOutcome.Window)
    }

    @Test
    fun prepareEndToEndOnARealisticRecording() {
        // Ready pre-roll (4 no-hand), 50 hand frames, 6 no-hand frames that triggered auto-stop.
        val rec = TapClipSynth.recording(TapClipSynth.expand("4-50H6-"), fps = 30.0,
                                         peakAt = 30, jump = 1.0)
        assertTrue(ClipPreparer.prepare(rec) is ClipOutcome.Window)
    }

    // Review Focus 1.
    @Test
    fun lowFpsRecordingIsNotRejectedForHandGap() {
        // 15 fps: 4 trailing pad frames would be 0.27 s > 0.25 s; the cap keeps 3.
        val rec = TapClipSynth.recording(TapClipSynth.expand("4-40H6-"), fps = 15.0,
                                         peakAt = 20, jump = 1.0)
        val out = ClipPreparer.prepare(rec)
        assertTrue("got ${reason(out)}", out is ClipOutcome.Window)
    }

    // Review Focus 3.
    @Test
    fun veryShortRecordingIsTooQuick() {
        val rec = TapClipSynth.recording(TapClipSynth.expand("5H"), fps = 30.0)
        assertEquals(ClipRejection.MIN_HAND_FRAMES, reason(ClipPreparer.prepare(rec)))
    }
}
