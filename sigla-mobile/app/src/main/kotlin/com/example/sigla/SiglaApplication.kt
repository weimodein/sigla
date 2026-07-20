package com.example.sigla

import android.app.Application
import android.util.Log
import androidx.appcompat.app.AppCompatDelegate

class SiglaApplication : Application() {
    override fun onCreate() {
        try {
            super.onCreate()
            val isDarkMode = AppSettings.getInstance(this).isDarkMode
            AppCompatDelegate.setDefaultNightMode(
                if (isDarkMode) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
            )
        } catch (e: Exception) {
            Log.e("SiglaApplication", "Fatal error", e)
            // Let the app continue – better than crashing silently
        }
    }
}