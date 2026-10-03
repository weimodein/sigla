package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingNameStepTest {

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

    private val threePages = listOf(
        OnboardingPage(0, "a", "A", "A", "A"),
        OnboardingPage(0, "b", "B", "B", "B"),
        OnboardingPage(0, "c", "C", "C", "C"),
    )

    @Test
    fun adapterItemCountIncludesTheNameStepOnlyWhenShown() {
        val withName = OnboardingAdapter(threePages, showNameStep = true, initialName = null, {}, {})
        assertEquals(4, withName.itemCount)

        val withoutName = OnboardingAdapter(threePages, showNameStep = false, initialName = null, {}, {})
        assertEquals(3, withoutName.itemCount)
    }

    @Test
    fun onlyTheLastPositionIsTheNameStepViewType() {
        val adapter = OnboardingAdapter(threePages, showNameStep = true, initialName = null, {}, {})
        assertEquals(VIEW_TYPE_FEATURE, adapter.getItemViewType(0))
        assertEquals(VIEW_TYPE_FEATURE, adapter.getItemViewType(1))
        assertEquals(VIEW_TYPE_FEATURE, adapter.getItemViewType(2))
        assertEquals(VIEW_TYPE_NAME, adapter.getItemViewType(3))
    }

    @Test
    fun everyRealFeaturePageHasItsOwnIllustrationAndDescription() {
        val illustrations = featurePages.map { it.illustrationRes }
        assertTrue("every illustrationRes must be set (non-zero)", illustrations.all { it != 0 })
        assertEquals("two pages must not share an illustration", illustrations.size, illustrations.distinct().size)
        assertTrue(
            "every illustration needs a description for screen readers",
            featurePages.all { it.illustrationDescription.isNotBlank() },
        )
    }
}
