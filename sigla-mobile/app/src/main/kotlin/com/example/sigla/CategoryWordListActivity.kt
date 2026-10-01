package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
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
        private const val SPINNER_DELAY_MS = 300L
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
    private lateinit var wordsEntrance: ListEntrance

    private var categoryName = "All Categories"
    private var isFavorites = false
    private var isAllWords = false
    private var searchQuery = ""
    private var allWords = listOf<WordBankWord>()
    private var categoryWords = listOf<WordBankWord>()
    // True until the network fetch settles. The spinner is shown only while
    // this is set AND nothing is on screen yet — see showSpinnerIfStillEmpty.
    private var isLoading = false
    private val spinnerHandler = Handler(Looper.getMainLooper())
    private val showSpinnerIfStillEmpty = Runnable {
        if (isLoading && allWords.isEmpty()) progressLoading.visibility = View.VISIBLE
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_category_word_list)

        favoritesManager = FavoritesManager.getInstance(this)
        categoryName = intent.getStringExtra(EXTRA_CATEGORY_NAME) ?: "All Categories"
        isFavorites = intent.getBooleanExtra(EXTRA_IS_FAVORITES, false)
        isAllWords = intent.getBooleanExtra(EXTRA_IS_ALL_WORDS, false)

        bindViews()
        tvCategoryTitle.text = when {
            isFavorites -> "Favorites"
            isAllWords -> "All Words"
            // Only ever reached from WordBankActivity's category grid, which
            // only ever passes server categories (never a user-typed custom
            // one) — see the same note in CategoryGridAdapter.
            else -> categoryName.toTitleCase()
        }

        btnBack.setOnClickListener { finish() }
        etCategorySearch.hint = "Search in ${tvCategoryTitle.text}…"
        etCategorySearch.addTextChangedListener { text ->
            searchQuery = text?.toString()?.trim() ?: ""
            applyFilters()
        }

        adapter = SimpleWordAdapter(
            mutableListOf(),
            isFavorite = { id -> favoritesManager.isFavorite(id) },
        ) { word -> openWordDetail(word) }
        rvCategoryWords.layoutManager = LinearLayoutManager(this)
        rvCategoryWords.setHasFixedSize(true)
        rvCategoryWords.adapter = adapter
        wordsEntrance = ListEntrance(rvCategoryWords)

        loadWords()
    }

    override fun onDestroy() {
        spinnerHandler.removeCallbacks(showSpinnerIfStillEmpty)
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        // Favorites may have changed on the word detail screen.
        if (isFavorites) onWordsUpdated() else if (::adapter.isInitialized) adapter.refreshFavorites()
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
        isLoading = true
        progressLoading.visibility = View.GONE
        rvCategoryWords.visibility = View.GONE
        emptyState.visibility = View.GONE
        // The cached list is usually on screen within a frame or two; showing
        // the spinner straight away just flashed it (and, left up until the
        // network replied, drew it over the list). Only show it if nothing has
        // arrived after a beat.
        spinnerHandler.postDelayed(showSpinnerIfStillEmpty, SPINNER_DELAY_MS)

        lifecycleScope.launch {
            val cached = ModelUpdateManager.loadCachedWordBank(this@CategoryWordListActivity)
            if (cached != null && cached.isNotEmpty()) {
                allWords = cached
                hideSpinner()
                onWordsUpdated()
            }

            try {
                val response = ApiClient.get().getWordBank()
                if (response.isSuccessful) {
                    val fresh = response.body()?.words ?: emptyList()
                    if (fresh.isNotEmpty() && fresh != allWords) {
                        allWords = fresh
                        hideSpinner()
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
                isLoading = false
                hideSpinner()
                // Settles the empty state now that "still loading" no longer holds it back.
                applyFilters()
            }
        }
    }

    private fun hideSpinner() {
        spinnerHandler.removeCallbacks(showSpinnerIfStillEmpty)
        progressLoading.visibility = View.GONE
    }

    private fun onWordsUpdated() {
        categoryWords = when {
            isFavorites -> allWords.filter { favoritesManager.isFavorite(it.id) }
            isAllWords -> allWords
            else -> allWords.filter { it.category.equals(categoryName, ignoreCase = true) }
        }
        val n = categoryWords.size
        tvCategorySubtitle.text = "$n word" + if (n == 1) "" else "s"
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
        wordsEntrance.onData(filtered.size)

        val showEmpty = filtered.isEmpty() && !(isLoading && allWords.isEmpty())
        emptyState.showEmptyState(showEmpty)
        rvCategoryWords.visibility = if (showEmpty) View.GONE else View.VISIBLE
    }
}
