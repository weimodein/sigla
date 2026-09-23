package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.widget.addTextChangedListener
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch

/**
 * Simple word list for a single category (or "Favorites" / "All Words" from
 * the Word Bank grid). Tapping a word opens WordDetailActivity; the category
 * dropdown from the main page is intentionally absent since the user is
 * already inside one category.
 */
class CategoryWordListActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_CATEGORY_NAME = "extra_category_name"
        const val EXTRA_IS_FAVORITES = "extra_is_favorites"
        const val EXTRA_IS_ALL_WORDS = "extra_is_all_words"
    }

    private lateinit var btnBack: MaterialButton
    private lateinit var tvCategoryTitle: TextView
    private lateinit var tvCategorySubtitle: TextView
    private lateinit var etCategorySearch: TextInputEditText
    private lateinit var rvCategoryWords: RecyclerView
    private lateinit var emptyState: LinearLayout
    private lateinit var progressLoading: ProgressBar
    private lateinit var adapter: SimpleWordAdapter
    private lateinit var favoritesManager: FavoritesManager

    private var categoryName = "All Categories"
    private var isFavorites = false
    private var isAllWords = false
    private var searchQuery = ""
    private var allWords = listOf<WordBankWord>()
    private var categoryWords = listOf<WordBankWord>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_category_word_list)

        window.statusBarColor = android.graphics.Color.parseColor("#0A0E21")
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false

        favoritesManager = FavoritesManager.getInstance(this)
        categoryName = intent.getStringExtra(EXTRA_CATEGORY_NAME) ?: "All Categories"
        isFavorites = intent.getBooleanExtra(EXTRA_IS_FAVORITES, false)
        isAllWords = intent.getBooleanExtra(EXTRA_IS_ALL_WORDS, false)

        bindViews()
        tvCategoryTitle.text = when {
            isFavorites -> "Favorites"
            isAllWords -> "All Words"
            else -> categoryName.capitalizeFirst()
        }

        btnBack.setOnClickListener { finish() }
        etCategorySearch.hint = "Search in ${tvCategoryTitle.text}…"
        etCategorySearch.addTextChangedListener { text ->
            searchQuery = text?.toString()?.trim() ?: ""
            applyFilters()
        }

        adapter = SimpleWordAdapter(mutableListOf()) { word -> openWordDetail(word) }
        rvCategoryWords.layoutManager = LinearLayoutManager(this)
        rvCategoryWords.setHasFixedSize(true)
        rvCategoryWords.adapter = adapter

        loadWords()
    }

    override fun onResume() {
        super.onResume()
        // Favorites membership may have changed in the detail screen.
        if (isFavorites) onWordsUpdated()
    }

    private fun openWordDetail(word: WordBankWord) {
        startActivity(Intent(this, WordDetailActivity::class.java).apply {
            putExtra(WordDetailActivity.EXTRA_WORD_ID, word.id)
        })
    }

    private fun bindViews() {
        btnBack = findViewById(R.id.btnBack)
        tvCategoryTitle = findViewById(R.id.tvCategoryTitle)
        tvCategorySubtitle = findViewById(R.id.tvCategorySubtitle)
        etCategorySearch = findViewById(R.id.etCategorySearch)
        rvCategoryWords = findViewById(R.id.rvCategoryWords)
        emptyState = findViewById(R.id.emptyState)
        progressLoading = findViewById(R.id.progressLoading)
    }

    // ── Load words ────────────────────────────────────────────────────────────

    private fun loadWords() {
        progressLoading.visibility = View.VISIBLE
        rvCategoryWords.visibility = View.GONE
        emptyState.visibility = View.GONE

        lifecycleScope.launch {
            val cached = ModelUpdateManager.loadCachedWordBank(this@CategoryWordListActivity)
            if (cached != null && cached.isNotEmpty()) {
                allWords = cached
                onWordsUpdated()
            }

            try {
                val response = ApiClient.get().getWordBank()
                if (response.isSuccessful) {
                    val fresh = response.body()?.words ?: emptyList()
                    if (fresh.isNotEmpty() && fresh != allWords) {
                        allWords = fresh
                        onWordsUpdated()
                        ModelUpdateManager.cacheWordBank(this@CategoryWordListActivity, fresh)
                    }
                } else if (allWords.isEmpty()) {
                    Toast.makeText(this@CategoryWordListActivity, "Failed to load words", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                if (allWords.isEmpty()) {
                    Toast.makeText(this@CategoryWordListActivity, "Network error. Using cached data if available.", Toast.LENGTH_LONG).show()
                }
            } finally {
                progressLoading.visibility = View.GONE
            }
        }
    }

    private fun onWordsUpdated() {
        categoryWords = when {
            isFavorites -> allWords.filter { favoritesManager.isFavorite(it.id) }
            isAllWords -> allWords
            else -> allWords.filter { it.category.equals(categoryName, ignoreCase = true) }
        }
        tvCategorySubtitle.text = "${categoryWords.size} Word${if (categoryWords.size != 1) "s" else ""}"
        applyFilters()
    }

    private fun applyFilters() {
        val filtered = categoryWords.filter { word ->
            searchQuery.isEmpty() ||
                    word.label.contains(searchQuery, ignoreCase = true) ||
                    (word.filipino_translation?.contains(searchQuery, ignoreCase = true) == true) ||
                    (word.description?.contains(searchQuery, ignoreCase = true) == true)
        }
        adapter.setWords(filtered)

        val showEmpty = filtered.isEmpty() && progressLoading.visibility != View.VISIBLE
        emptyState.visibility = if (showEmpty) View.VISIBLE else View.GONE
        rvCategoryWords.visibility = if (showEmpty) View.GONE else View.VISIBLE
    }
}
