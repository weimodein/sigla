package com.example.sigla

import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Full-screen word detail: word label, demo video/image, and an Add to
 * Favorites toggle. Replaces the old bottom sheet — reached by tapping a
 * word anywhere in Word Bank or a category word list.
 */
class WordDetailActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_WORD_ID = "extra_word_id"
    }

    private lateinit var btnBack: MaterialButton
    private lateinit var tvDetailCategoryTitle: TextView
    private lateinit var tvDetailWord: TextView
    private lateinit var ivThumbnail: ImageView
    private lateinit var videoDemo: VideoView
    private lateinit var noMediaPlaceholder: LinearLayout
    private lateinit var progressVideo: ProgressBar
    private lateinit var playOverlay: FrameLayout
    private lateinit var tvMediaCaption: TextView
    private lateinit var btnAddToFavorites: MaterialButton
    private lateinit var favoritesManager: FavoritesManager

    private var word: WordBankWord? = null

    private var tts: TextToSpeech? = null
    private var isTtsReady = false
    private val appSettings by lazy { AppSettings.getInstance(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_word_detail)

        window.statusBarColor = android.graphics.Color.parseColor("#0A0E21")
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false

        favoritesManager = FavoritesManager.getInstance(this)

        bindViews()
        btnBack.setOnClickListener { finish() }

        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.ENGLISH
                isTtsReady = true
            }
        }

        val wordId = intent.getIntExtra(EXTRA_WORD_ID, -1)
        loadWord(wordId)
    }

    private fun bindViews() {
        btnBack = findViewById(R.id.btnBack)
        tvDetailCategoryTitle = findViewById(R.id.tvDetailCategoryTitle)
        tvDetailWord = findViewById(R.id.tvDetailWord)
        ivThumbnail = findViewById(R.id.ivThumbnail)
        videoDemo = findViewById(R.id.videoDemo)
        noMediaPlaceholder = findViewById(R.id.noMediaPlaceholder)
        progressVideo = findViewById(R.id.progressVideo)
        playOverlay = findViewById(R.id.playOverlay)
        tvMediaCaption = findViewById(R.id.tvMediaCaption)
        btnAddToFavorites = findViewById(R.id.btnAddToFavorites)
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
        tvDetailCategoryTitle.text = w.category.capitalizeFirst()
        tvDetailWord.text = w.label.capitalizeFirst()

        speakWord(w.label)
        setupFavoriteButton(w)
        setupMedia(w)
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
        btnAddToFavorites.setIconResource(
            if (isFavorite) android.R.drawable.btn_star_big_on else android.R.drawable.btn_star_big_off
        )
    }

    // ── Media (video / image / none) ─────────────────────────────────────────

    private fun setupMedia(w: WordBankWord) {
        val resolvedThumb = ApiClient.resolveUrl(w.thumbnail_url)
        val localThumb = ModelUpdateManager.getLocalThumb(this, w.id)
        val thumbSource: Any? = localThumb ?: resolvedThumb
        val resolvedVideo = ApiClient.resolveUrl(w.video_url)

        when {
            !resolvedVideo.isNullOrBlank() -> {
                setupVideoPlaceholder(w, resolvedVideo)
            }

            thumbSource != null -> {
                noMediaPlaceholder.visibility = View.GONE
                videoDemo.visibility          = View.GONE
                playOverlay.visibility        = View.GONE
                ivThumbnail.visibility        = View.VISIBLE
                tvMediaCaption.text = "Sample image of this gesture"
                Glide.with(this)
                    .load(thumbSource)
                    .diskCacheStrategy(DiskCacheStrategy.ALL)
                    .centerCrop()
                    .into(ivThumbnail)
            }

            else -> {
                ivThumbnail.visibility    = View.GONE
                videoDemo.visibility      = View.GONE
                playOverlay.visibility    = View.GONE
                noMediaPlaceholder.visibility = View.VISIBLE
                tvMediaCaption.text = ""
            }
        }
    }

    // ── Tap-to-download demo video ───────────────────────────────
    // First tap shows a placeholder and asks whether to download; declining
    // still plays the video (streamed, not cached). Once a copy is cached,
    // later taps play the local file directly with no network access or prompt.

    private fun setupVideoPlaceholder(w: WordBankWord, resolvedVideo: String) {
        ivThumbnail.visibility        = View.GONE
        videoDemo.visibility          = View.GONE
        progressVideo.visibility      = View.GONE
        noMediaPlaceholder.visibility = View.VISIBLE
        playOverlay.visibility        = View.VISIBLE

        val cached = ModelUpdateManager.getLocalVideo(this, w.id)
        if (cached != null) {
            tvMediaCaption.text = "Demo Video · tap to play"
            val start = View.OnClickListener { playLocalVideo(cached) }
            playOverlay.setOnClickListener(start)
            noMediaPlaceholder.setOnClickListener(start)
        } else {
            tvMediaCaption.text = "Tap to download demo video"
            val prompt = View.OnClickListener { showDownloadConfirmDialog(w, resolvedVideo) }
            playOverlay.setOnClickListener(prompt)
            noMediaPlaceholder.setOnClickListener(prompt)
        }
    }

    // Asks whether to save the video for offline use before playing it. Either
    // choice plays the video right away — declining download just skips the
    // local cache and streams it once instead.
    private fun showDownloadConfirmDialog(w: WordBankWord, resolvedVideo: String) {
        val view = layoutInflater.inflate(R.layout.dialog_confirm_action, null)
        val dialog = AlertDialog.Builder(this).setView(view).create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        view.findViewById<TextView>(R.id.tvConfirmTitle).text = "Download demo video?"
        view.findViewById<TextView>(R.id.tvConfirmMessage).text =
            "Save this demo video for offline use? It will play either way."
        view.findViewById<MaterialButton>(R.id.btnConfirmCancel).text = "NO"
        view.findViewById<MaterialButton>(R.id.btnConfirmAction).text = "YES"

        view.findViewById<MaterialButton>(R.id.btnConfirmCancel).setOnClickListener {
            dialog.dismiss()
            playVideo(resolvedVideo)
        }
        view.findViewById<MaterialButton>(R.id.btnConfirmAction).setOnClickListener {
            dialog.dismiss()
            downloadThenPlay(w, resolvedVideo)
        }

        dialog.show()
    }

    private fun downloadThenPlay(w: WordBankWord, resolvedVideo: String) {
        playOverlay.visibility        = View.GONE
        noMediaPlaceholder.visibility = View.GONE
        progressVideo.visibility      = View.VISIBLE
        tvMediaCaption.text = "Downloading demo video…"
        playOverlay.setOnClickListener(null)
        noMediaPlaceholder.setOnClickListener(null)

        lifecycleScope.launch {
            val file = ModelUpdateManager.downloadWordVideo(this@WordDetailActivity, w.id, resolvedVideo)
            progressVideo.visibility = View.GONE
            if (file != null) {
                playLocalVideo(file)
            } else {
                Toast.makeText(this@WordDetailActivity, "Failed to download video", Toast.LENGTH_SHORT).show()
                // Revert to the download placeholder so the user can retry
                setupVideoPlaceholder(w, resolvedVideo)
            }
        }
    }

    private fun playLocalVideo(file: java.io.File) = playVideo(file.absolutePath)

    private fun playVideo(path: String) {
        noMediaPlaceholder.visibility = View.GONE
        ivThumbnail.visibility        = View.GONE
        videoDemo.visibility          = View.VISIBLE
        playOverlay.visibility        = View.GONE
        progressVideo.visibility      = View.VISIBLE
        tvMediaCaption.text = "Demo Video"

        videoDemo.setVideoPath(path)
        videoDemo.setOnPreparedListener { mp ->
            progressVideo.visibility = View.GONE
            mp.isLooping = true
            val seconds = mp.duration / 1000
            tvMediaCaption.text = "Demo Video · %d:%02d".format(seconds / 60, seconds % 60)
        }
        videoDemo.setOnErrorListener { _, _, _ ->
            progressVideo.visibility  = View.GONE
            videoDemo.visibility      = View.GONE
            playOverlay.visibility    = View.GONE
            noMediaPlaceholder.visibility = View.VISIBLE
            tvMediaCaption.text = "Video unavailable"
            true
        }
        videoDemo.setOnCompletionListener {
            playOverlay.visibility = View.VISIBLE
        }
        val toggle = View.OnClickListener {
            if (videoDemo.isPlaying) {
                videoDemo.pause()
                playOverlay.visibility = View.VISIBLE
            } else {
                videoDemo.start()
                playOverlay.visibility = View.GONE
            }
        }
        videoDemo.setOnClickListener(toggle)
        playOverlay.setOnClickListener(toggle)
        videoDemo.start()
    }

    private fun speakWord(label: String) {
        if (!isTtsReady) return
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

    override fun onDestroy() {
        videoDemo.stopPlayback()
        tts?.shutdown()
        super.onDestroy()
    }
}
