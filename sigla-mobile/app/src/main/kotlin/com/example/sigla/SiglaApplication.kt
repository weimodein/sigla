package com.example.sigla

import android.app.Application
import androidx.appcompat.app.AppCompatDelegate

/**
 * AppCompatDelegate.setDefaultNightMode() only sets an in-memory flag for
 * the current process — it isn't restored automatically on a fresh launch.
 * Re-applying the saved preference here, before any Activity is created,
 * is what makes Dark Mode stick across app restarts.
 */
class SiglaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val isDarkMode = AppSettings.getInstance(this).isDarkMode
        AppCompatDelegate.setDefaultNightMode(
            if (isDarkMode) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
        )
    }
}
