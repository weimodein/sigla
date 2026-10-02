package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class KeyboardLiftTest {

    @Test
    fun noKeyboardMeansNoLift() {
        assertEquals(0, keyboardLift(fieldBottom = 1100, windowHeight = 1600, imeHeight = 0, gap = 48))
    }

    @Test
    fun fieldAlreadyClearOfTheKeyboardIsNotMoved() {
        // Keyboard top at 1000, field ends at 900: 52px to spare beyond the gap.
        assertEquals(0, keyboardLift(fieldBottom = 900, windowHeight = 1600, imeHeight = 600, gap = 48))
    }

    @Test
    fun coveredFieldIsLiftedJustAboveTheKeyboardPlusGap() {
        // Keyboard top at 1000; field ends at 1060, so it needs 60 + 48 to clear.
        assertEquals(108, keyboardLift(fieldBottom = 1060, windowHeight = 1600, imeHeight = 600, gap = 48))
    }
}
