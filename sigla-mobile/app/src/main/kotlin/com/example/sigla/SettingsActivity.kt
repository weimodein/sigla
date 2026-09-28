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
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.google.android.material.button.MaterialButton

/**
 * The profile card's name line: the stored name, or a friendly fallback when
 * none has been set (spec §5's onboarding name step is optional).
 */
internal fun profileDisplayName(userName: String?): String =
    userName?.trim()?.takeIf { it.isNotEmpty() } ?: "Add your name"

/**
 * The profile card's avatar initial: the first letter of the stored name,
 * upper-cased, or a generic mark when there is no name to draw one from.
 */
internal fun profileInitial(userName: String?): String =
    userName?.trim()?.firstOrNull()?.uppercaseChar()?.toString() ?: "?"

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
 *   - Name (profile card, "Tap to change your name")
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var appSettings: AppSettings

    // In-memory state, mirrors AppSettings (the store MainActivity/WordDetailActivity's
    // TTS actually reads — everything here must go through it, not a separate prefs file)
    private var currentVolume   = 0
    private var currentVoice    = "MALE"
    private var currentDarkMode = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        appSettings = AppSettings.getInstance(this)

        BottomNavHelper.setup(this, Tab.SETTINGS)
        loadPreferences()
        bindProfileCard()
        bindVolumeSeekBar()
        bindVoiceToggle()
        bindDarkModeSwitch()
        bindResetButton()
        bindReplayTutorial()
    }

    override fun onResume() {
        super.onResume()
        // The name can also change from the onboarding replay flow, which
        // returns here without recreating this Activity.
        refreshProfileCard()
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
        val onColor  = getColor(R.color.sg_on_brand)
        val offColor = getColor(R.color.sg_brand_text)
        val onTint   = getColorStateList(R.color.sg_brand)
        val offTint  = getColorStateList(R.color.sg_tint)

        if (voice == "MALE") {
            male?.backgroundTintList = onTint
            male?.setTextColor(onColor)
            female?.backgroundTintList = offTint
            female?.setTextColor(offColor)
        } else {
            female?.backgroundTintList = onTint
            female?.setTextColor(onColor)
            male?.backgroundTintList = offTint
            male?.setTextColor(offColor)
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
                refreshProfileCard()

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

    // ── Profile (name) ────────────────────────────────────────────────────────

    private fun bindProfileCard() {
        refreshProfileCard()
        findViewById<View>(R.id.rowProfile).setOnClickListener { showEditNameDialog() }
    }

    private fun refreshProfileCard() {
        val name = appSettings.userName
        findViewById<TextView>(R.id.tvProfileName).text = profileDisplayName(name)
        findViewById<TextView>(R.id.tvProfileInitial).text = profileInitial(name)
    }

    private fun showEditNameDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_edit_field, null, false)
        val til = dialogView.findViewById<TextInputLayout>(R.id.tilDialogField)
        val et = dialogView.findViewById<TextInputEditText>(R.id.etDialogField)
        val current = appSettings.userName.orEmpty()

        til.hint = "Your first name"
        til.counterMaxLength = 40
        til.isCounterEnabled = true
        et.setText(current)
        et.setSelection(current.length)

        val dialog = AlertDialog.Builder(this)
            .setTitle("What should we call you?")
            .setView(dialogView)
            .setPositiveButton("Save", null)
            .setNegativeButton("Cancel", null)
            .create()

        dialog.setOnShowListener {
            et.requestFocus()
            // A blank name is a valid choice here (it clears the greeting back
            // to "no name"), unlike WordBankActivity's category-name dialogs.
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                appSettings.userName = et.text.toString()
                refreshProfileCard()
                dialog.dismiss()
            }
        }

        dialog.show()
    }

    // ── Replay tutorial ───────────────────────────────────────────────────────

    private fun bindReplayTutorial() {
        findViewById<View>(R.id.rowReplayTutorial).setOnClickListener {
            appSettings.isOnboardingDone = false
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
        }
    }

    // ── Back press ────────────────────────────────────────────────────────────

    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        BottomNavHelper.open(this, Tab.HOME)
    }
}
