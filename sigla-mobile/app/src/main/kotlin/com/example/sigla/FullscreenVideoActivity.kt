package com.example.sigla

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.media.MediaPlayer
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.VideoView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.android.material.button.MaterialButton

/**
 * Fullscreen demo video, opened from WordDetailActivity.
 *
 * Turns landscape for a landscape clip and stays portrait for a portrait one,
 * so the video fills the screen the long way either way. The rest of the app
 * is portrait-only; only this screen rotates. Starts at the caller's position
 * and speed, and hands its final position back so the detail screen resumes
 * where fullscreen left off.
 */
class FullscreenVideoActivity : AppCompatActivity() {

    companion object {
        private const val EXTRA_SOURCE = "extra_source"
        private const val EXTRA_POSITION = "extra_position"
        private const val EXTRA_SPEED = "extra_speed"
        private const val EXTRA_LANDSCAPE = "extra_landscape"
        private const val EXTRA_PLAYING = "extra_playing"
        const val RESULT_POSITION = "result_position"
        const val RESULT_PLAYING = "result_playing"

        fun intent(context: Context, source: String, positionMs: Int, speed: Float, landscape: Boolean, playing: Boolean) =
            Intent(context, FullscreenVideoActivity::class.java)
                .putExtra(EXTRA_SOURCE, source)
                .putExtra(EXTRA_POSITION, positionMs)
                .putExtra(EXTRA_SPEED, speed)
                .putExtra(EXTRA_LANDSCAPE, landscape)
                .putExtra(EXTRA_PLAYING, playing)
    }

    private lateinit var video: VideoView
    private lateinit var progress: ProgressBar
    private lateinit var controls: FrameLayout
    private lateinit var btnPlayPause: MaterialButton

    private var player: MediaPlayer? = null
    private var speed = 1f
    private var resumePosition = 0
    // Whether the user wants it playing — survives the surface being torn
    // down and rebuilt when the app goes to the background.
    private var shouldPlay = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation =
            if (intent.getBooleanExtra(EXTRA_LANDSCAPE, false)) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            else ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        setContentView(R.layout.activity_fullscreen_video)
        hideSystemBars()

        video = findViewById(R.id.videoFullscreen)
        progress = findViewById(R.id.progressFullscreen)
        controls = findViewById(R.id.fullscreenControls)
        btnPlayPause = findViewById(R.id.btnFullscreenPlayPause)

        speed = intent.getFloatExtra(EXTRA_SPEED, 1f)
        shouldPlay = intent.getBooleanExtra(EXTRA_PLAYING, false)
        resumePosition = savedInstanceState?.getInt(EXTRA_POSITION)
            ?: intent.getIntExtra(EXTRA_POSITION, 0)

        findViewById<MaterialButton>(R.id.btnExitFullscreen).setOnClickListener { finishWithPosition() }
        btnPlayPause.setOnClickListener { togglePlay() }
        controls.setOnClickListener { toggleControls() }
        // Back returns the position too, not just the exit button.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = finishWithPosition()
        })

        video.setOnPreparedListener { mp ->
            player = mp
            // Plays once, like the detail screen — no looping.
            mp.isLooping = false
            progress.visibility = View.GONE
            video.seekTo(resumePosition)
            if (shouldPlay) play() else pause()
        }
        video.setOnCompletionListener {
            resumePosition = 0
            video.seekTo(0)
            pause()
        }
        video.setOnErrorListener { _, _, _ ->
            progress.visibility = View.GONE
            finishWithPosition()
            true
        }
        video.setVideoPath(intent.getStringExtra(EXTRA_SOURCE) ?: run { finish(); return })
    }

    private fun play() {
        video.start()
        // Speed is set only while playing: on Android 6+ setting a non-zero
        // speed on a paused MediaPlayer starts it, which would override a pause.
        player?.let { mp -> runCatching { mp.playbackParams = mp.playbackParams.setSpeed(speed) } }
        shouldPlay = true
        btnPlayPause.setIconResource(R.drawable.ic_pause)
        btnPlayPause.contentDescription = "Pause"
        // Hide the controls once it's playing, so they don't cover the sign.
        controls.postDelayed({ if (video.isPlaying) controls.visibility = View.GONE }, 1500)
    }

    private fun pause() {
        video.pause()
        shouldPlay = false
        btnPlayPause.setIconResource(R.drawable.ic_play)
        btnPlayPause.contentDescription = "Play"
        controls.visibility = View.VISIBLE
    }

    private fun togglePlay() = if (video.isPlaying) pause() else play()

    private fun toggleControls() {
        controls.visibility = if (controls.visibility == View.VISIBLE) View.GONE else View.VISIBLE
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun finishWithPosition() {
        setResult(
            Activity.RESULT_OK,
            Intent().putExtra(RESULT_POSITION, currentPosition()).putExtra(RESULT_PLAYING, shouldPlay)
        )
        finish()
    }

    private fun currentPosition(): Int =
        if (player != null) video.currentPosition else resumePosition

    override fun onPause() {
        super.onPause()
        resumePosition = currentPosition()
        video.pause()
        // Back from the background it waits for a tap rather than resuming.
        shouldPlay = false
        btnPlayPause.setIconResource(R.drawable.ic_play)
        controls.visibility = View.VISIBLE
        // VideoView releases its MediaPlayer when the surface goes away; a new
        // one arrives through onPrepared when the screen comes back.
        player = null
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(EXTRA_POSITION, currentPosition())
    }

    override fun onDestroy() {
        video.stopPlayback()
        super.onDestroy()
    }
}
