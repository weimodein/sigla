package com.example.sigla

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingActivityTest {

    @Test
    fun showsTheNameStepWhenNoNameIsSetYet() {
        assertTrue(shouldShowNameStep(null))
        assertTrue(shouldShowNameStep(""))
        assertTrue(shouldShowNameStep("   "))
    }

    @Test
    fun skipsTheNameStepForAReturningUserWithANameAlready() {
        assertFalse(shouldShowNameStep("Maria"))
        assertFalse(shouldShowNameStep("  Jhoren  "))
    }
}
