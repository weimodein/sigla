package com.example.sigla

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PredictionPolicyTest {
    @Test
    fun inFlightPartialGestureCannotEmit() {
        assertFalse(hasEnoughGestureEvidence(frameCount = 12, endOfGesture = false))
        assertFalse(hasEnoughGestureEvidence(frameCount = 30, endOfGesture = false))
        assertFalse(hasEnoughGestureEvidence(frameCount = 35, endOfGesture = false))
    }

    @Test
    fun inFlightPeakCenterableGestureCanEmit() {
        assertTrue(hasEnoughGestureEvidence(frameCount = 36, endOfGesture = false))
        assertTrue(hasEnoughGestureEvidence(frameCount = 90, endOfGesture = false))
    }

    @Test
    fun completedFastGestureCanEmit() {
        assertTrue(hasEnoughGestureEvidence(frameCount = 12, endOfGesture = true))
    }
}
