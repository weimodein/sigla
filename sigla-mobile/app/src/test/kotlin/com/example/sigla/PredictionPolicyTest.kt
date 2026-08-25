package com.example.sigla

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PredictionPolicyTest {
    @Test
    fun probabilityConsensusSuppressesOneNoisyWindow() {
        val mean = meanPredictionProbabilities(
            listOf(
                floatArrayOf(0.90f, 0.10f),
                floatArrayOf(0.85f, 0.15f),
                floatArrayOf(0.05f, 0.95f),
            ),
            classCount = 2,
        )

        assertEquals(0.60f, mean[0], 0.0001f)
        assertEquals(0.40f, mean[1], 0.0001f)
        assertTrue(topPredictionMargin(mean, 0) > 0.15f)
    }

    @Test
    fun probabilityConsensusIgnoresWrongSizedEntries() {
        val mean = meanPredictionProbabilities(
            listOf(floatArrayOf(0.7f, 0.3f), floatArrayOf(1f)),
            classCount = 2,
        )
        assertEquals(0.7f, mean[0], 0.0001f)
        assertEquals(0.3f, mean[1], 0.0001f)
    }

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
