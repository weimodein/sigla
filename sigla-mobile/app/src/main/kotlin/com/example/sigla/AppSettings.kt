package com.example.sigla

import android.content.Context
import android.content.SharedPreferences

class AppSettings(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("sigla_settings", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_VOLUME = "volume"
        private const val KEY_VOICE_TYPE = "voice_type"
        private const val KEY_TEXT_SIZE = "text_size"
        private const val KEY_DARK_MODE = "dark_mode"
        private const val KEY_SHOW_FILIPINO = "show_filipino"

        const val VOICE_FEMALE = "female"
        const val VOICE_MALE = "male"

        @Volatile private var INSTANCE: AppSettings? = null

        fun getInstance(context: Context): AppSettings =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: AppSettings(context.applicationContext).also { INSTANCE = it }
            }
    }

    var volume: Int
        get() = prefs.getInt(KEY_VOLUME, 80)
        set(v) = prefs.edit().putInt(KEY_VOLUME, v).apply()

    var voiceType: String
        get() = prefs.getString(KEY_VOICE_TYPE, VOICE_FEMALE) ?: VOICE_FEMALE
        set(v) = prefs.edit().putString(KEY_VOICE_TYPE, v).apply()

    var textSize: Int
        get() = prefs.getInt(KEY_TEXT_SIZE, 48)
        set(v) = prefs.edit().putInt(KEY_TEXT_SIZE, v).apply()

    var isDarkMode: Boolean
        get() = prefs.getBoolean(KEY_DARK_MODE, true)
        set(v) = prefs.edit().putBoolean(KEY_DARK_MODE, v).apply()

    var showFilipino: Boolean
        get() = prefs.getBoolean(KEY_SHOW_FILIPINO, true)
        set(v) = prefs.edit().putBoolean(KEY_SHOW_FILIPINO, v).apply()

    fun resetToDefault() {
        prefs.edit()
            .putInt(KEY_VOLUME, 80)
            .putString(KEY_VOICE_TYPE, VOICE_FEMALE)
            .putInt(KEY_TEXT_SIZE, 48)
            .putBoolean(KEY_DARK_MODE, true)
            .putBoolean(KEY_SHOW_FILIPINO, true)
            .apply()
    }
}