package com.example.sigla

import android.app.Dialog
import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch
import java.util.Locale

class WordBankActivity : AppCompatActivity() {

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var rvWords: RecyclerView
    private lateinit var tvEmpty: TextView
    private lateinit var progressLoading: ProgressBar
    private lateinit var spinnerCategory: Spinner
    private lateinit var etSearch: TextInputEditText
    private lateinit var adapter: WordAdapter

    private var allWords = listOf<WordBankWord>()
    private var tts: TextToSpeech? = null
    private var isTtsReady = false

    // Active media dialog (kept to stop video on dismiss)
    private var mediaDialog: Dialog? = null

    private val categories = listOf(
        "All Categories",
        "Introducing Oneself",
        "Ordering Food",
        "Buying Items",
        "Asking for Prices",
        "Giving Numbers",
        "Requesting Assistance",
        "Asking for Directions",
        "Confirming Information",
        "Communicating Basic Needs",
        "Alphabets",
        "Numbers",
        "Additional Words"
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_word_bank)

        drawerLayout = findViewById(R.id.drawerLayout)
        rvWords = findViewById(R.id.rvWords)
        tvEmpty = findViewById(R.id.tvEmpty)
        progressLoading = findViewById(R.id.progressLoading)
        spinnerCategory = findViewById(R.id.spinnerCategory)
        etSearch = findViewById(R.id.etSearch)

        // Sidebar
        val sidebar = drawerLayout.getChildAt(1)
        NavigationHelper.setup(this, drawerLayout, sidebar, Screen.WORD_BANK)
        findViewById<MaterialButton>(R.id.btnMenu).setOnClickListener {
            drawerLayout.openDrawer(sidebar)
        }

        // TTS
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.ENGLISH
                isTtsReady = true
            }
        }

        // RecyclerView
        adapter = WordAdapter(
            onThumbnailClick = { word -> showMediaDialog(word) },
            onAudio = { word -> speakWord(word.label) }
        )
        rvWords.layoutManager = LinearLayoutManager(this)
        rvWords.adapter = adapter

        // Category spinner
        val spinnerAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, categories)
        spinnerAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinnerCategory.adapter = spinnerAdapter
        spinnerCategory.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, v: View?, position: Int, id: Long) {
                applyFilters()
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        // Search
        etSearch.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) { applyFilters() }
        })

        loadWords()
    }

    private fun loadWords() {
        progressLoading.visibility = View.VISIBLE
        rvWords.visibility = View.GONE
        tvEmpty.visibility = View.GONE

        val session = SessionManager.getInstance(this)
        lifecycleScope.launch {
            // Show local cache immediately (works offline)
            val cached = ModelUpdateManager.loadCachedWordBank(this@WordBankActivity)
            if (cached != null) {
                allWords = cached
                applyFilters()
                progressLoading.visibility = View.GONE
                // Cache any missing thumbnails in the background
                launch { ModelUpdateManager.downloadWordBankImages(this@WordBankActivity, cached) }
            }

            // Always fetch fresh data from API in the background
            try {
                val response = ApiClient.get(session.token).getWordBank()
                if (response.isSuccessful) {
                    val fresh = response.body()?.words ?: emptyList()
                    if (fresh != allWords) {
                        allWords = fresh
                        applyFilters()
                        // Cache any thumbnails not yet downloaded
                        launch { ModelUpdateManager.downloadWordBankImages(this@WordBankActivity, fresh) }
                    }
                }
            } catch (_: Exception) {
                // Network unavailable — cache is still shown
            } finally {
                progressLoading.visibility = View.GONE
                if (allWords.isEmpty()) {
                    tvEmpty.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun applyFilters() {
        val selectedCategory = spinnerCategory.selectedItem?.toString() ?: "All Categories"
        val searchQuery = etSearch.text.toString().trim().lowercase()

        val filtered = allWords.filter { word ->
            val matchesCategory = selectedCategory == "All Categories" ||
                    word.category.equals(selectedCategory, ignoreCase = true)
            val matchesSearch = searchQuery.isEmpty() ||
                    word.label.lowercase().contains(searchQuery) ||
                    word.filipino_translation?.lowercase()?.contains(searchQuery) == true ||
                    word.description?.lowercase()?.contains(searchQuery) == true
            matchesCategory && matchesSearch
        }

        adapter.submitList(filtered)
        rvWords.visibility = if (filtered.isNotEmpty()) View.VISIBLE else View.GONE
        tvEmpty.visibility = if (filtered.isEmpty() && progressLoading.visibility != View.VISIBLE) View.VISIBLE else View.GONE
        tvEmpty.text = getString(R.string.no_words_found)
    }

    // ── Media dialog ──────────────────────────────────────────────

    private fun showMediaDialog(word: WordBankWord) {
        mediaDialog?.dismiss()

        val dialog = Dialog(this, android.R.style.Theme_Material_Light_NoActionBar)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val view = layoutInflater.inflate(R.layout.dialog_word_media, null)
        dialog.setContentView(view)
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )

        // Title
        view.findViewById<TextView>(R.id.tvMediaTitle).text = word.label

        // Filipino translation
        val tvFilipino = view.findViewById<TextView>(R.id.tvMediaFilipino)
        if (!word.filipino_translation.isNullOrBlank()) {
            tvFilipino.text = word.filipino_translation
            tvFilipino.visibility = View.VISIBLE
        }

        // Description
        val tvDesc = view.findViewById<TextView>(R.id.tvMediaDescription)
        if (!word.description.isNullOrBlank()) {
            tvDesc.text = word.description
            tvDesc.visibility = View.VISIBLE
        }

        // Tags
        view.findViewById<TextView>(R.id.tvMediaGesture).text = word.gesture_type
        view.findViewById<TextView>(R.id.tvMediaHands).text =
            "${word.hands_count} hand${if (word.hands_count > 1) "s" else ""}"
        view.findViewById<TextView>(R.id.tvMediaCategory).text = word.category

        // Close button
        view.findViewById<ImageButton>(R.id.btnCloseMedia).setOnClickListener {
            dialog.dismiss()
        }

        // Audio button
        view.findViewById<MaterialButton>(R.id.btnMediaAudio).setOnClickListener {
            speakWord(word.label)
        }

        // Video or image
        val frameVideo = view.findViewById<FrameLayout>(R.id.frameVideo)
        val ivImage = view.findViewById<ImageView>(R.id.ivMediaImage)
        val videoView = view.findViewById<VideoView>(R.id.videoView)
        val progressVideo = view.findViewById<ProgressBar>(R.id.progressVideo)

        val resolvedDialogThumb = ApiClient.resolveUrl(word.thumbnail_url)
        val localThumb = ModelUpdateManager.getLocalThumb(this, word.id)
        // Prefer local file; fall back to remote URL for both image display and video error handler
        val thumbSource: Any? = localThumb ?: resolvedDialogThumb

        when {
            !word.video_url.isNullOrBlank() -> {
                frameVideo.visibility = View.VISIBLE
                progressVideo.visibility = View.VISIBLE

                val uri = Uri.parse(word.video_url)
                videoView.setVideoURI(uri)
                videoView.setOnPreparedListener { mp ->
                    progressVideo.visibility = View.GONE
                    mp.isLooping = true
                    videoView.start()
                }
                videoView.setOnErrorListener { _, _, _ ->
                    // Video unavailable (offline) — show cached/remote thumbnail image instead
                    progressVideo.visibility = View.GONE
                    frameVideo.visibility = View.GONE
                    if (thumbSource != null) {
                        ivImage.visibility = View.VISIBLE
                        Glide.with(this)
                            .load(thumbSource)
                            .diskCacheStrategy(DiskCacheStrategy.ALL)
                            .placeholder(android.R.drawable.ic_menu_gallery)
                            .into(ivImage)
                    }
                    true
                }
            }
            thumbSource != null -> {
                frameVideo.visibility = View.GONE
                ivImage.visibility = View.VISIBLE
                Glide.with(this)
                    .load(thumbSource)
                    .diskCacheStrategy(DiskCacheStrategy.ALL)
                    .centerCrop()
                    .placeholder(android.R.drawable.ic_menu_gallery)
                    .into(ivImage)
            }
            else -> {
                frameVideo.visibility = View.GONE
                ivImage.visibility = View.GONE
            }
        }

        dialog.setOnDismissListener {
            videoView.stopPlayback()
        }

        dialog.show()
        mediaDialog = dialog
    }

    private fun speakWord(word: String) {
        if (isTtsReady) {
            tts?.speak(word, TextToSpeech.QUEUE_FLUSH, null, null)
        }
    }

    override fun onPause() {
        super.onPause()
        mediaDialog?.dismiss()
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }
}

// ── Word Adapter ─────────────────────────────────────────────────────────────

class WordAdapter(
    private val onThumbnailClick: (WordBankWord) -> Unit,
    private val onAudio: (WordBankWord) -> Unit
) : RecyclerView.Adapter<WordAdapter.VH>() {

    private var words = listOf<WordBankWord>()

    fun submitList(list: List<WordBankWord>) {
        words = list
        notifyDataSetChanged()
    }

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val layoutThumbnail: FrameLayout = view.findViewById(R.id.layoutThumbnail)
        val ivThumbnail: ImageView = view.findViewById(R.id.ivThumbnail)
        val layoutPlayOverlay: FrameLayout = view.findViewById(R.id.layoutPlayOverlay)
        val tvNoMedia: TextView = view.findViewById(R.id.tvNoMedia)
        val tvLabel: TextView = view.findViewById(R.id.tvWordLabel)
        val tvFilipino: TextView = view.findViewById(R.id.tvWordFilipino)
        val tvCategory: TextView = view.findViewById(R.id.tvWordCategory)
        val tvGesture: TextView = view.findViewById(R.id.tvWordGesture)
        val tvHands: TextView = view.findViewById(R.id.tvWordHands)
        val btnAudio: MaterialButton = view.findViewById(R.id.btnAudio)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_word, parent, false)
        return VH(view)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val word = words[position]

        holder.tvLabel.text = word.label
        holder.tvCategory.text = word.category
        holder.tvGesture.text = word.gesture_type
        holder.tvHands.text = "${word.hands_count}H"

        // Filipino translation
        if (!word.filipino_translation.isNullOrBlank()) {
            holder.tvFilipino.text = word.filipino_translation
            holder.tvFilipino.visibility = View.VISIBLE
        } else {
            holder.tvFilipino.visibility = View.GONE
        }

        // Prefer locally cached thumbnail (works offline); fall back to remote URL.
        // For video words the play-overlay is kept so the user still knows it's a motion gesture.
        val resolvedThumb = ApiClient.resolveUrl(word.thumbnail_url)
        val localThumb    = ModelUpdateManager.getLocalThumb(holder.itemView.context, word.id)
        val thumbSource: Any? = localThumb ?: resolvedThumb
        val isVideo = !word.video_url.isNullOrBlank()

        when {
            thumbSource != null -> {
                holder.tvNoMedia.visibility = View.GONE
                holder.layoutPlayOverlay.visibility = if (isVideo) View.VISIBLE else View.GONE
                Glide.with(holder.itemView.context)
                    .load(thumbSource)
                    .diskCacheStrategy(DiskCacheStrategy.ALL)
                    .centerCrop()
                    .placeholder(android.R.color.darker_gray)
                    .error(android.R.color.darker_gray)
                    .into(holder.ivThumbnail)
            }
            isVideo -> {
                // No thumbnail cached yet, but has a video — try loading a frame from the video URL
                holder.tvNoMedia.visibility = View.GONE
                holder.layoutPlayOverlay.visibility = View.VISIBLE
                Glide.with(holder.itemView.context)
                    .load(Uri.parse(word.video_url))
                    .diskCacheStrategy(DiskCacheStrategy.ALL)
                    .centerCrop()
                    .placeholder(android.R.color.darker_gray)
                    .error(android.R.color.darker_gray)
                    .into(holder.ivThumbnail)
            }
            else -> {
                holder.ivThumbnail.setImageDrawable(null)
                holder.layoutPlayOverlay.visibility = View.GONE
                holder.tvNoMedia.visibility = View.VISIBLE
            }
        }

        holder.layoutThumbnail.setOnClickListener { onThumbnailClick(word) }
        holder.btnAudio.setOnClickListener { onAudio(word) }
    }

    override fun getItemCount() = words.size
}
