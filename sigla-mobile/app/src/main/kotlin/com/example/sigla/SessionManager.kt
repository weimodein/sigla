package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SessionManager(context: Context) {

    private val prefs: SharedPreferences = try {
        EncryptedSharedPreferences.create(
            context,
            "sigla_session",
            MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        // Encrypted prefs can fail after OS updates or keystore corruption.
        // Delete the corrupted file and retry with a fresh instance.
        Log.w("SessionManager", "EncryptedSharedPreferences failed, resetting: ${e.message}")
        try {
            context.deleteSharedPreferences("sigla_session")
            EncryptedSharedPreferences.create(
                context,
                "sigla_session",
                MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e2: Exception) {
            Log.e("SessionManager", "EncryptedSharedPreferences unavailable, using plain prefs")
            context.getSharedPreferences("sigla_session_plain", Context.MODE_PRIVATE)
        }
    }

    companion object {
        private const val KEY_TOKEN        = "auth_token"
        private const val KEY_USER_ID      = "user_id"
        private const val KEY_USERNAME     = "username"
        private const val KEY_NAME         = "name"
        private const val KEY_EMAIL        = "email"
        private const val KEY_FIRST_LAUNCH = "first_launch"
        private const val KEY_ONBOARDING   = "onboarding_done"

        @Volatile private var INSTANCE: SessionManager? = null

        fun getInstance(context: Context): SessionManager =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: SessionManager(context.applicationContext).also { INSTANCE = it }
            }
    }

    // ── Auth ──────────────────────────────────────────────────────
    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(v) = prefs.edit().putString(KEY_TOKEN, v).apply()

    var userId: Int
        get() = prefs.getInt(KEY_USER_ID, -1)
        set(v) = prefs.edit().putInt(KEY_USER_ID, v).apply()

    var username: String?
        get() = prefs.getString(KEY_USERNAME, null)
        set(v) = prefs.edit().putString(KEY_USERNAME, v).apply()

    var name: String?
        get() = prefs.getString(KEY_NAME, null)
        set(v) = prefs.edit().putString(KEY_NAME, v).apply()

    var email: String?
        get() = prefs.getString(KEY_EMAIL, null)
        set(v) = prefs.edit().putString(KEY_EMAIL, v).apply()

    val isLoggedIn: Boolean
        get() = !token.isNullOrEmpty()

    fun saveUser(id: Int, uname: String, uEmail: String, uName: String, tok: String) {
        prefs.edit()
            .putInt(KEY_USER_ID, id)
            .putString(KEY_USERNAME, uname)
            .putString(KEY_EMAIL, uEmail)
            .putString(KEY_NAME, uName)
            .putString(KEY_TOKEN, tok)
            .apply()
    }

    fun clearSession() {
        prefs.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_ID)
            .remove(KEY_USERNAME)
            .remove(KEY_NAME)
            .remove(KEY_EMAIL)
            .apply()
    }

    // ── Onboarding ─────────────────────────────────────────────────
    var isOnboardingDone: Boolean
        get() = prefs.getBoolean(KEY_ONBOARDING, false)
        set(v) = prefs.edit().putBoolean(KEY_ONBOARDING, v).apply()

    var isFirstLaunch: Boolean
        get() = prefs.getBoolean(KEY_FIRST_LAUNCH, true)
        set(v) = prefs.edit().putBoolean(KEY_FIRST_LAUNCH, v).apply()
}
