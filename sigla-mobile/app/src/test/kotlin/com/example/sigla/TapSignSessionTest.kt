package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TapSignSessionTest {
    private var now = 0L
    private val session = TapSignSession { now }

    private val hand = TapClipSynth.frame(0, 'H', 0.05, TapClipSynth.NO_PEAK, 0.0)!!
    private val corrupt = TapClipSynth.frame(0, 'X', 0.05, TapClipSynth.NO_PEAK, 0.0)!!
    private val empty = FloatArray(147)

    /** Advances the clock one 33 ms frame and feeds it. */
    private fun feed(withHand: Boolean): TapSignSession.Event? {
        now += 33
        return if (withHand) session.onFrame(hand, 1) else session.onFrame(empty, 0)
    }

    @Test
    fun tapArmsAndHandsStartRecording() {
        assertTrue(session.tap() is TapSignSession.Event.Armed)
        assertEquals(TapSignSession.State.READY, session.state)
        assertNull(feed(false))
        assertTrue(feed(true) is TapSignSession.Event.RecordingStarted)
        assertEquals(TapSignSession.State.RECORDING, session.state)
    }

    @Test
    fun readyTimesOutAfterFiveSecondsWithoutHands() {
        session.tap()
        var event: TapSignSession.Event? = null
        while (now < 5_100 && event == null) event = feed(false)
        assertTrue(event is TapSignSession.Event.NoHandsTimeout)
        assertEquals(TapSignSession.State.IDLE, session.state)
    }

    @Test
    fun tapWhileReadyCancels() {
        session.tap()
        assertTrue(session.tap() is TapSignSession.Event.Cancelled)
        assertEquals(TapSignSession.State.IDLE, session.state)
    }

    @Test
    fun sixHandlessFramesStopRecording() {
        session.tap(); feed(true)
        repeat(20) { assertNull(feed(true)) }
        repeat(5) { assertNull(feed(false)) }
        val e = feed(false)
        assertTrue(e is TapSignSession.Event.Captured)
        assertEquals(TapSignSession.State.PROCESSING, session.state)
        // 1 start + 20 hand + 6 hand-less frames.
        assertEquals(27, (e as TapSignSession.Event.Captured).frames.size)
    }

    @Test
    fun preRollKeepsUpToFourFramesBeforeTheFirstHand() {
        session.tap()
        repeat(10) { feed(false) }
        feed(true)
        var e: TapSignSession.Event? = null
        while (e == null) e = feed(false)
        val frames = (e as TapSignSession.Event.Captured).frames
        assertEquals(4, frames.takeWhile { it.features == null }.size)
    }

    // Review Focus 5.
    @Test
    fun isolatedBadFramesDoNotStopRecording() {
        session.tap(); feed(true)
        repeat(10) {
            now += 33; assertNull(session.onFrame(corrupt, 1))   // detected, fails handExtentOk
            assertNull(feed(true))
        }
        assertEquals(TapSignSession.State.RECORDING, session.state)
    }

    @Test
    fun tapWhileRecordingStopsNow() {
        session.tap(); feed(true); feed(true)
        assertTrue(session.tap() is TapSignSession.Event.Captured)
        assertEquals(TapSignSession.State.PROCESSING, session.state)
    }

    // Review Focus 2.
    @Test
    fun capStopsRecordingAtFourSeconds() {
        session.tap(); feed(true)
        var event: TapSignSession.Event? = null
        while (event == null && now < 10_000) event = feed(true)
        assertTrue(event is TapSignSession.Event.Captured)
        assertTrue("stopped at ${now}ms", now in 4_000..4_100)
    }

    @Test
    fun framesAreIgnoredWhileProcessing() {
        session.tap(); feed(true)
        session.tap()
        assertNull(feed(true))
        assertEquals(TapSignSession.State.PROCESSING, session.state)
    }

    @Test
    fun finishProcessingReturnsToIdle() {
        session.tap(); feed(true)
        val e = session.tap() as TapSignSession.Event.Captured
        assertTrue(session.finishProcessing(e.generation))
        assertEquals(TapSignSession.State.IDLE, session.state)
    }

    // Review Focus 4.
    @Test
    fun cancelDuringProcessingDiscardsTheResult() {
        session.tap(); feed(true)
        val e = session.tap() as TapSignSession.Event.Captured
        session.cancel()                               // e.g. Words/Letters switched
        assertFalse(session.finishProcessing(e.generation))
        assertEquals(TapSignSession.State.IDLE, session.state)
    }

    @Test
    fun tapWhileProcessingIsIgnored() {
        session.tap(); feed(true); session.tap()
        assertNull(session.tap())
    }

    @Test
    fun everyRejectionHasCopy() {
        for (r in ClipRejection.values()) assertTrue(tapRejectionMessage(r).isNotBlank())
        assertEquals("Sign was too quick — try again, a little slower",
            tapRejectionMessage(ClipRejection.TOO_SHORT))
    }
}
