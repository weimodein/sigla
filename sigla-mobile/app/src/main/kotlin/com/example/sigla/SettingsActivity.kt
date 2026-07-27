package com.example.sigla

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
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import android.widget.ImageView
import android.widget.LinearLayout
import com.google.android.material.button.MaterialButton

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
    private lateinit var appSettings: AppSettings

    // In-memory state, mirrors AppSettings (the store MainActivity/WordDetailActivity's
    // TTS actually reads — everything here must go through it, not a separate prefs file)
    private var currentVolume   = 0
    private var currentVoice    = "MALE"
    private var currentDarkMode = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        session = SessionManager.getInstance(this)
        appSettings = AppSettings.getInstance(this)
        drawer = findViewById(R.id.drawerLayout)

        setupTopBar()
        setupSidebar()
        loadPreferences()
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

    // ── Load saved preferences ────────────────────────────────────────────────

    private fun loadPreferences() {
        currentVolume = appSettings.volume
        currentVoice = if (appSettings.voiceType == AppSettings.VOICE_FEMALE) "FEMALE" else "MALE"
        currentDarkMode = appSettings.isDarkMode

        // Volume
        findViewById<SeekBar>(R.id.seekVolume)?.progress = currentVolume
        findViewById<TextView>(R.id.tvVolumeValue)?.text = "$currentVolume%"

        // Voice
        applyVoiceSelection(currentVoice, animate = false)

        // Dark mode
        val darkSwitch = findViewById<SwitchMaterial>(R.id.switchDarkMode)
        darkSwitch?.isChecked = currentDarkMode
        updateDarkModeSubtitle(currentDarkMode)
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
                    appSettings.volume = currentVolume
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
            appSettings.voiceType = AppSettings.VOICE_MALE
            // The chosen Voice is cached against the preference, so changing it
            // has to drop the cache or playback would keep the old voice.
            TtsVoiceHelper.invalidate()
        }
        findViewById<View>(R.id.btnVoiceFemale)?.setOnClickListener {
            applyVoiceSelection("FEMALE")
            appSettings.voiceType = AppSettings.VOICE_FEMALE
            TtsVoiceHelper.invalidate()
        }
    }

    private fun applyVoiceSelection(voice: String, animate: Boolean = true) {
        currentVoice = voice
        val male   = findViewById<TextView>(R.id.btnVoiceMale)
        val female = findViewById<TextView>(R.id.btnVoiceFemale)
        val selectedColor   = getColor(android.R.color.white)
        val unselectedColor = getColor(R.color.sig_toggle_unselected_text)

        if (voice == "MALE") {
            male?.setBackgroundResource(R.drawable.bg_toggle_selected)
            male?.setTextColor(selectedColor)
            female?.setBackgroundResource(R.drawable.bg_toggle_unselected_blue)
            female?.setTextColor(unselectedColor)
        } else {
            female?.setBackgroundResource(R.drawable.bg_toggle_selected)
            female?.setTextColor(selectedColor)
            male?.setBackgroundResource(R.drawable.bg_toggle_unselected_blue)
            male?.setTextColor(unselectedColor)
        }
    }

    // ── Dark mode ─────────────────────────────────────────────────────────────

    private fun bindDarkModeSwitch() {
        val switch = findViewById<SwitchMaterial>(R.id.switchDarkMode)
        switch?.setOnCheckedChangeListener { _, isChecked ->
            currentDarkMode = isChecked
            updateDarkModeSubtitle(isChecked)
            appSettings.isDarkMode = isChecked
            AppCompatDelegate.setDefaultNightMode(
                if (isChecked) AppCompatDelegate.MODE_NIGHT_YES
                else AppCompatDelegate.MODE_NIGHT_NO
            )
        }
    }

    private fun updateDarkModeSubtitle(isDark: Boolean) {
        val label = if (isDark) "Currently using Dark mode" else "Currently using Light mode"
        findViewById<TextView>(R.id.tvDarkModeSubtitle)?.text = label
    }

    // ── Reset to default ──────────────────────────────────────────────────────

    private fun bindResetButton() {
        findViewById<View>(R.id.btnResetDefaults).setOnClickListener {
            val view = layoutInflater.inflate(R.layout.dialog_confirm_action, null)
            val dialog = AlertDialog.Builder(this).setView(view).create()
            dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

            view.findViewById<TextView>(R.id.tvConfirmTitle).text = "Reset to default?"
            view.findViewById<TextView>(R.id.tvConfirmMessage).text =
                "All settings will be restored to their original configuration."
            view.findViewById<MaterialButton>(R.id.btnConfirmAction).text = "RESET"

            view.findViewById<MaterialButton>(R.id.btnConfirmCancel).setOnClickListener { dialog.dismiss() }
            view.findViewById<MaterialButton>(R.id.btnConfirmAction).setOnClickListener {
                appSettings.resetToDefault()
                TtsVoiceHelper.invalidate()   // resets voiceType as well
                loadPreferences()

                AppCompatDelegate.setDefaultNightMode(
                    if (currentDarkMode) AppCompatDelegate.MODE_NIGHT_YES
                    else AppCompatDelegate.MODE_NIGHT_NO
                )

                Toast.makeText(this, "Settings reset to default.", Toast.LENGTH_SHORT).show()
                dialog.dismiss()
            }

            dialog.show()
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