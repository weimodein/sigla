package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.drawerlayout.widget.DrawerLayout
import com.google.android.material.button.MaterialButton
import com.google.android.material.button.MaterialButtonToggleGroup

class SettingsActivity : AppCompatActivity() {

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var appSettings: AppSettings

    private lateinit var seekVolume: SeekBar
    private lateinit var tvVolumeValue: TextView
    private lateinit var toggleVoice: MaterialButtonToggleGroup
    private lateinit var seekTextSize: SeekBar
    private lateinit var tvTextSizeValue: TextView
    private lateinit var tvTextPreview: TextView
    private lateinit var switchDarkMode: SwitchCompat

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        appSettings = AppSettings.getInstance(this)
        drawerLayout = findViewById(R.id.drawerLayout)

        // Sidebar
        val sidebar = drawerLayout.getChildAt(1)
        NavigationHelper.setup(this, drawerLayout, sidebar, Screen.SETTINGS)
        findViewById<MaterialButton>(R.id.btnMenu).setOnClickListener {
            drawerLayout.openDrawer(sidebar)
        }

        seekVolume = findViewById(R.id.seekVolume)
        tvVolumeValue = findViewById(R.id.tvVolumeValue)
        toggleVoice = findViewById(R.id.toggleVoice)
        seekTextSize = findViewById(R.id.seekTextSize)
        tvTextSizeValue = findViewById(R.id.tvTextSizeValue)
        tvTextPreview = findViewById(R.id.tvTextPreview)
        switchDarkMode = findViewById(R.id.switchDarkMode)

        loadSettings()
        setupListeners()

        // Reset to default
        findViewById<MaterialButton>(R.id.btnResetDefaults).setOnClickListener {
            AlertDialog.Builder(this)
                .setMessage(getString(R.string.reset_confirm))
                .setPositiveButton("Reset") { _, _ ->
                    appSettings.resetToDefault()
                    loadSettings()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        // Replay tutorial
        findViewById<MaterialButton>(R.id.btnReplayTutorial).setOnClickListener {
            val session = SessionManager.getInstance(this)
            session.isOnboardingDone = false
            startActivity(Intent(this, OnboardingActivity::class.java))
        }
    }

    private fun loadSettings() {
        seekVolume.progress = appSettings.volume
        tvVolumeValue.text = "${appSettings.volume}%"

        toggleVoice.check(
            if (appSettings.voiceType == AppSettings.VOICE_MALE) R.id.btnVoiceMale
            else R.id.btnVoiceFemale
        )

        seekTextSize.progress = appSettings.textSize
        tvTextSizeValue.text = "${appSettings.textSize}sp"
        tvTextPreview.textSize = appSettings.textSize.toFloat()

        switchDarkMode.isChecked = appSettings.isDarkMode
    }

    private fun setupListeners() {
        // Volume
        seekVolume.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                tvVolumeValue.text = "$progress%"
                if (fromUser) appSettings.volume = progress
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        // Voice type
        toggleVoice.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (isChecked) {
                appSettings.voiceType = when (checkedId) {
                    R.id.btnVoiceMale -> AppSettings.VOICE_MALE
                    else -> AppSettings.VOICE_FEMALE
                }
            }
        }

        // Text size
        seekTextSize.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                tvTextSizeValue.text = "${progress}sp"
                tvTextPreview.textSize = progress.toFloat()
                if (fromUser) appSettings.textSize = progress
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        // Dark mode
        switchDarkMode.setOnCheckedChangeListener { _, isChecked ->
            appSettings.isDarkMode = isChecked
        }
    }
}
