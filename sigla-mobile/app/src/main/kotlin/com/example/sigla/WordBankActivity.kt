package com.example.sigla

import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
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
    private var filteredWords = listOf<WordBankWord>()
    private var tts: TextToSpeech? = null
    private var isTtsReady = false

    private val categories = listOf(
        "All Categories",
        "Introducing Oneself",
        "Ordering Food",
        "Buying Items",
        "Asking/Giving Directions",
        "Telling Time",
        "Common/Everyday Phrases",
        "Emergency",
        "Numbers",
        "Alphabet",
        "Pronouns",
        "Questions",
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
            onAudio = { word -> speakWord(word.label) },
            onVideo = { word -> showVideoDialog(word) }
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
            try {
                val response = ApiClient.get(session.token).getWordBank()
                if (response.isSuccessful) {
                    allWords = response.body()?.words ?: emptyList()
                    applyFilters()
                } else {
                    tvEmpty.text = "Failed to load words"
                    tvEmpty.visibility = View.VISIBLE
                }
            } catch (e: Exception) {
                tvEmpty.text = "Connection error"
                tvEmpty.visibility = View.VISIBLE
            } finally {
                progressLoading.visibility = View.GONE
            }
        }
    }

    private fun applyFilters() {
        val selectedCategory = spinnerCategory.selectedItem?.toString() ?: "All Categories"
        val searchQuery = etSearch.text.toString().trim().lowercase()

        filteredWords = allWords.filter { word ->
            val matchesCategory = selectedCategory == "All Categories" ||
                    word.category.equals(selectedCategory, ignoreCase = true)
            val matchesSearch = searchQuery.isEmpty() ||
                    word.label.lowercase().contains(searchQuery) ||
                    (word.description?.lowercase()?.contains(searchQuery) == true)
            matchesCategory && matchesSearch
        }

        adapter.submitList(filteredWords)
        rvWords.visibility = if (filteredWords.isNotEmpty()) View.VISIBLE else View.GONE
        tvEmpty.visibility = if (filteredWords.isEmpty() && progressLoading.visibility != View.VISIBLE) View.VISIBLE else View.GONE
        tvEmpty.text = getString(R.string.no_words_found)
    }

    private fun speakWord(word: String) {
        if (isTtsReady) {
            tts?.speak(word, TextToSpeech.QUEUE_FLUSH, null, null)
        }
    }

    private fun showVideoDialog(word: WordBankWord) {
        if (word.video_url.isNullOrEmpty()) {
            Toast.makeText(this, "No demo video available", Toast.LENGTH_SHORT).show()
            return
        }
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_Dialog)
            .setTitle(word.label)
            .setMessage("Video demo: ${word.video_url}")
            .setPositiveButton("Close", null)
            .create()
        dialog.show()
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }
}

// ── Word Adapter ────────────────────────────────────────────────────

class WordAdapter(
    private val onAudio: (WordBankWord) -> Unit,
    private val onVideo: (WordBankWord) -> Unit
) : RecyclerView.Adapter<WordAdapter.VH>() {

    private var words = listOf<WordBankWord>()

    fun submitList(list: List<WordBankWord>) {
        words = list
        notifyDataSetChanged()
    }

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val tvLabel: TextView = view.findViewById(R.id.tvWordLabel)
        val tvCategory: TextView = view.findViewById(R.id.tvWordCategory)
        val tvGesture: TextView = view.findViewById(R.id.tvWordGesture)
        val tvHands: TextView = view.findViewById(R.id.tvWordHands)
        val btnAudio: MaterialButton = view.findViewById(R.id.btnAudio)
        val btnVideo: MaterialButton = view.findViewById(R.id.btnVideo)
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
        holder.tvHands.text = "${word.hands_count} hand${if (word.hands_count > 1) "s" else ""}"
        holder.btnAudio.setOnClickListener { onAudio(word) }
        holder.btnVideo.setOnClickListener { onVideo(word) }
        holder.btnVideo.visibility = if (word.video_url.isNullOrEmpty()) View.GONE else View.VISIBLE
    }

    override fun getItemCount() = words.size
}
