package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import com.example.sigla.databinding.ActivitySplashBinding

// How long the logo and name stay up after the system splash hands over. Kept
// short on purpose: this is a deliberate wait on every cold start, on top of the
// system splash that covers actual startup.
private const val INTRO_HOLD_MS = 500L

/**
 * Launcher. Holds the logo and app name for a moment after the system splash,
 * then hands off to Home, which still routes first-time users on to onboarding.
 * The logo and name are one image (splash_icon), shared with the system splash
 * so both appear on its very first frame.
 *
 * Only a cold start comes through here: once this finishes, relaunching from
 * the home screen or recents resumes the existing task at whatever screen was
 * on top.
 */
class SplashActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private val goHome = Runnable { openHome() }
    private var leaving = false

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)

        // Drop the system splash the moment our first frame is ready rather than
        // letting it fade: that frame is the same logo in the same place, so a
        // fade would only show a brief double exposure.
        splash.setOnExitAnimationListener { it.remove() }

        // Edge-to-edge so the layout centres on the whole window, as the splash does.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        val binding = ActivitySplashBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.setOnClickListener { openHome() }

        handler.postDelayed(goHome, INTRO_HOLD_MS)
    }

    private fun openHome() {
        if (leaving) return
        leaving = true
        handler.removeCallbacks(goHome)
        startActivity(Intent(this, HomeActivity::class.java))
        @Suppress("DEPRECATION")
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        finish()
    }

    override fun onStop() {
        // Left during the hold (Home button, a call). Firing while backgrounded would
        // hit Android's background-activity-start block and finish() into an
        // empty task, so hold the hop until the user comes back.
        handler.removeCallbacks(goHome)
        super.onStop()
    }

    override fun onRestart() {
        super.onRestart()
        // They have seen the intro; don't replay it.
        openHome()
    }

    override fun onDestroy() {
        // Back during the hold closes the app; the pending hop to Home must not
        // reopen it afterwards.
        handler.removeCallbacks(goHome)
        super.onDestroy()
    }
}
