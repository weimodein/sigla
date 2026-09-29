package com.example.sigla

import android.animation.ValueAnimator
import android.content.Intent
import android.graphics.drawable.Drawable
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import com.google.android.material.button.MaterialButton
import com.google.android.material.button.MaterialButtonToggleGroup
import com.google.android.material.card.MaterialCardView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.Locale

/** Copy for the single-video download confirmation. */
internal data class WordDownloadPrompt(val title: String, val message: String, val action: String)

/**
 * Wording for confirming one word's demo-video download. Matches Word Bank's
 * "Download all" dialog: same data warning on mobile data, and no size, because
 * the backend has no size metadata for video_url.
 */
internal fun wordDownloadPrompt(wordName: String, metered: Boolean): WordDownloadPrompt {
    val base = "The demo video for \"$wordName\" will be saved for offline use."
    return WordDownloadPrompt(
        title = "Download this video?",
        message = if (metered) {
            "$base\n\nYou're on mobile data. This may use a significant amount of data — " +
                "Wi-Fi is recommended."
        } else {
            base
        },
        action = if (metered) "Download anyway" else "Download",
    )
}

/**
 * Full-screen word detail: the word, its demo video/image, controls for
 * learning the sign (play/pause, seek, replay, speed, fullscreen), offline
 * download, and an Add to Favorites toggle. Reached by tapping a word anywhere
 * in Word Bank or a category word list.
 *
 * The media stage takes the shape of the media in it (see fitStageTo): demo
 * videos come straight from whatever phone recorded them, so they arrive in
 * both portrait and landscape, and a fixed-height box either shrank portrait
 * clips to a strip or left dead bands around landscape ones.
 */
class WordDetailActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_WORD_ID = "extra_word_id"

        private const val PREFS = "word_detail"
        private const val KEY_SPEED = "demo_speed"
        // Shape of the stage before the media's real shape is known.
        private const val DEFAULT_ASPECT = 16f / 9f
        // A portrait clip may take at most this share of the screen height, so
        // the controls below it stay reachable without scrolling on most phones.
        private const val MAX_STAGE_HEIGHT_FRACTION = 0.55f
    }

    private lateinit var btnBack: MaterialButton
    private lateinit var tvDetailCategoryTitle: TextView
    private lateinit var tvDetailWord: TextView
    private lateinit var tvDetailFilipino: TextView
    private lateinit var btnSpeak: MaterialButton
    private lateinit var tvCategoryChip: TextView
    private lateinit var tvOfflineBadge: TextView
    private lateinit var contentColumn: LinearLayout
    private lateinit var cardMedia: MaterialCardView
    private lateinit var ivThumbnail: ImageView
    private lateinit var videoDemo: VideoView
    private lateinit var noMediaPlaceholder: LinearLayout
    private lateinit var tvPlaceholderIcon: TextView
    private lateinit var tvPlaceholderText: TextView
    private lateinit var btnRetry: MaterialButton
    private lateinit var progressVideo: ProgressBar
    private lateinit var playOverlay: FrameLayout
    private lateinit var tvMediaCaption: TextView
    private lateinit var controlsPanel: LinearLayout
    private lateinit var btnPlayPause: MaterialButton
    private lateinit var seekVideo: SeekBar
    private lateinit var tvTime: TextView
    private lateinit var btnReplay: MaterialButton
    private lateinit var speedGroup: MaterialButtonToggleGroup
    private lateinit var btnFullscreen: MaterialButton
    private lateinit var btnDownload: MaterialButton
    private lateinit var btnAddToFavorites: MaterialButton
    private lateinit var cardTryIt: View
    private lateinit var favoritesManager: FavoritesManager

    private var word: WordBankWord? = null

    private var tts: TextToSpeech? = null
    private var isTtsReady = false
    // Set when the word arrives before the TTS engine is ready, so the
    // automatic first pronunciation isn't silently dropped.
    private var pendingSpeech: String? = null
    private val appSettings by lazy { AppSettings.getInstance(this) }
    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }

    // ── Player state ──────────────────────────────────────────────────────────
    private var remoteVideoUrl: String? = null
    // What the VideoView is currently loaded with (local path or URL).
    private var loadedSource: String? = null
    // Valid only between onPrepared and the surface being released (onPause).
    private var player: MediaPlayer? = null
    private var videoAspect: Float? = null
    private var durationMs = 0
    private var resumePosition = 0
    // Whether the user wants it playing. Survives the VideoView tearing its
    // player down when the app goes to the background.
    private var shouldPlay = false
    private var isUserSeeking = false
    private var speed = 1f
    private var stageAnimator: ValueAnimator? = null

    private val progressHandler = Handler(Looper.getMainLooper())
    private val progressTick = object : Runnable {
        override fun run() {
            if (player != null && !isUserSeeking) {
                val pos = videoDemo.currentPosition
                seekVideo.progress = pos
                tvTime.text = "${formatTime(pos)} / ${formatTime(durationMs)}"
            }
            progressHandler.postDelayed(this, 250)
        }
    }

    private val fullscreenLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data ?: return@registerForActivityResult
            resumePosition = data.getIntExtra(FullscreenVideoActivity.RESULT_POSITION, resumePosition)
            // Back from fullscreen it waits, paused at the same spot: the demo
            // never starts without a tap. The VideoView rebuilds its player
            // when this screen is visible again and onPrepared seeks there.
            shouldPlay = false
            if (player != null) {
                videoDemo.seekTo(resumePosition)
                pause()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_word_detail)

        favoritesManager = FavoritesManager.getInstance(this)
        speed = prefs.getFloat(KEY_SPEED, 1f)

        bindViews()
        btnBack.setOnClickListener { finish() }
        btnSpeak.setOnClickListener { word?.let { speakWord(it.label) } }
        setupPlayerControls()

        // applicationContext: onDestroy shuts this down off the main thread, so
        // the unbind can land after the Activity is gone. Bound through the
        // Activity, that would leak its ServiceConnection.
        tts = TextToSpeech(applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.ENGLISH
                isTtsReady = true
                pendingSpeech?.let { speakWord(it) }
                pendingSpeech = null
            }
        }

        // Give the stage its default shape as soon as the column has a width.
        contentColumn.post { fitStageTo(DEFAULT_ASPECT, animate = false) }

        val wordId = intent.getIntExtra(EXTRA_WORD_ID, -1)
        loadWord(wordId)
    }

    private fun bindViews() {
        btnBack = findViewById(R.id.btnBack)
        tvDetailCategoryTitle = findViewById(R.id.tvDetailCategoryTitle)
        tvDetailWord = findViewById(R.id.tvDetailWord)
        tvDetailFilipino = findViewById(R.id.tvDetailFilipino)
        btnSpeak = findViewById(R.id.btnSpeak)
        tvCategoryChip = findViewById(R.id.tvCategoryChip)
        tvOfflineBadge = findViewById(R.id.tvOfflineBadge)
        contentColumn = findViewById(R.id.contentColumn)
        cardMedia = findViewById(R.id.cardMedia)
        ivThumbnail = findViewById(R.id.ivThumbnail)
        videoDemo = findViewById(R.id.videoDemo)
        noMediaPlaceholder = findViewById(R.id.noMediaPlaceholder)
        tvPlaceholderIcon = findViewById(R.id.tvPlaceholderIcon)
        tvPlaceholderText = findViewById(R.id.tvPlaceholderText)
        btnRetry = findViewById(R.id.btnRetry)
        progressVideo = findViewById(R.id.progressVideo)
        playOverlay = findViewById(R.id.playOverlay)
        tvMediaCaption = findViewById(R.id.tvMediaCaption)
        controlsPanel = findViewById(R.id.controlsPanel)
        btnPlayPause = findViewById(R.id.btnPlayPause)
        seekVideo = findViewById(R.id.seekVideo)
        tvTime = findViewById(R.id.tvTime)
        btnReplay = findViewById(R.id.btnReplay)
        speedGroup = findViewById(R.id.speedGroup)
        btnFullscreen = findViewById(R.id.btnFullscreen)
        btnDownload = findViewById(R.id.btnDownload)
        btnAddToFavorites = findViewById(R.id.btnAddToFavorites)
        cardTryIt = findViewById(R.id.cardTryIt)
    }

    private fun loadWord(wordId: Int) {
        lifecycleScope.launch {
            val cached = ModelUpdateManager.loadCachedWordBank(this@WordDetailActivity)
            var found = cached?.find { it.id == wordId }

            if (found == null) {
                try {
                    val response = ApiClient.get().getWordBank()
                    if (response.isSuccessful) {
                        found = response.body()?.words?.find { it.id == wordId }
                    }
                } catch (_: Exception) {
                    // fall through with found == null
                }
            }

            if (found == null) {
                Toast.makeText(this@WordDetailActivity, "Word not found", Toast.LENGTH_SHORT).show()
                finish()
                return@launch
            }

            bindWord(found)
        }
    }

    private fun bindWord(w: WordBankWord) {
        word = w
        // w.category is a server-assigned field on every word, never a
        // user-typed custom category — same distinction as CategoryGridAdapter.
        val category = w.category.toTitleCase()
        tvDetailCategoryTitle.text = category
        tvCategoryChip.text = category
        tvDetailWord.text = w.label.capitalizeFirst()
        btnSpeak.contentDescription = "Say \"${w.label}\" again"

        setupFavoriteButton(w)
        setupMedia(w)

        val filipino = w.filipino_translation?.trim().orEmpty()
        tvDetailFilipino.text = filipino
        tvDetailFilipino.visibility = if (filipino.isEmpty()) View.GONE else View.VISIBLE

        // Opens the translator on the word's own vocabulary (letters for a letter),
        // falling back to Words when the letters model isn't loaded (see MainActivity).
        cardTryIt.setOnClickListener {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_START_VOCABULARY, effectiveVocabulary(w))
            )
        }

        speakWord(w.label)
    }

    // ── Favorites ─────────────────────────────────────────────────────────────

    private fun setupFavoriteButton(w: WordBankWord) {
        refreshFavoriteButton(favoritesManager.isFavorite(w.id))
        btnAddToFavorites.setOnClickListener {
            val isFavoriteNow = favoritesManager.toggle(w.id)
            refreshFavoriteButton(isFavoriteNow)
            val message = if (isFavoriteNow) "Added to Favorites" else "Removed from Favorites"
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        }
    }

    private fun refreshFavoriteButton(isFavorite: Boolean) {
        btnAddToFavorites.text = if (isFavorite) "Added to Favorites" else "Add to Favorites"
        btnAddToFavorites.setIconResource(if (isFavorite) R.drawable.ic_star_fill else R.drawable.ic_star_line)
    }

    // ── Media (video / image / none) ─────────────────────────────────────────

    private fun setupMedia(w: WordBankWord) {
        val resolvedThumb = ApiClient.resolveUrl(w.thumbnail_url)
        val localThumb = ModelUpdateManager.getLocalThumb(this, w.id)
        val thumbSource: Any? = localThumb ?: resolvedThumb
        val resolvedVideo = ApiClient.resolveUrl(w.video_url)

        // The thumbnail doubles as the video's poster, so load it either way.
        if (thumbSource != null) loadThumbnail(thumbSource)

        when {
            !resolvedVideo.isNullOrBlank() -> setupVideo(w, resolvedVideo, hasPoster = thumbSource != null)

            thumbSource != null -> {
                tvMediaCaption.text = "Sample image of this gesture"
            }

            else -> {
                ivThumbnail.visibility = View.GONE
                showPlaceholder("🤟", "No demo available yet")
                tvMediaCaption.visibility = View.GONE
            }
        }
    }

    private fun loadThumbnail(source: Any) {
        ivThumbnail.visibility = View.VISIBLE
        Glide.with(this)
            .load(source)
            .diskCacheStrategy(DiskCacheStrategy.ALL)
            .listener(object : RequestListener<Drawable> {
                override fun onLoadFailed(
                    e: GlideException?, model: Any?, target: Target<Drawable>, isFirstResource: Boolean
                ): Boolean = false

                override fun onResourceReady(
                    resource: Drawable, model: Any, target: Target<Drawable>?,
                    dataSource: DataSource, isFirstResource: Boolean
                ): Boolean {
                    // Shape the stage to the image until the video's real shape
                    // is known — usually the same, since both come from one clip.
                    val iw = resource.intrinsicWidth
                    val ih = resource.intrinsicHeight
                    if (videoAspect == null && iw > 0 && ih > 0) fitStageTo(iw.toFloat() / ih)
                    return false
                }
            })
            .into(ivThumbnail)
    }

    private fun showPlaceholder(icon: String, text: String, retry: Boolean = false) {
        noMediaPlaceholder.visibility = View.VISIBLE
        tvPlaceholderIcon.text = icon
        tvPlaceholderText.text = text
        btnRetry.visibility = if (retry) View.VISIBLE else View.GONE
    }

    // ── Video ────────────────────────────────────────────────────────────────
    // Play starts immediately, from the offline copy if one exists, otherwise
    // streamed. Saving for offline is a separate button, so watching never
    // waits on a download decision (the old Yes/No dialog on every first play).

    private fun setupVideo(w: WordBankWord, resolvedVideo: String, hasPoster: Boolean) {
        remoteVideoUrl = resolvedVideo
        controlsPanel.visibility = View.VISIBLE
        playOverlay.visibility = View.VISIBLE
        if (!hasPoster) showPlaceholder("🤟", "Tap play to watch the sign")
        tvMediaCaption.text = "Demo Video"
        setControlsEnabled(false)

        playOverlay.setOnClickListener { play() }
        btnRetry.setOnClickListener { loadedSource = null; play() }
        refreshOfflineState(w)
    }

    private fun refreshOfflineState(w: WordBankWord) {
        val saved = ModelUpdateManager.getLocalVideo(this, w.id) != null
        tvOfflineBadge.visibility = if (saved) View.VISIBLE else View.GONE
        btnDownload.visibility = if (saved) View.GONE else View.VISIBLE
        btnDownload.isEnabled = true
        btnDownload.contentDescription = "Download for offline"
        btnDownload.setOnClickListener { confirmDownload(w) }
    }

    // Asks only when Download is pressed. Watching never waits on this: the old
    // dialog that asked on every first play was removed for exactly that reason.
    private fun confirmDownload(w: WordBankWord) {
        val prompt = wordDownloadPrompt(w.label.capitalizeFirst(), NetworkUtils.isMetered(this))

        val view = layoutInflater.inflate(R.layout.dialog_confirm_action, null)
        val dialog = AlertDialog.Builder(this).setView(view).create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        view.findViewById<TextView>(R.id.tvConfirmTitle).text = prompt.title
        view.findViewById<TextView>(R.id.tvConfirmMessage).text = prompt.message
        view.findViewById<MaterialButton>(R.id.btnConfirmAction).text = prompt.action
        view.findViewById<MaterialButton>(R.id.btnConfirmCancel).setOnClickListener { dialog.dismiss() }
        view.findViewById<MaterialButton>(R.id.btnConfirmAction).setOnClickListener {
            dialog.dismiss()
            downloadForOffline(w)
        }
        dialog.show()
    }

    private fun downloadForOffline(w: WordBankWord) {
        val url = remoteVideoUrl ?: return
        btnDownload.isEnabled = false
        btnDownload.contentDescription = "Downloading"
        lifecycleScope.launch {
            val file = ModelUpdateManager.downloadWordVideo(this@WordDetailActivity, w.id, url)
            if (file == null) {
                Toast.makeText(this@WordDetailActivity, "Couldn't download the video. Try again.", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this@WordDetailActivity, "Saved for offline", Toast.LENGTH_SHORT).show()
            }
            // A video already streaming keeps playing; the saved copy is used
            // from the next time it's loaded.
            refreshOfflineState(w)
        }
    }

    /** The offline copy when there is one, otherwise the stream URL. */
    private fun currentSource(): String? {
        val w = word ?: return null
        return ModelUpdateManager.getLocalVideo(this, w.id)?.absolutePath ?: remoteVideoUrl
    }

    private fun play() {
        shouldPlay = true
        val source = currentSource() ?: return
        if (source != loadedSource || player == null && videoDemo.visibility != View.VISIBLE) {
            loadVideo(source)
            return  // onPrepared starts it
        }
        if (player == null) return  // still preparing; onPrepared starts it
        videoDemo.start()
        applySpeed()
        showPlayingUi(true)
    }

    private fun pause() {
        shouldPlay = false
        if (player != null) videoDemo.pause()
        showPlayingUi(false)
    }

    private fun loadVideo(source: String) {
        loadedSource = source
        noMediaPlaceholder.visibility = View.GONE
        playOverlay.visibility = View.GONE
        videoDemo.visibility = View.VISIBLE
        progressVideo.visibility = View.VISIBLE
        tvMediaCaption.text = if (source.startsWith("http")) "Demo Video · streaming" else "Demo Video"

        videoDemo.setOnPreparedListener { mp ->
            player = mp
            // No looping: the demo plays once per tap, then waits at the end.
            mp.isLooping = false
            progressVideo.visibility = View.GONE
            ivThumbnail.visibility = View.GONE

            durationMs = mp.duration
            seekVideo.max = durationMs.coerceAtLeast(1)
            tvMediaCaption.text = "Demo Video · ${formatTime(durationMs)}"
            setControlsEnabled(true)

            if (mp.videoWidth > 0 && mp.videoHeight > 0) {
                val aspect = mp.videoWidth.toFloat() / mp.videoHeight
                videoAspect = aspect
                fitStageTo(aspect)
            }

            videoDemo.seekTo(resumePosition)
            if (shouldPlay) {
                videoDemo.start()
                applySpeed()
                showPlayingUi(true)
            } else {
                showPlayingUi(false)
            }
        }
        videoDemo.setOnCompletionListener {
            shouldPlay = false
            resumePosition = 0
            seekVideo.progress = durationMs
            showPlayingUi(false)
        }
        videoDemo.setOnErrorListener { _, _, _ ->
            player = null
            loadedSource = null
            shouldPlay = false
            progressVideo.visibility = View.GONE
            videoDemo.visibility = View.GONE
            playOverlay.visibility = View.GONE
            ivThumbnail.visibility = View.GONE
            setControlsEnabled(false)
            val offlineCopy = word?.let { ModelUpdateManager.getLocalVideo(this, it.id) } != null
            showPlaceholder(
                "⚠",
                if (offlineCopy) "Video unavailable" else "Video unavailable · check your connection",
                retry = true,
            )
            tvMediaCaption.text = ""
            true
        }
        videoDemo.setVideoPath(source)
    }

    // Speed is only applied to a playing player: on Android 6+ setting a
    // non-zero speed on a paused MediaPlayer starts it, overriding a pause.
    private fun applySpeed() {
        val mp = player ?: return
        runCatching { mp.playbackParams = mp.playbackParams.setSpeed(speed) }
    }

    private fun showPlayingUi(playing: Boolean) {
        playOverlay.visibility = if (playing || player == null && videoDemo.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        btnPlayPause.setIconResource(if (playing) R.drawable.ic_pause else R.drawable.ic_play)
        btnPlayPause.contentDescription = if (playing) "Pause" else "Play"
    }

    private fun setControlsEnabled(enabled: Boolean) {
        seekVideo.isEnabled = enabled
        btnReplay.isEnabled = enabled
        btnFullscreen.isEnabled = enabled
        // Play stays enabled: before the video loads it's how you start it.
    }

    private fun setupPlayerControls() {
        btnPlayPause.setOnClickListener { if (player != null && videoDemo.isPlaying) pause() else play() }
        videoDemo.setOnClickListener { if (videoDemo.isPlaying) pause() else play() }

        btnReplay.setOnClickListener {
            resumePosition = 0
            videoDemo.seekTo(0)
            play()
        }

        seekVideo.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
                if (fromUser) tvTime.text = "${formatTime(progress)} / ${formatTime(durationMs)}"
            }
            override fun onStartTrackingTouch(bar: SeekBar) { isUserSeeking = true }
            override fun onStopTrackingTouch(bar: SeekBar) {
                isUserSeeking = false
                resumePosition = bar.progress
                videoDemo.seekTo(bar.progress)
            }
        })

        speedGroup.check(
            when (speed) {
                0.5f -> R.id.btnSpeed50
                0.75f -> R.id.btnSpeed75
                else -> R.id.btnSpeed100
            }
        )
        speedGroup.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            speed = when (checkedId) {
                R.id.btnSpeed50 -> 0.5f
                R.id.btnSpeed75 -> 0.75f
                else -> 1f
            }
            // Remembered, so learners who prefer slow motion get it on every word.
            prefs.edit().putFloat(KEY_SPEED, speed).apply()
            if (player != null && videoDemo.isPlaying) applySpeed()
        }

        btnFullscreen.setOnClickListener { openFullscreen() }
    }

    private fun openFullscreen() {
        val source = loadedSource ?: currentSource() ?: return
        val position = if (player != null) videoDemo.currentPosition else resumePosition
        val landscape = (videoAspect ?: DEFAULT_ASPECT) > 1f
        // Fullscreen carries on only if it was already playing; a paused video
        // opens paused, since the demo never starts without a tap.
        val wasPlaying = player != null && videoDemo.isPlaying
        if (player != null) videoDemo.pause()
        fullscreenLauncher.launch(
            FullscreenVideoActivity.intent(this, source, position, speed, landscape, wasPlaying)
        )
    }

    // ── Stage sizing ─────────────────────────────────────────────────────────

    /**
     * Resizes the media stage to [aspect] (width / height). Landscape media
     * fills the column's width; portrait media grows taller but is capped at
     * [MAX_STAGE_HEIGHT_FRACTION] of the screen and centred, so the controls
     * below never get pushed far off-screen.
     */
    private fun fitStageTo(aspect: Float, animate: Boolean = true) {
        if (aspect <= 0f) return
        val availableWidth = contentColumn.width - contentColumn.paddingStart - contentColumn.paddingEnd
        if (availableWidth <= 0) {
            // Not laid out yet (e.g. a cached thumbnail beat the first layout).
            contentColumn.post { fitStageTo(aspect, animate = false) }
            return
        }
        val maxHeight = (resources.displayMetrics.heightPixels * MAX_STAGE_HEIGHT_FRACTION).toInt()

        var targetWidth = availableWidth
        var targetHeight = (availableWidth / aspect).toInt()
        if (targetHeight > maxHeight) {
            targetHeight = maxHeight
            targetWidth = (maxHeight * aspect).toInt()
        }

        val params = cardMedia.layoutParams as LinearLayout.LayoutParams
        val startWidth = if (params.width > 0) params.width else cardMedia.width.takeIf { it > 0 } ?: targetWidth
        val startHeight = if (params.height > 0) params.height else cardMedia.height.takeIf { it > 0 } ?: targetHeight

        stageAnimator?.cancel()
        if (!animate || (startWidth == targetWidth && startHeight == targetHeight)) {
            params.width = targetWidth
            params.height = targetHeight
            cardMedia.layoutParams = params
            return
        }
        stageAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 220
            addUpdateListener { anim ->
                val t = anim.animatedValue as Float
                params.width = (startWidth + (targetWidth - startWidth) * t).toInt()
                params.height = (startHeight + (targetHeight - startHeight) * t).toInt()
                cardMedia.layoutParams = params
            }
            start()
        }
    }

    // ── Speech ───────────────────────────────────────────────────────────────

    private fun speakWord(label: String) {
        if (!isTtsReady) {
            pendingSpeech = label
            return
        }
        val volumeMultiplier = (appSettings.volume / 100f).coerceIn(0f, 1f)
        val params = Bundle().apply {
            putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volumeMultiplier)
        }
        // Resolving the voice can block on a query into the TTS engine process
        // (cached after the first time), so it must not run on the main thread.
        lifecycleScope.launch(Dispatchers.IO) {
            TtsVoiceHelper.applyPreferredVoice(tts, appSettings)
            tts?.speak(label, TextToSpeech.QUEUE_FLUSH, params, null)
        }
    }

    private fun formatTime(ms: Int): String {
        val seconds = (ms / 1000).coerceAtLeast(0)
        return "%d:%02d".format(seconds / 60, seconds % 60)
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onResume() {
        super.onResume()
        progressHandler.post(progressTick)
    }

    override fun onPause() {
        // Remember where it was: VideoView releases its player with the surface,
        // and onPrepared rebuilds it at resumePosition when the screen returns —
        // paused, since the demo never starts without a tap.
        if (player != null) {
            resumePosition = videoDemo.currentPosition
            videoDemo.pause()
        }
        shouldPlay = false
        player = null
        progressHandler.removeCallbacks(progressTick)
        super.onPause()
    }

    override fun onDestroy() {
        stageAnimator?.cancel()
        videoDemo.stopPlayback()
        // shutdown() blocks until the engine connection started in onCreate has
        // finished binding, so leaving right after entering stalled the main
        // thread. Same fix as MainActivity.onDestroy.
        val doomedTts = tts
        tts = null
        isTtsReady = false
        if (doomedTts != null) {
            teardownExecutor.execute { doomedTts.shutdown() }
        }
        super.onDestroy()
    }
}
