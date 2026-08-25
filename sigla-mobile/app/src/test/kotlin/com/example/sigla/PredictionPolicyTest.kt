package com.example.sigla

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
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

    @Test
    fun poseCoverageRejectsOutOfDistributionWindow() {
        val frames = List(30) { FloatArray(FEATURE_SIZE) }
        repeat(23) { frames[it][POSE_BASE] = 0.1f }
        assertFalse(hasSufficientPoseCoverage(frames))
        frames[23][POSE_BASE] = 0.1f
        assertTrue(hasSufficientPoseCoverage(frames))
    }

    @Test
    fun predictionMarginMeasuresRunnerUpSeparation() {
        assertEquals(0.10f, topPredictionMargin(floatArrayOf(0.80f, 0.70f, 0.10f), 0), 1e-6f)
        assertEquals(0.55f, topPredictionMargin(floatArrayOf(0.20f, 0.75f, 0.10f), 1), 1e-6f)
    }
}
