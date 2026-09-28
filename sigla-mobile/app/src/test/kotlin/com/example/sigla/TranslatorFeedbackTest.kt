package com.example.sigla

import com.example.sigla.TapSignSession.State.IDLE
import com.example.sigla.TapSignSession.State.PROCESSING
import com.example.sigla.TapSignSession.State.READY
import com.example.sigla.TapSignSession.State.RECORDING
import org.junit.Assert.assertEquals
import org.junit.Test

class TranslatorFeedbackTest {

    @Test
    fun armingPulsesWithoutATick() {
        assertEquals(TapFeedback(tick = false, pulse = true, ring = false), tapFeedback(IDLE, READY))
    }

    @Test
    fun startingToRecordTicksAndShowsTheRing() {
        assertEquals(TapFeedback(tick = true, pulse = false, ring = true), tapFeedback(READY, RECORDING))
    }

    @Test
    fun stoppingForRecognitionTicks() {
        assertEquals(TapFeedback(tick = true, pulse = false, ring = false), tapFeedback(RECORDING, PROCESSING))
    }

    @Test
    fun cancellingDoesNotTick() {
        for (from in listOf(READY, RECORDING, PROCESSING)) {
            assertEquals("from $from", TapFeedback(tick = false, pulse = false, ring = false), tapFeedback(from, IDLE))
        }
    }

    @Test
    fun sameStateReRenderDoesNotTick() {
        assertEquals(TapFeedback(tick = false, pulse = false, ring = true), tapFeedback(RECORDING, RECORDING))
        assertEquals(TapFeedback(tick = false, pulse = true, ring = false), tapFeedback(READY, READY))
    }

    @Test
    fun firstRenderHasNoPreviousState() {
        assertEquals(TapFeedback(tick = false, pulse = false, ring = false), tapFeedback(null, IDLE))
    }

    @Test
    fun aHiddenCardEmphasizesAndAShowingCardSwaps() {
        assertEquals(ResultMotion.EMPHASIZE, resultMotion(cardShowing = false))
        assertEquals(ResultMotion.SWAP, resultMotion(cardShowing = true))
    }

    @Test
    fun overlayDrawsAndFadesInWhenHandsReturn() {
        assertEquals(OverlayAction.DRAW_AND_SHOW, overlayAction(shown = false, hasHands = true))
        assertEquals(OverlayAction.DRAW, overlayAction(shown = true, hasHands = true))
    }

    @Test
    fun overlayKeepsTheLastSkeletonAndFadesItOnTheFirstEmptyFrame() {
        // Drawing the empty frame would blank the skeleton instantly, before any fade.
        assertEquals(OverlayAction.HIDE, overlayAction(shown = true, hasHands = false))
        assertEquals(OverlayAction.SKIP, overlayAction(shown = false, hasHands = false))
    }

    @Test
    fun aLiveResultIsClearedWhenTheScreenStopsButATapResultStays() {
        // The Live hide timer is dropped on stop, so the card must go with it.
        assertEquals(true, clearResultOnStop(tapMode = false))
        assertEquals(false, clearResultOnStop(tapMode = true))
    }
}
