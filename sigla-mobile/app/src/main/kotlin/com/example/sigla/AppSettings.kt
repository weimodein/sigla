package com.example.sigla

import android.content.Context
import android.content.SharedPreferences

class AppSettings(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("sigla_settings", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_VOLUME = "volume"
        private const val KEY_VOICE_TYPE = "voice_type"
        private const val KEY_DARK_MODE = "dark_mode"
        private const val KEY_SHOW_FILIPINO = "show_filipino"
        private const val KEY_FRONT_CAMERA = "front_camera"

        const val VOICE_FEMALE = "female"
        const val VOICE_MALE = "male"

        @Volatile private var INSTANCE: AppSettings? = null

        fun getInstance(context: Context): AppSettings =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: AppSettings(context.applicationContext).also { INSTANCE = it }
            }
    }

    // ----- Volume -----
    var volume: Int
        get() = prefs.getInt(KEY_VOLUME, 80)
        set(value) = prefs.edit().putInt(KEY_VOLUME, value).apply()

    // ----- Voice type -----
    var voiceType: String
        get() = prefs.getString(KEY_VOICE_TYPE, VOICE_FEMALE) ?: VOICE_FEMALE
        set(value) = prefs.edit().putString(KEY_VOICE_TYPE, value).apply()

    // ----- Dark mode -----
    var isDarkMode: Boolean
        get() = prefs.getBoolean(KEY_DARK_MODE, true)
        set(value) = prefs.edit().putBoolean(KEY_DARK_MODE, value).apply()

    // ----- Show Filipino translation -----
    var showFilipino: Boolean
        get() = prefs.getBoolean(KEY_SHOW_FILIPINO, true)
        set(value) = prefs.edit().putBoolean(KEY_SHOW_FILIPINO, value).apply()

    // ----- Camera preference (front/back) -----
    var isFrontCamera: Boolean
        get() = prefs.getBoolean(KEY_FRONT_CAMERA, false)
        set(value) = prefs.edit().putBoolean(KEY_FRONT_CAMERA, value).apply()

    // ----- Reset all to defaults -----
    fun resetToDefault() {
        prefs.edit()
            .putInt(KEY_VOLUME, 80)
            .putString(KEY_VOICE_TYPE, VOICE_FEMALE)
            .putBoolean(KEY_DARK_MODE, true)
            .putBoolean(KEY_SHOW_FILIPINO, true)
            .putBoolean(KEY_FRONT_CAMERA, false)   // reset camera to back
            .apply()
    }
}