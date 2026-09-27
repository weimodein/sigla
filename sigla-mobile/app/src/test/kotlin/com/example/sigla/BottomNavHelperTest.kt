package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class BottomNavHelperTest {
    @Test
    fun everyTabOpensItsOwnScreen() {
        assertEquals(HomeActivity::class.java, BottomNavHelper.activityFor(Tab.HOME))
        assertEquals(WordBankActivity::class.java, BottomNavHelper.activityFor(Tab.WORD_BANK))
        assertEquals(TranslationHistoryActivity::class.java, BottomNavHelper.activityFor(Tab.HISTORY))
        assertEquals(SettingsActivity::class.java, BottomNavHelper.activityFor(Tab.SETTINGS))
    }
}
