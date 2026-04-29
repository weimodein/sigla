package com.example.sigla

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.view.GravityCompat
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import android.widget.ImageView
import android.widget.LinearLayout
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.launch

/**
 * SettingsActivity.kt
 *
 * Preferences managed:
 *   - Volume level (0–100%)
 *   - Voice type: Male / Female (for TTS)
 *   - Text size: 80%–150% via SeekBar (default 100%)
 *   - Dark / Light mode toggle
 *   - Reset to default
 *   - Replay onboarding tutorial
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var drawer: DrawerLayout
    private lateinit var session: SessionManager

    // ── Default values ────────────────────────────────────────────────────────
    companion object {
        const val DEFAULT_VOLUME         = 70
        const val DEFAULT_VOICE          = "MALE"   // "MALE" or "FEMALE"
        const val DEFAULT_DARK_MODE      = false

        // SharedPreferences keys
        const val PREF_VOLUME    = "pref_volume"
        const val PREF_VOICE     = "pref_voice_type"
        const val PREF_DARK_MODE = "pref_dark_mode"
    }

    // In-memory state
    private var currentVolume   = DEFAULT_VOLUME
    private var currentVoice    = DEFAULT_VOICE
    private var currentDarkMode = DEFAULT_DARK_MODE

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        session = SessionManager.getInstance(this)
        drawer = findViewById(R.id.drawerLayout)

        setupTopBar()
        setupSidebar()
        loadPreferences()
        lifecycleScope.launch { try { pullAndApplySettings() } catch (_: Exception) { } }
        bindVolumeSeekBar()
        bindVoiceToggle()
        bindDarkModeSwitch()
        bindResetButton()
        bindReplayTutorial()
    }

    override fun onResume() {
        super.onResume()
        refreshSidebarAuthState()
    }
    // ── Refresh Sidebar ───────────────────────────────────────────────────────────────

    private fun refreshSidebarAuthState() {
        val sidebar = drawer.getChildAt(1) ?: return
        val tvUsername = sidebar.findViewById<TextView>(R.id.tvSidebarUsername)
        val tvEmail = sidebar.findViewById<TextView>(R.id.tvSidebarEmail)
        val btnSignIn = sidebar.findViewById<MaterialButton>(R.id.btnSidebarSignIn)
        if (session.isLoggedIn) {
            tvUsername?.text = session.username ?: "User"
            tvEmail?.text = session.email ?: ""
            btnSignIn?.visibility = View.GONE
        } else {
            tvUsername?.text = "Guest User"
            tvEmail?.text = "Not signed in"
            btnSignIn?.visibility = View.VISIBLE
        }
    }  

    private fun openAuthDialog() {
        val dialog = AuthDialogFragment()
        dialog.onSignedIn = {
            refreshSidebarAuthState()
            // Optional: reload data that requires login
            // finish()
            // startActivity(intent)
        }
        dialog.show(supportFragmentManager, "auth")
    }
    // ── Top bar ───────────────────────────────────────────────────────────────

    private fun setupTopBar() {
        val btnSidebar = findViewById<View>(R.id.btnSidebar)
        btnSidebar.setOnClickListener { drawer.openDrawer(GravityCompat.START) }
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────

    private fun setupSidebar() {
        refreshSidebarAuthState()
        setActiveNavItem(R.id.navSettings)

        findViewById<View>(R.id.navMainInterface)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.navWordBank)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, WordBankActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.navTranslationHistory)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, TranslationHistoryActivity::class.java))
            finish()
        }

        findViewById<View>(R.id.navNotifications)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, NotificationsActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.navProfile)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {                    // ← ADD THIS CHECK
                startActivity(Intent(this, ProfileActivity::class.java))
                finish()
            } else {
                openAuthDialog()                         // ← ADD THIS
            }
        }
        findViewById<View>(R.id.navSettings)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
        }
        findViewById<View>(R.id.btnSidebarSignIn)?.setOnClickListener {
            drawer.closeDrawers()
            openAuthDialog()  // ← You need to add openAuthDialog method
        }
    }


    private fun setActiveNavItem(activeId: Int) {
        val navIds = listOf(
            R.id.navMainInterface,
            R.id.navWordBank,
            R.id.navTranslationHistory,
            R.id.navNotifications,
            R.id.navProfile,
            R.id.navSettings
        )
        navIds.forEach { id ->
            val view = findViewById<LinearLayout>(id)
            if (id == activeId) {
                view?.setBackgroundResource(R.drawable.bg_nav_item_selected)
                (view?.getChildAt(0) as? ImageView)?.imageTintList =
                    android.content.res.ColorStateList.valueOf(0xFF4A90E2.toInt())
                (view?.getChildAt(1) as? TextView)?.apply {
                    setTextColor(0xFF4A90E2.toInt())
                    setTypeface(null, android.graphics.Typeface.BOLD)
                }
            } else {
                view?.setBackgroundResource(R.drawable.bg_nav_item_default)
                (view?.getChildAt(0) as? ImageView)?.imageTintList =
                    android.content.res.ColorStateList.valueOf(0xFF6C757D.toInt())
                (view?.getChildAt(1) as? TextView)?.apply {
                    setTextColor(0xFF6C757D.toInt())
                    setTypeface(null, android.graphics.Typeface.NORMAL)
                }
            }
        }
    }

    // ── Backend sync ──────────────────────────────────────────────────────────

    private suspend fun pullAndApplySettings() {
        if (!session.isLoggedIn) return
        val response = try {
            ApiClient.get(session.token).getMySettings()
        } catch (_: Exception) { return }
        if (!response.isSuccessful) return
        val s = response.body()?.settings ?: return

        // Write to SettingsActivity's prefs
        getSharedPreferences("sigla_prefs", Context.MODE_PRIVATE).edit()
            .putString(PREF_VOICE, s.voice_type.uppercase())
            .putBoolean(PREF_DARK_MODE, s.dark_mode)
            .apply()

        // Keep AppSettings in sync
        val app = AppSettings.getInstance(this)
        app.voiceType  = s.voice_type
        app.isDarkMode = s.dark_mode

        AppCompatDelegate.setDefaultNightMode(
            if (s.dark_mode) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
        )
        loadPreferences()
    }

    private fun pushSettings() {
        if (!session.isLoggedIn) return
        lifecycleScope.launch {
            try {
                ApiClient.get(session.token).updateMySettings(
                    UpdateSettingsRequest(
                        voice_type = currentVoice.lowercase(),
                        dark_mode  = currentDarkMode
                    )
                )
            } catch (_: Exception) { }
        }
    }

    // ── Load saved preferences ────────────────────────────────────────────────

    private fun loadPreferences() {
        val prefs = getSharedPreferences("sigla_prefs", Context.MODE_PRIVATE)
        currentVolume = prefs.getInt(PREF_VOLUME, DEFAULT_VOLUME)
        currentVoice = prefs.getString(PREF_VOICE, DEFAULT_VOICE) ?: DEFAULT_VOICE
        currentDarkMode = prefs.getBoolean(PREF_DARK_MODE, DEFAULT_DARK_MODE)

        // Volume
        findViewById<SeekBar>(R.id.seekVolume)?.progress = currentVolume
        findViewById<TextView>(R.id.tvVolumeValue)?.text = "$currentVolume%"

        // Voice
        applyVoiceSelection(currentVoice, animate = false)

        // Hide unused text size controls
        //findViewById<View>(R.id.seekTextSize)?.visibility = View.GONE
        //findViewById<View>(R.id.tvTextSizeValue)?.visibility = View.GONE

        // Dark mode
        val darkSwitch = findViewById<SwitchMaterial>(R.id.switchDarkMode)
        darkSwitch?.isChecked = currentDarkMode
        updateDarkModeSubtitle(currentDarkMode)
    }

    private fun savePreference(key: String, value: Any) {
        val prefs = getSharedPreferences("sigla_prefs", Context.MODE_PRIVATE)
        with(prefs.edit()) {
            when (value) {
                is Int -> putInt(key, value)
                is String -> putString(key, value)
                is Boolean -> putBoolean(key, value)
            }
            apply()
        }
    }

    // ── Volume ────────────────────────────────────────────────────────────────

    private fun bindVolumeSeekBar() {
        val seekBar = findViewById<SeekBar>(R.id.seekVolume)
        val tvValue = findViewById<TextView>(R.id.tvVolumeValue)

        seekBar?.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                currentVolume = progress
                tvValue?.text = "$progress%"
                if (fromUser) {
                    savePreference(PREF_VOLUME, currentVolume)
                }
            }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) { /* volume is local-only, no server sync */ }
        })
    }

    // ── Voice type ────────────────────────────────────────────────────────────

    private fun bindVoiceToggle() {
        findViewById<View>(R.id.btnVoiceMale)?.setOnClickListener {
            applyVoiceSelection("MALE")
            savePreference(PREF_VOICE, "MALE")
            pushSettings()
        }
        findViewById<View>(R.id.btnVoiceFemale)?.setOnClickListener {
            applyVoiceSelection("FEMALE")
            savePreference(PREF_VOICE, "FEMALE")
            pushSettings()
        }
    }

    private fun applyVoiceSelection(voice: String, animate: Boolean = true) {
        currentVoice = voice
        val male   = findViewById<TextView>(R.id.btnVoiceMale)
        val female = findViewById<TextView>(R.id.btnVoiceFemale)
        val selectedBg      = R.drawable.bg_toggle_selected
        val unselectedBg    = android.R.color.transparent
        val selectedColor   = getColor(android.R.color.white)
        val unselectedColor = getColor(android.R.color.darker_gray)

        if (voice == "MALE") {
            male?.setBackgroundResource(selectedBg)
            male?.setTextColor(selectedColor)
            male?.setTypeface(null, android.graphics.Typeface.BOLD)
            female?.setBackgroundResource(unselectedBg)
            female?.setTextColor(unselectedColor)
            female?.setTypeface(null, android.graphics.Typeface.NORMAL)
        } else {
            female?.setBackgroundResource(selectedBg)
            female?.setTextColor(selectedColor)
            female?.setTypeface(null, android.graphics.Typeface.BOLD)
            male?.setBackgroundResource(unselectedBg)
            male?.setTextColor(unselectedColor)
            male?.setTypeface(null, android.graphics.Typeface.NORMAL)
        }
    }

    // ── Dark mode ─────────────────────────────────────────────────────────────

    private fun bindDarkModeSwitch() {
        val switch = findViewById<SwitchMaterial>(R.id.switchDarkMode)
        switch?.setOnCheckedChangeListener { _, isChecked ->
            currentDarkMode = isChecked
            updateDarkModeSubtitle(isChecked)
            savePreference(PREF_DARK_MODE, isChecked)
            AppCompatDelegate.setDefaultNightMode(
                if (isChecked) AppCompatDelegate.MODE_NIGHT_YES
                else AppCompatDelegate.MODE_NIGHT_NO
            )
            pushSettings()
        }
    }

    private fun updateDarkModeSubtitle(isDark: Boolean) {
        val label = if (isDark) "Currently using Dark mode" else "Currently using Light mode"
        findViewById<TextView>(R.id.tvDarkModeSubtitle)?.text = label
    }

    // ── Reset to default ──────────────────────────────────────────────────────

    private fun bindResetButton() {
        findViewById<View>(R.id.btnResetDefaults).setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Reset to Default")
                .setMessage("All settings will be restored to their original configuration. Continue?")
                .setPositiveButton("Reset") { _, _ ->
                    currentVolume = DEFAULT_VOLUME
                    currentVoice = DEFAULT_VOICE
                    currentDarkMode = DEFAULT_DARK_MODE

                    savePreference(PREF_VOLUME, currentVolume)
                    savePreference(PREF_VOICE, currentVoice)
                    savePreference(PREF_DARK_MODE, currentDarkMode)

                    loadPreferences()
                    pushSettings()

                    AppCompatDelegate.setDefaultNightMode(
                        if (currentDarkMode) AppCompatDelegate.MODE_NIGHT_YES
                        else AppCompatDelegate.MODE_NIGHT_NO
                    )

                    Toast.makeText(this, "Settings reset to default.", Toast.LENGTH_SHORT).show()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }

    // ── Replay tutorial ───────────────────────────────────────────────────────

    private fun bindReplayTutorial() {
        findViewById<View>(R.id.rowReplayTutorial).setOnClickListener {
            session.isOnboardingDone = false
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
        }
    }

    // ── Back press ────────────────────────────────────────────────────────────

    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        if (drawer.isDrawerOpen(GravityCompat.START)) {
            drawer.closeDrawer(GravityCompat.START)
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }
}