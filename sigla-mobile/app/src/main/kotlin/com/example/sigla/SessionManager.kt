package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SessionManager(private val appContext: Context) {

    /**
     * Built on first access, not at construction.
     *
     * Creating EncryptedSharedPreferences generates or loads an Android Keystore
     * master key — a binder call into keystore2 plus AES setup, tens of ms cold.
     * Every Activity calls getInstance() in onCreate, so eager construction put
     * that on the main thread during startup. Deferring it lets the first touch
     * happen wherever it naturally occurs; on this screen that is checkAuthState(),
     * which already reads the token on Dispatchers.IO.
     *
     * Holds applicationContext (getInstance passes it), so retaining it is safe.
     */
    private val prefs: SharedPreferences by lazy { createPrefs() }

    /**
     * Unencrypted store for the onboarding flags only — see isFirstLaunch below.
     * Opening a plain SharedPreferences is cheap and involves no Keystore.
     */
    private val plainPrefs: SharedPreferences =
        appContext.getSharedPreferences("sigla_onboarding", Context.MODE_PRIVATE)

    private fun createPrefs(): SharedPreferences {
        val context = appContext
        return try {
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
    }

    companion object {
        private const val KEY_TOKEN        = "auth_token"
        private const val KEY_USER_ID      = "user_id"
        private const val KEY_USERNAME     = "username"
        private const val KEY_NAME         = "name"
        private const val KEY_EMAIL        = "email"
        private const val KEY_FIRST_LAUNCH = "first_launch"
        private const val KEY_ONBOARDING   = "onboarding_done"
        private const val KEY_ONBOARDING_MIGRATED = "onboarding_migrated"

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
        // The shared HTTP client caches the token, so it has to be dropped too
        // or signed-out requests would keep sending the old credential.
        ApiClient.clearToken()
    }

    // ── Onboarding ─────────────────────────────────────────────────
    //
    // These two live in PLAIN prefs, unlike everything above. MainActivity.onCreate
    // reads them synchronously to decide whether to launch onboarding, so the
    // decision cannot be deferred to a background thread — and reading them from
    // the encrypted store would force Keystore initialization on the main thread at
    // startup, defeating the lazy `prefs` above. Neither flag is a secret.
    //
    // Values written by older builds live in the encrypted store, so the first read
    // migrates them across; see migrateOnboardingFlags().
    var isOnboardingDone: Boolean
        get() = plainPrefs.getBoolean(KEY_ONBOARDING, false)
        set(v) = plainPrefs.edit().putBoolean(KEY_ONBOARDING, v).apply()

    var isFirstLaunch: Boolean
        get() = plainPrefs.getBoolean(KEY_FIRST_LAUNCH, true)
        set(v) = plainPrefs.edit().putBoolean(KEY_FIRST_LAUNCH, v).apply()

    /**
     * Copies the onboarding flags out of the encrypted store on first run of a build
     * that keeps them in plain prefs. Without this an existing user, whose encrypted
     * `first_launch` is false, would get the plain-prefs default of true and be shown
     * onboarding again.
     *
     * Touches the encrypted store, so it must NOT be called from the main thread.
     * MainActivity runs it from checkAuthState()'s IO coroutine, after onCreate has
     * already read the plain values — one extra onboarding decision on the upgrade
     * launch is not worth blocking startup to avoid.
     */
    fun migrateOnboardingFlags() {
        if (plainPrefs.getBoolean(KEY_ONBOARDING_MIGRATED, false)) return
        try {
            val edit = plainPrefs.edit()
            if (prefs.contains(KEY_ONBOARDING)) {
                edit.putBoolean(KEY_ONBOARDING, prefs.getBoolean(KEY_ONBOARDING, false))
            }
            if (prefs.contains(KEY_FIRST_LAUNCH)) {
                edit.putBoolean(KEY_FIRST_LAUNCH, prefs.getBoolean(KEY_FIRST_LAUNCH, true))
            }
            edit.putBoolean(KEY_ONBOARDING_MIGRATED, true).apply()
        } catch (e: Exception) {
            Log.w("SessionManager", "Onboarding flag migration skipped: ${e.message}")
        }
    }
}
