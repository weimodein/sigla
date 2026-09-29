package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ListEntranceTest {

    @Test
    fun theFirstNonEmptyDataPlaysTheEntrance() {
        assertTrue(shouldPlayListEntrance(alreadyPlayed = false, itemCount = 3))
    }

    @Test
    fun anEmptyListDoesNotSpendItsEntrance() {
        // History before the first translation: the entrance waits for real rows.
        assertFalse(shouldPlayListEntrance(alreadyPlayed = false, itemCount = 0))
    }

    @Test
    fun onceAnEntranceHasPlayedItNeverPlaysAgain() {
        // Search keystrokes, tab returns and refreshes all arrive with played = true.
        assertFalse(shouldPlayListEntrance(alreadyPlayed = true, itemCount = 12))
    }

    @Test
    fun reducedMotionSkipsTheEntranceButStillMarksItPlayed() {
        // "Remove animations" on: the caller must still record played = true so a
        // later normal-motion refresh (e.g. after the setting is turned back on)
        // does not retroactively animate stale rows.
        assertFalse(
            shouldPlayListEntrance(alreadyPlayed = false, itemCount = 3, animationsEnabled = false)
        )
    }

    @Test
    fun animationsEnabledDefaultsToTrueForExistingCallers() {
        assertTrue(shouldPlayListEntrance(alreadyPlayed = false, itemCount = 3))
    }

    @Test
    fun staggerGrowsByOneStepPerItem() {
        assertEquals(0L, staggerDelayMs(0, 40))
        assertEquals(40L, staggerDelayMs(1, 40))
        assertEquals(280L, staggerDelayMs(7, 40))
    }

    @Test
    fun staggerStopsGrowingAtTheCapSoLongListsNeverWait() {
        assertEquals(280L, staggerDelayMs(8, 40))
        assertEquals(280L, staggerDelayMs(50, 40))
    }

    @Test
    fun aNegativeIndexIsTreatedAsTheFirstItem() {
        assertEquals(0L, staggerDelayMs(-1, 40))
    }
}
