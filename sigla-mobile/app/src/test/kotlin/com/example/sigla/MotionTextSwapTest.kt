package com.example.sigla

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionTextSwapTest {

    @Test
    fun swapsWhenTheTextDiffers() {
        assertTrue(needsTextSwap(current = "Loading", pending = null, next = "Ready"))
    }

    @Test
    fun skipsWhenTheTextIsAlreadyShown() {
        assertFalse(needsTextSwap(current = "Ready", pending = null, next = "Ready"))
    }

    @Test
    fun comparesAgainstThePendingTextWhileASwapIsInFlight() {
        // "Starting camera…" is on screen, "Loading hand tracking…" is mid-swap.
        assertFalse(needsTextSwap("Starting camera…", "Loading hand tracking…", "Loading hand tracking…"))
        assertTrue(needsTextSwap("Starting camera…", "Loading hand tracking…", "Checking for model updates…"))
        // Going back to what is currently on screen still counts as a change,
        // because the pending swap would otherwise overwrite it.
        assertTrue(needsTextSwap("Starting camera…", "Loading hand tracking…", "Starting camera…"))
    }

    @Test
    fun comparesContentNotSpanType() {
        // A non-String CharSequence (the Android Spanned classes are stubbed on the JVM).
        val spanned = StringBuilder("HELLO")
        assertFalse(needsTextSwap(current = spanned, pending = null, next = "HELLO"))
    }
}
