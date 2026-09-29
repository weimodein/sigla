package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.widget.ProgressBar
import android.widget.FrameLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.addTextChangedListener
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import androidx.recyclerview.widget.GridLayoutManager

private const val SEARCH_DEBOUNCE_MS = 250L

class WordBankActivity : AppCompatActivity() {

    // Search debounce — see setupSearch()
    private val searchHandler = Handler(Looper.getMainLooper())
    private var searchRunnable: Runnable? = null

    private lateinit var etSearch: TextInputEditText
    private lateinit var rvWords: RecyclerView
    private lateinit var emptyState: LinearLayout
    private lateinit var tvEntryCount: TextView
    private lateinit var progressLoading: ProgressBar
    private lateinit var adapter: SimpleWordAdapter
    private lateinit var categoryGridContainer: LinearLayout
    private lateinit var rvCategoryGrid: RecyclerView
    private lateinit var gridAdapter: CategoryGridAdapter
    private lateinit var btnDownloadAllVideos: MaterialButton
    private lateinit var tvWordBankSubtitle: TextView
    private lateinit var pillAll: MaterialButton
    private lateinit var pillWords: MaterialButton
    private lateinit var pillLetters: MaterialButton
    private lateinit var listContainer: View
    private lateinit var gridEntrance: ListEntrance
    private lateinit var wordsEntrance: ListEntrance
    private var gridFilter = VocabularyFilter.ALL
    private var isGridMode = true

    // Bulk demo-video download state. The dialog reference is kept so onDestroy
    // can dismiss it and avoid leaking the window.
    private var downloadJob: Job? = null
    private var downloadDialog: AlertDialog? = null

    private var selectedCategory = "All Categories"
    private var dbCategories = listOf<CategoryItem>()
    private var searchQuery = ""
    private var allWords = listOf<WordBankWord>()
    private var isLoading = false

    companion object {
        /** Set by Home's search bar: focus the search field and open the keyboard. */
        const val EXTRA_FOCUS_SEARCH = "extra_focus_search"
    }

    private lateinit var favoritesManager: FavoritesManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_word_bank)

        favoritesManager = FavoritesManager.getInstance(this)

        bindViews()
        setupKeyboardInsets()
        BottomNavHelper.setup(this, Tab.WORD_BANK)
        setupRecyclerView()
        setupCategoryGrid()
        setupFilterPills()
        setupSearch()
        bindDownloadAllButton()
        showGridMode()

        // Load words from backend
        loadWords()
        loadCategories()
        maybeFocusSearch(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        maybeFocusSearch(intent)
    }

    /** Home's search bar opens this screen with the search field focused. */
    private fun maybeFocusSearch(intent: Intent) {
        if (!intent.getBooleanExtra(EXTRA_FOCUS_SEARCH, false)) return
        intent.removeExtra(EXTRA_FOCUS_SEARCH)
        etSearch.requestFocus()
        etSearch.post {
            val imm = getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
            imm.showSoftInput(etSearch, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
        }
    }

    override fun onResume() {
        super.onResume()
        // Favorites membership may have changed in the word detail screen.
        if (allWords.isNotEmpty()) {
            if (isGridMode) {
                refreshCategoryGrid()
            } else {
                applyFilters()
                adapter.refreshFavorites()
            }
        }
    }
    private fun bindViews() {
        etSearch = findViewById(R.id.etSearch)
        rvWords = findViewById(R.id.rvWords)
        emptyState = findViewById(R.id.emptyState)
        tvEntryCount = findViewById(R.id.tvEntryCount)
        progressLoading = findViewById(R.id.progressLoading)
        categoryGridContainer = findViewById(R.id.categoryGridContainer)
        rvCategoryGrid = findViewById(R.id.rvCategoryGrid)
        btnDownloadAllVideos = findViewById(R.id.btnDownloadAllVideos)
        tvWordBankSubtitle = findViewById(R.id.tvWordBankSubtitle)
        pillAll = findViewById(R.id.pillAll)
        pillWords = findViewById(R.id.pillWords)
        pillLetters = findViewById(R.id.pillLetters)
        listContainer = findViewById(R.id.listContainer)
    }

    /**
     * The bottom nav is pinned to the CoordinatorLayout's own bottom edge, not
     * the screen's, so letting the window resize for the keyboard (adjustResize)
     * drags the nav bar and translate FAB up over the search results — see
     * AndroidManifest's adjustNothing on this activity. The window stays full
     * size; only the content column pads itself by the keyboard's height while
     * it's up, so the last search result is never hidden behind it. System-bar
     * insets are untouched — decorFitsSystemWindows stays at its default, so
     * Android keeps positioning content between the status and nav bars as it
     * already does everywhere else in the app.
     */
    private fun setupKeyboardInsets() {
        val content = findViewById<LinearLayout>(R.id.wordBankContent)
        val basePadding = content.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val imeHeight = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, basePadding + imeHeight)
            insets
        }
    }

    // ── Category Grid ───────────────────────────────────────────────────────────────
    private fun setupCategoryGrid() {
        gridAdapter = CategoryGridAdapter(mutableListOf()) { item ->
            onCategoryCardClicked(item)
        }
        rvCategoryGrid.layoutManager = GridLayoutManager(this, 2)
        rvCategoryGrid.setHasFixedSize(true)
        rvCategoryGrid.adapter = gridAdapter
        gridEntrance = ListEntrance(rvCategoryGrid)
    }

    private fun refreshCategoryGrid() {
        // Nothing to show until words load. Categories are a nicety on top of the
        // word list — the grid must NOT be gated on the categories API succeeding.
        if (allWords.isEmpty()) {
            gridAdapter.setItems(emptyList())
            if (isGridMode) {
                emptyState.showEmptyState(!isLoading)
                listContainer.visibility = View.VISIBLE
            }
            return
        }

        if (isGridMode) {
            emptyState.visibility = View.GONE
            listContainer.visibility = View.GONE
        }

        // Prefer the DB categories; fall back to the categories present on the
        // loaded words so the grid still works when /categories is empty.
        val categoryNames: List<String> = if (dbCategories.isNotEmpty()) {
            dbCategories.map { it.name }
        } else {
            allWords.map { it.category }
                .filter { it.isNotBlank() }
                .distinctBy { it.lowercase() }
                .sorted()
        }

        tvWordBankSubtitle.text =
            "${allWords.size} Filipino Sign Language word${if (allWords.size != 1) "s" else ""}"

        val items = mutableListOf<CategoryGridItem>()
        if (gridFilter == VocabularyFilter.ALL) {
            val favoritesCount = allWords.count { favoritesManager.isFavorite(it.id) }
            items.add(CategoryGridItem(displayName = "Favorites", wordCount = favoritesCount, isFavorites = true))
            items.add(CategoryGridItem(displayName = "All Words", wordCount = allWords.size, isAllWords = true))
        }
        gridCategories(allWords, categoryNames, gridFilter).forEach { cat ->
            items.add(CategoryGridItem(displayName = cat.name, wordCount = cat.wordCount))
        }
        gridAdapter.setItems(items)
        gridEntrance.onData(items.size)
    }

    private fun onCategoryCardClicked(item: CategoryGridItem) {
        val intent = Intent(this, CategoryWordListActivity::class.java).apply {
            putExtra(CategoryWordListActivity.EXTRA_CATEGORY_NAME, item.displayName)
            putExtra(CategoryWordListActivity.EXTRA_IS_FAVORITES, item.isFavorites)
            putExtra(CategoryWordListActivity.EXTRA_IS_ALL_WORDS, item.isAllWords)
        }
        startActivity(intent)
    }

    private fun showListMode() {
        isGridMode = false
        categoryGridContainer.visibility = View.GONE
        tvEntryCount.visibility = View.VISIBLE
        rvWords.visibility = View.VISIBLE
        listContainer.visibility = View.VISIBLE
        // emptyState visibility is still managed by applyFilters()
    }

    private fun showGridMode() {
        isGridMode = true
        categoryGridContainer.visibility = View.VISIBLE
        tvEntryCount.visibility = View.GONE
        rvWords.visibility = View.GONE
        emptyState.visibility = View.GONE
        // Spinner reflects whether words are still loading — never gate it on the
        // categories API, which may legitimately return empty.
        val stillLoadingInitial = isLoading && allWords.isEmpty()
        progressLoading.visibility = if (stillLoadingInitial) View.VISIBLE else View.GONE
        listContainer.visibility = if (stillLoadingInitial) View.VISIBLE else View.GONE
    }


    // ── Load Words from Backend ───────────────────────────────────────────────

    private fun loadWords() {
        if (isLoading) return
        isLoading = true
        progressLoading.visibility = View.VISIBLE
        rvWords.visibility = View.GONE
        emptyState.visibility = View.GONE

        lifecycleScope.launch {
            // Show cached data immediately (offline support)
            val cached = ModelUpdateManager.loadCachedWordBank(this@WordBankActivity)
            if (cached != null && cached.isNotEmpty()) {
                allWords = cached
                applyFilters()
                refreshCategoryGrid()
                refreshDownloadAllEnabled()
                progressLoading.visibility = View.GONE
                isLoading = false
                // Download missing images in background
                launch { ModelUpdateManager.downloadWordBankImages(this@WordBankActivity, cached) }
            }

            // Fetch fresh data from API
            try {
                val response = ApiClient.get().getWordBank()
                if (response.isSuccessful) {
                    val fresh = response.body()?.words ?: emptyList()
                    if (fresh.isNotEmpty() && fresh != allWords) {
                        allWords = fresh
                        applyFilters()
                        refreshCategoryGrid()
                        refreshDownloadAllEnabled()
                        // Cache the fresh data
                        ModelUpdateManager.cacheWordBank(this@WordBankActivity, fresh)
                        // Download images in background
                        launch { ModelUpdateManager.downloadWordBankImages(this@WordBankActivity, fresh) }
                    }
                } else {
                    Toast.makeText(this@WordBankActivity, "Failed to load words", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                if (allWords.isEmpty()) {
                    Toast.makeText(this@WordBankActivity, "Network error. Using cached data if available.", Toast.LENGTH_LONG).show()
                }
            } finally {
                progressLoading.visibility = View.GONE
                isLoading = false
                refreshDownloadAllEnabled()
                if (isGridMode) {
                    // Re-render the grid now that loading finished; this also drives
                    // the empty-state message when there are genuinely no words.
                    refreshCategoryGrid()
                } else if (allWords.isEmpty()) {
                    emptyState.showEmptyState(true)
                    rvWords.visibility = View.GONE
                }
            }
        }
    }

    private fun loadCategories() {
        lifecycleScope.launch {
            // Show cached categories immediately (offline support)
            val cached = ModelUpdateManager.loadCachedCategories(this@WordBankActivity)
            if (cached != null && cached.isNotEmpty()) {
                dbCategories = cached
                refreshCategoryGrid()
            }

            try {
                val response = ApiClient.get().getCategories()
                if (response.isSuccessful) {
                    val fresh = response.body()?.categories ?: emptyList()
                    if (fresh.isNotEmpty() && fresh != dbCategories) {
                        dbCategories = fresh
                        refreshCategoryGrid()
                        ModelUpdateManager.cacheCategories(this@WordBankActivity, fresh)
                    }
                }
            } catch (e: Exception) {
                // Network unavailable — cached categories (if any) are already shown above
            }
            // Note: the loading spinner is owned solely by loadWords(); categories
            // are supplementary and must not hide/show it (they can arrive before or
            // after the word fetch and would otherwise leave a stuck or premature state).
        }
    }

    // ── Filter pills ──────────────────────────────────────────────────────────

    private fun setupFilterPills() {
        pillAll.setOnClickListener { selectGridFilter(VocabularyFilter.ALL) }
        pillWords.setOnClickListener { selectGridFilter(VocabularyFilter.WORDS) }
        pillLetters.setOnClickListener { selectGridFilter(VocabularyFilter.LETTERS) }
        renderFilterPills()
    }

    private fun selectGridFilter(filter: VocabularyFilter) {
        gridFilter = filter
        renderFilterPills()
        refreshCategoryGrid()
    }

    private fun renderFilterPills() {
        fun style(pill: MaterialButton, on: Boolean) {
            val bg = if (on) R.color.sg_brand else R.color.sg_tint
            val fg = if (on) R.color.sg_on_brand else R.color.sg_brand_text
            pill.backgroundTintList = android.content.res.ColorStateList.valueOf(ContextCompat.getColor(this, bg))
            pill.setTextColor(ContextCompat.getColor(this, fg))
        }
        style(pillAll, gridFilter == VocabularyFilter.ALL)
        style(pillWords, gridFilter == VocabularyFilter.WORDS)
        style(pillLetters, gridFilter == VocabularyFilter.LETTERS)
    }

    // ── Search ────────────────────────────────────────────────────────────────

    private fun setupSearch() {
        etSearch.addTextChangedListener { text ->
            val query = text?.toString()?.trim() ?: ""
            // Debounced: applyFilters() walks every word and rebinds the whole
            // adapter, so running it on each keystroke made typing stutter.
            searchRunnable?.let { searchHandler.removeCallbacks(it) }
            val runnable = Runnable {
                searchQuery = query
                if (searchQuery.isNotEmpty()) {
                    selectedCategory = "All Categories" // search across everything
                    showListMode()
                } else if (!isGridMode) {
                    showGridMode()
                    refreshCategoryGrid()
                }
                applyFilters()
            }
            searchRunnable = runnable
            searchHandler.postDelayed(runnable, SEARCH_DEBOUNCE_MS)
        }
    }

    // ── Filtering ─────────────────────────────────────────────────────────────

    private fun applyFilters() {
        val filtered = allWords.filter { word ->
            val matchesCategory = when {
                selectedCategory == "All Categories" -> true
                selectedCategory == "Favorites" -> favoritesManager.isFavorite(word.id)
                else -> word.category.equals(selectedCategory, ignoreCase = true)
            }
            val matchesSearch = searchQuery.isEmpty() ||
                    word.label.contains(searchQuery, ignoreCase = true) ||
                    (word.filipino_translation?.contains(searchQuery, ignoreCase = true) == true) ||
                    (word.description?.contains(searchQuery, ignoreCase = true) == true)
            matchesCategory && matchesSearch
        }

        adapter.setWords(filtered.toMutableList())
        wordsEntrance.onData(filtered.size)
        val count = filtered.size
        tvEntryCount.text = "Showing $count word${if (count != 1) "s" else ""}"

        if (!isGridMode) {
            emptyState.showEmptyState(count == 0 && !isLoading)
            rvWords.visibility = if (count == 0 && !isLoading) View.GONE else View.VISIBLE
        }
    }

    // ── RecyclerView setup ────────────────────────────────────────────────────

    private fun setupRecyclerView() {
        adapter = SimpleWordAdapter(
            mutableListOf(),
            isFavorite = { id -> favoritesManager.isFavorite(id) },
        ) { word -> openWordDetail(word) }
        rvWords.layoutManager = LinearLayoutManager(this)
        // Row height doesn't depend on content, so RecyclerView can skip a full
        // layout pass whenever the data set changes.
        rvWords.setHasFixedSize(true)
        rvWords.adapter = adapter
        wordsEntrance = ListEntrance(rvWords)
    }

    private fun openWordDetail(word: WordBankWord) {
        startActivity(Intent(this, WordDetailActivity::class.java).apply {
            putExtra(WordDetailActivity.EXTRA_WORD_ID, word.id)
        })
    }

    // ── Bulk demo-video download ──────────────────────────────────────────────
    // Individual videos are still tap-to-download in WordDetailActivity; this
    // fetches every missing one in a single pass so the word bank works offline.
    // Videos come straight from their storage URLs (no API endpoint mediates
    // them), so this is entirely a client-side loop over the words we already hold.

    private fun bindDownloadAllButton() {
        btnDownloadAllVideos.setOnClickListener { onDownloadAllClicked() }
        // Nothing to download until the word list arrives; refreshDownloadAllEnabled()
        // switches it on from loadWords().
        btnDownloadAllVideos.isEnabled = false
    }

    /**
     * The button is live only when there are words to act on and no batch is running.
     * Called wherever [allWords] changes, and around the batch itself.
     */
    private fun refreshDownloadAllEnabled() {
        btnDownloadAllVideos.isEnabled = allWords.isNotEmpty() && downloadJob?.isActive != true
    }

    private fun onDownloadAllClicked() {
        if (downloadJob?.isActive == true) return

        if (allWords.isEmpty()) {
            Toast.makeText(this, "Words are still loading. Please try again.", Toast.LENGTH_SHORT).show()
            return
        }

        val pending = ModelUpdateManager.pendingVideoDownloads(this, allWords)
        if (pending.isEmpty()) {
            showAllDownloadedDialog()
            return
        }

        if (!NetworkUtils.isOnline(this)) {
            Toast.makeText(this, "No internet connection.", Toast.LENGTH_SHORT).show()
            return
        }

        showConfirmDownloadDialog(pending.size)
    }

    // Nothing left to fetch — offer the way back out instead of a dead end.
    private fun showAllDownloadedDialog() {
        val cached = ModelUpdateManager.cachedVideoCount(this, allWords)
        if (cached == 0) {
            Toast.makeText(this, "No demo videos are available to download.", Toast.LENGTH_SHORT).show()
            return
        }

        val view = layoutInflater.inflate(R.layout.dialog_confirm_action, null)
        val dialog = AlertDialog.Builder(this).setView(view).create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        // Reached when nothing is pending — which covers both "everything is cached" and
        // "the remaining words have no demo video at all", so the copy stays neutral.
        view.findViewById<TextView>(R.id.tvConfirmTitle).text = "Nothing left to download"
        view.findViewById<TextView>(R.id.tvConfirmMessage).text =
            "$cached demo video${if (cached != 1) "s are" else " is"} saved for offline use " +
            "(${formatBytes(ModelUpdateManager.cachedVideoBytes(this, allWords))})."
        view.findViewById<MaterialButton>(R.id.btnConfirmCancel).text = "Close"
        view.findViewById<MaterialButton>(R.id.btnConfirmAction).text = "Clear"

        view.findViewById<MaterialButton>(R.id.btnConfirmCancel).setOnClickListener { dialog.dismiss() }
        view.findViewById<MaterialButton>(R.id.btnConfirmAction).setOnClickListener {
            dialog.dismiss()
            lifecycleScope.launch {
                val removed = ModelUpdateManager.clearCachedVideos(this@WordBankActivity, allWords)
                Toast.makeText(
                    this@WordBankActivity,
                    "Cleared $removed downloaded video${if (removed != 1) "s" else ""}",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }

        dialog.show()
    }

    private fun showConfirmDownloadDialog(pendingCount: Int) {
        val metered = NetworkUtils.isMetered(this)

        val view = layoutInflater.inflate(R.layout.dialog_confirm_action, null)
        val dialog = AlertDialog.Builder(this).setView(view).create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        view.findViewById<TextView>(R.id.tvConfirmTitle).text = "Download all demo videos?"

        // No size metadata exists for video_url, so we can only state a count here,
        // never an estimated download size.
        val base = "$pendingCount demo video${if (pendingCount != 1) "s" else ""} " +
            "will be downloaded for offline use."
        view.findViewById<TextView>(R.id.tvConfirmMessage).text = if (metered) {
            "$base\n\nYou're on mobile data. This may use a significant amount of data — " +
                "Wi-Fi is recommended."
        } else {
            base
        }

        view.findViewById<MaterialButton>(R.id.btnConfirmAction).text =
            if (metered) "Download anyway" else "Download"

        view.findViewById<MaterialButton>(R.id.btnConfirmCancel).setOnClickListener { dialog.dismiss() }
        view.findViewById<MaterialButton>(R.id.btnConfirmAction).setOnClickListener {
            dialog.dismiss()
            startBulkDownload()
        }

        dialog.show()
    }

    private fun startBulkDownload() {
        val view = layoutInflater.inflate(R.layout.dialog_download_all_videos, null)
        val dialog = AlertDialog.Builder(this).setView(view).setCancelable(false).create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        val tvCounter = view.findViewById<TextView>(R.id.tvDownloadCounter)
        val tvCurrent = view.findViewById<TextView>(R.id.tvDownloadCurrentWord)
        val progressBar = view.findViewById<ProgressBar>(R.id.progressDownloadAll)

        view.findViewById<MaterialButton>(R.id.btnDownloadCancel).setOnClickListener {
            downloadJob?.cancel()
        }

        dialog.show()
        downloadDialog = dialog

        downloadJob = lifecycleScope.launch {
            btnDownloadAllVideos.isEnabled = false
            // Written from the IO dispatcher, read on the main thread after cancellation.
            val savedSoFar = java.util.concurrent.atomic.AtomicInteger(0)
            try {
                val result = ModelUpdateManager.downloadAllWordVideos(
                    this@WordBankActivity,
                    allWords
                ) { progress ->
                    savedSoFar.set(progress.completed)
                    // onProgress arrives on the IO dispatcher — never touch views from there.
                    runOnUiThread {
                        val done = progress.completed + progress.failed
                        tvCounter.text = "Downloading ${done.coerceAtMost(progress.total)} of ${progress.total}…"
                        progressBar.max = progress.total.coerceAtLeast(1)
                        progressBar.progress = done
                        tvCurrent.text = progress.currentLabel?.let { "Current: $it" } ?: ""
                    }
                }

                dismissDownloadDialog()
                val message = if (result.failed == 0) {
                    "${result.completed} demo video${if (result.completed != 1) "s" else ""} downloaded"
                } else {
                    "${result.completed} downloaded, ${result.failed} failed"
                }
                Toast.makeText(this@WordBankActivity, message, Toast.LENGTH_LONG).show()
            } catch (e: CancellationException) {
                // User pressed Cancel, or the activity went away. Completed files stay
                // on disk, so a later run resumes rather than starting over.
                dismissDownloadDialog()
                // Only worth telling the user when the screen is still around; if the
                // activity is going away the cancellation isn't something they chose.
                if (!isFinishing && !isDestroyed) {
                    val saved = savedSoFar.get()
                    Toast.makeText(
                        this@WordBankActivity,
                        "Download cancelled — $saved video${if (saved != 1) "s" else ""} saved",
                        Toast.LENGTH_SHORT
                    ).show()
                }
                throw e
            } catch (e: Exception) {
                dismissDownloadDialog()
                Toast.makeText(this@WordBankActivity, "Download failed: ${e.message}", Toast.LENGTH_LONG).show()
            } finally {
                // Runs on the cancellation path too. Guarded because the activity may
                // already be going away, which is what cancelled the job in the first place.
                // Cleared first: this job is finishing, and refreshDownloadAllEnabled()
                // consults downloadJob.isActive — which is still true inside this block.
                downloadJob = null
                if (!isFinishing && !isDestroyed) refreshDownloadAllEnabled()
            }
        }
    }

    private fun dismissDownloadDialog() {
        downloadDialog?.let { if (it.isShowing) it.dismiss() }
        downloadDialog = null
    }

    private fun formatBytes(bytes: Long): String = when {
        bytes >= 1024L * 1024L * 1024L -> "%.1f GB".format(bytes / (1024.0 * 1024.0 * 1024.0))
        bytes >= 1024L * 1024L -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
        bytes >= 1024L -> "%.0f KB".format(bytes / 1024.0)
        else -> "$bytes B"
    }

    override fun onDestroy() {
        // lifecycleScope already cancels downloadJob; this just prevents a leaked window.
        dismissDownloadDialog()
        // A pending debounced search would otherwise retain this activity.
        searchRunnable?.let { searchHandler.removeCallbacks(it) }
        super.onDestroy()
    }

    // ── Back press ────────────────────────────────────────────────────────────

    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        if (!isGridMode) {
            showGridMode()
        } else {
            BottomNavHelper.open(this, Tab.HOME)
        }
    }

}
