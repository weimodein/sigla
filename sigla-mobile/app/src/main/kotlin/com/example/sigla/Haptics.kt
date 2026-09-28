package com.example.sigla

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * Short vibrations at key translator moments — spec §4. performHapticFeedback
 * honours the system touch-vibration setting and needs no permission.
 */
object Haptics {
    /** Tap recording started or stopped for recognition. */
    fun tick(view: View) {
        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
    }

    /** A word was recognized. CONFIRM exists from Android 11 (API 30). */
    fun confirm(view: View) {
        view.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM
            else HapticFeedbackConstants.LONG_PRESS
        )
    }
}
