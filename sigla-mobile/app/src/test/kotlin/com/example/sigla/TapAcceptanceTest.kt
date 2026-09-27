package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class TapAcceptanceTest {
    @Test
    fun confidentAndSeparatedIsAccepted() =
        assertEquals(1, acceptSingleWindow(floatArrayOf(0.05f, 0.90f, 0.05f)))

    @Test
    fun belowThresholdIsRejected() =
        assertEquals(-1, acceptSingleWindow(floatArrayOf(0.79f, 0.11f, 0.10f)))

    @Test
    fun tooCloseToRunnerUpIsRejected() =
        // 0.81 clears 0.80 but beats 0.70 by only 0.11 < 0.15.
        assertEquals(-1, acceptSingleWindow(floatArrayOf(0.81f, 0.70f)))

    @Test
    fun emptyIsRejected() = assertEquals(-1, acceptSingleWindow(FloatArray(0)))
}
