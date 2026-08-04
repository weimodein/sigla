package com.example.sigla

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color

object CategoryColorUtil {

    // Blue/purple palette — tweak/reorder freely, order doesn't matter since it's hashed
    private val PALETTE = listOf(
        0xFF4A90E2.toInt(), // blue
        0xFF5C6BC0.toInt(), // indigo
        0xFF7E57C2.toInt(), // purple
        0xFF3F51B5.toInt(), // deep indigo
        0xFF00796B.toInt(), // teal (kept for slight variety)
        0xFF303F9F.toInt(), // dark indigo
        0xFF512DA8.toInt(), // deep purple
        0xFF1E88E5.toInt(), // strong blue
    )

    fun colorFor(categoryKey: String, isDarkMode: Boolean = false): Int {
        val index = Math.abs(categoryKey.lowercase().hashCode()) % PALETTE.size
        val base = PALETTE[index]
        return if (isDarkMode) brighten(base) else base
    }

    fun isNightMode(context: Context): Boolean {
        val mode = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return mode == Configuration.UI_MODE_NIGHT_YES
    }

    /**
     * Brightens a color ~18% in HSV space while keeping its hue, per the
     * app's dark-mode rule: accent/semantic colors brighten to stay legible
     * against the much darker page/card surfaces used in dark mode.
     */
    private fun brighten(color: Int): Int {
        val hsv = FloatArray(3)
        Color.colorToHSV(color, hsv)
        hsv[1] = (hsv[1] * 0.9f).coerceIn(0f, 1f)
        hsv[2] = (hsv[2] * 1.18f).coerceIn(0f, 1f)
        return Color.HSVToColor(hsv)
    }
}
