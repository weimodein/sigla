package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.widget.ProgressBar
import android.widget.FrameLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.core.view.WindowCompat
import androidx.core.widget.addTextChangedListener
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import androidx.recyclerview.widget.GridLayoutManager

private const val SEARCH_DEBOUNCE_MS = 250L

class WordBankActivity : AppCompatActivity() {

    // Search debounce — see setupSearch()
    private val searchHandler = Handler(Looper.getMainLooper())
    private var searchRunnable: Runnable? = null

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var btnSidebar: MaterialButton
    private lateinit var btnCategoryPill: MaterialButton
    private lateinit var etSearch: TextInputEditText
    private lateinit var rvWords: RecyclerView
    private lateinit var emptyState: LinearLayout
    private lateinit var tvEntryCount: TextView
    private lateinit var progressLoading: ProgressBar
    private lateinit var adapter: SimpleWordAdapter
    private lateinit var session: SessionManager
    private lateinit var categoryGridContainer: LinearLayout
    private lateinit var rvCategoryGrid: RecyclerView
    private lateinit var gridAdapter: CategoryGridAdapter
    private lateinit var btnDownloadAllVideos: MaterialButton
    private var isGridMode = true

    // Bulk demo-video download state. The dialog reference is kept so onDestroy
    // can dismiss it and avoid leaking the window.
    private var downloadJob: Job? = null
    private var downloadDialog: AlertDialog? = null

    private var selectedCategory = "All Categories"
    private var gridCategoryFilter = "All Categories"
    private var dbCategories = listOf<CategoryItem>()
    private var searchQuery = ""
    private var allWords = listOf<WordBankWord>()
    private var isLoading = false

    companion object {
        val FSL_CATEGORIES = listOf(
            "introducing oneself",
            "ordering food",
            "buying items",
            "asking for prices",
            "giving numbers",
            "requesting assistance",
            "asking for directions",
            "confirming information",
            "communicating basic needs",
            "alphabets",
            "numbers",
            "additional words"
        )
    }

    // Custom categories management
    private lateinit var customCategoryManager: CustomCategoryManager
    private var customCategories = mutableListOf<CustomCategory>()
    private lateinit var favoritesManager: FavoritesManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_word_bank)

        // Some devices/Android versions ignore the theme's android:statusBarColor
        // (newer edge-to-edge behavior), leaving a white status bar with a gap
        // above the header. Setting it explicitly here is reliable everywhere.
        window.statusBarColor = android.graphics.Color.parseColor("#0A0E21")
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false

        session = SessionManager.getInstance(this)    // ← ADD THIS
        drawerLayout = findViewById(R.id.drawerLayout) // ← ADD THIS
        favoritesManager = FavoritesManager.getInstance(this)

        bindViews()
        setupTopBar()
        setupSidebar()
        setupRecyclerView()
        setupCategoryGrid()
        setupCategoryDropdown()
        setupSearch()
        wireListeners()
        bindDownloadAllButton()
        showGridMode()

        // Initialize custom category manager
        customCategoryManager = CustomCategoryManager.getInstance(this)
        loadCustomCategories()

        // Load words from backend
        loadWords()
        loadCategories()   // ← ADD THIS
    }

    override fun onResume() {
        super.onResume()
        refreshSidebarAuthState()  // ← UPDATE SIDEBAR WHEN ACTIVITY RESUMES
        // Favorites membership may have changed in the word detail screen.
        if (allWords.isNotEmpty()) {
            if (isGridMode) refreshCategoryGrid() else applyFilters()
        }
    }
    // ── Refresh Sidebar ───────────────────────────────────────────────────────────────

    private fun refreshSidebarAuthState() {
        val sidebar = drawerLayout.getChildAt(1) ?: return
        val tvUsername = sidebar.findViewById<TextView>(R.id.tvSidebarUsername)
        val tvEmail = sidebar.findViewById<TextView>(R.id.tvSidebarEmail)
        val btnSignIn = sidebar.findViewById<MaterialButton>(R.id.btnSidebarSignIn)
        if (session.isLoggedIn) {
            tvUsername?.text = session.username ?: "User"
            tvEmail?.text = session.email ?: ""
            btnSignIn?.visibility = View.GONE
        } else {
            tvUsername?.text = "Guest User"
            tvEmail?.text = "Not signed in"
            btnSignIn?.visibility = View.VISIBLE
        }
    }

        private fun openAuthDialog() {
        val dialog = AuthDialogFragment()
        dialog.onSignedIn = {
            refreshSidebarAuthState()
            // Optional: reload data that requires login
            // finish()
            // startActivity(intent)
        }
        dialog.show(supportFragmentManager, "auth")
    }

    private fun bindViews() {
        drawerLayout = findViewById(R.id.drawerLayout)
        btnSidebar = findViewById(R.id.btnSidebar)
        btnCategoryPill = findViewById(R.id.btnCategoryPill)
        etSearch = findViewById(R.id.etSearch)
        rvWords = findViewById(R.id.rvWords)
        emptyState = findViewById(R.id.emptyState)
        tvEntryCount = findViewById(R.id.tvEntryCount)
        progressLoading = findViewById(R.id.progressLoading)
        categoryGridContainer = findViewById(R.id.categoryGridContainer)
        rvCategoryGrid = findViewById(R.id.rvCategoryGrid)
        btnDownloadAllVideos = findViewById(R.id.btnDownloadAllVideos)
    }

    // ── Category Grid ───────────────────────────────────────────────────────────────
    private fun setupCategoryGrid() {
        gridAdapter = CategoryGridAdapter(mutableListOf()) { item ->
            onCategoryCardClicked(item)
        }
        rvCategoryGrid.layoutManager = GridLayoutManager(this, 2)
        rvCategoryGrid.setHasFixedSize(true)
        rvCategoryGrid.adapter = gridAdapter
    }

    private fun refreshCategoryGrid() {
        // Nothing to show until words load. Categories are a nicety on top of the
        // word list — the grid must NOT be gated on the categories API succeeding.
        if (allWords.isEmpty()) {
            gridAdapter.setItems(emptyList())
            if (isGridMode) {
                emptyState.visibility = if (isLoading) View.GONE else View.VISIBLE
            }
            return
        }

        if (isGridMode) emptyState.visibility = View.GONE

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

        val items = mutableListOf<CategoryGridItem>()

        if (gridCategoryFilter == "All Categories") {
            val favoritesCount = allWords.count { favoritesManager.isFavorite(it.id) }
            items.add(CategoryGridItem(displayName = "Favorites", wordCount = favoritesCount, isFavorites = true))
            items.add(CategoryGridItem(displayName = "All Words", wordCount = allWords.size, isAllWords = true))
            categoryNames.forEach { catName ->
                val count = allWords.count { it.category.equals(catName, ignoreCase = true) }
                items.add(CategoryGridItem(displayName = catName, wordCount = count))
            }
        } else {
            val count = allWords.count { it.category.equals(gridCategoryFilter, ignoreCase = true) }
            items.add(CategoryGridItem(displayName = gridCategoryFilter, wordCount = count))
        }

        gridAdapter.setItems(items)
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
        progressLoading.visibility = if (isLoading && allWords.isEmpty()) View.VISIBLE else View.GONE
    }


    // ── Top bar ───────────────────────────────────────────────────────────────

    private fun setupTopBar() {
        findViewById<View>(R.id.btnSidebar).setOnClickListener {
            drawerLayout.openDrawer(GravityCompat.START)
        }
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────

    private fun setupSidebar() {
        refreshSidebarAuthState()
        setActiveNavItem(R.id.navWordBank)

        findViewById<View>(R.id.navMainInterface)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.navWordBank)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
        }
        findViewById<View>(R.id.navTranslationHistory)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, TranslationHistoryActivity::class.java))
            finish()
        }

        // For Notifications - ADD LOGIN CHECK
        findViewById<View>(R.id.navNotifications)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {                    // ← ADD THIS CHECK
                startActivity(Intent(this, NotificationsActivity::class.java))
                finish()
            } else {
                openAuthDialog()                         // ← ADD THIS
            }
        }

        // For Profile - ADD LOGIN CHECK
        findViewById<View>(R.id.navProfile)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {                    // ← ADD THIS CHECK
                startActivity(Intent(this, ProfileActivity::class.java))
                finish()
            } else {
                openAuthDialog()                         // ← ADD THIS
            }
        }
        findViewById<View>(R.id.navSettings)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, SettingsActivity::class.java))
            finish()
        }

        findViewById<View>(R.id.btnSidebarSignIn)?.setOnClickListener {
            drawerLayout.closeDrawers()
            openAuthDialog()
        }
    }

    private fun setActiveNavItem(activeId: Int) {
        val navIds = listOf(
            R.id.navMainInterface, R.id.navWordBank, R.id.navTranslationHistory,
            R.id.navNotifications, R.id.navProfile, R.id.navSettings
        )
        navIds.forEach { id ->
            val view = findViewById<LinearLayout>(id)
            if (id == activeId) {
                view?.setBackgroundResource(R.drawable.bg_nav_item_selected)
                (view?.getChildAt(0) as? ImageView)?.imageTintList =
                    android.content.res.ColorStateList.valueOf(0xFF4A90E2.toInt())
                (view?.getChildAt(1) as? TextView)?.apply {
                    setTextColor(0xFF4A90E2.toInt())
                    setTypeface(null, android.graphics.Typeface.BOLD)
                }
            } else {
                view?.setBackgroundResource(R.drawable.bg_nav_item_default)
                (view?.getChildAt(0) as? ImageView)?.imageTintList =
                    android.content.res.ColorStateList.valueOf(0xFF6C757D.toInt())
                (view?.getChildAt(1) as? TextView)?.apply {
                    setTextColor(0xFF6C757D.toInt())
                    setTypeface(null, android.graphics.Typeface.NORMAL)
                }
            }
        }
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
                val response = ApiClient.get(session.token ?: "").getWordBank()
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
                    emptyState.visibility = View.VISIBLE
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
                val response = ApiClient.get(session.token ?: "").getCategories()
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

    // ── Custom Categories ─────────────────────────────────────────────────────

    private fun loadCustomCategories() {
        customCategories = customCategoryManager.getAll().toMutableList()
        refreshCategoryDropdown()
    }

    // ── Category dropdown ─────────────────────────────────────────────────────

    private fun setupCategoryDropdown() {
        btnCategoryPill.setOnClickListener {
            val popup = android.widget.PopupMenu(this, btnCategoryPill)
            val categories = getCategoryDisplayList()
            categories.forEachIndexed { index, name ->
                popup.menu.add(0, index, index, name)
            }
            popup.setOnMenuItemClickListener { item ->
                gridCategoryFilter = categories[item.itemId]
                btnCategoryPill.text = if (gridCategoryFilter == "All Categories") "All Category" else gridCategoryFilter
                showGridMode()       // stay/return to grid
                refreshCategoryGrid()
                true
            }
            popup.show()
        }
    }   

    private fun getCategoryDisplayList(): List<String> {
        val baseCategories = if (dbCategories.isNotEmpty()) {
            dbCategories.map { it.name }
        } else {
            FSL_CATEGORIES  // fallback if API hasn't returned yet, or failed
        }
        val systemCategories = listOf("All Categories") + baseCategories.map { it.capitalizeFirst() }
        val customCategoryNames = customCategories.map { it.name }
        return systemCategories + customCategoryNames
    }
    
    private fun refreshCategoryDropdown() {
        val allCategories = getCategoryDisplayList()
        val dropdownAdapter = ArrayAdapter(
            this, android.R.layout.simple_dropdown_item_1line, allCategories
        )
        //actvCategory.setAdapter(dropdownAdapter)
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
                else -> {
                    val customCat = customCategories.find { it.name == selectedCategory }
                    if (customCat != null) {
                        word.id in customCat.wordIds
                    } else {
                        word.category.equals(selectedCategory, ignoreCase = true)
                    }
                }
            }
            val matchesSearch = searchQuery.isEmpty() ||
                    word.label.contains(searchQuery, ignoreCase = true) ||
                    (word.filipino_translation?.contains(searchQuery, ignoreCase = true) == true) ||
                    (word.description?.contains(searchQuery, ignoreCase = true) == true)
            matchesCategory && matchesSearch
        }

        adapter.setWords(filtered.toMutableList())
        val count = filtered.size
        tvEntryCount.text = "Showing $count word${if (count != 1) "s" else ""}"

        if (!isGridMode) {
            emptyState.visibility = if (count == 0 && !isLoading) View.VISIBLE else View.GONE
            rvWords.visibility = if (count == 0 && !isLoading) View.GONE else View.VISIBLE
        }
    }

    // ── Create category ───────────────────────────────────────────────────────

    // FIX: only ONE definition of showCategoryEditDialog (duplicate removed)
    private fun showCategoryEditDialog(
        title: String,
        hint: String,
        subtitle: String = "",
        currentValue: String = "",
        maxLength: Int = 50,
        extraValidate: ((String) -> String?)? = null,
        onConfirm: (String) -> Unit
    ) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_edit_field, null, false)
        val til = dialogView.findViewById<TextInputLayout>(R.id.tilDialogField)
        val et = dialogView.findViewById<TextInputEditText>(R.id.etDialogField)
        val tvSub = dialogView.findViewById<TextView>(R.id.tvDialogSubtitle)

        til.hint = hint
        til.counterMaxLength = maxLength
        til.isCounterEnabled = true
        et.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
        et.filters = arrayOf(InputFilter.LengthFilter(maxLength))
        et.setText(currentValue)
        et.setSelection(currentValue.length)

        et.addTextChangedListener { til.error = null }

        if (subtitle.isNotEmpty()) {
            tvSub.text = subtitle
            tvSub.visibility = View.VISIBLE
        } else {
            tvSub.visibility = View.GONE
        }

        val dialog = AlertDialog.Builder(this)
            .setTitle(title)
            .setView(dialogView)
            .setPositiveButton("Save", null)
            .setNegativeButton("Cancel", null)
            .create()

        dialog.setOnShowListener {
            et.requestFocus()
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val newValue = et.text.toString().trim()

                if (newValue.isEmpty()) {
                    til.error = "$hint cannot be empty"
                    return@setOnClickListener
                }

                val extraError = extraValidate?.invoke(newValue)
                if (extraError != null) {
                    til.error = extraError
                    return@setOnClickListener
                }

                til.error = null
                dialog.dismiss()
                onConfirm(newValue)
            }
        }

        dialog.show()
    }

    // ── Manage category (rename / delete) ─────────────────────────────────────

    private fun showManageCategoryDialog(
        category: CustomCategory,
        onDone: (() -> Unit)? = null
    ) {
        val sheet = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_category_actions, null)
        sheet.setContentView(view)

        view.findViewById<TextView>(R.id.tvSheetCategoryName).text = category.name

        view.findViewById<LinearLayout>(R.id.rowRename).setOnClickListener {
            sheet.dismiss()
            showRenameCategoryDialog(category, onDone)
        }

        view.findViewById<LinearLayout>(R.id.rowDelete).setOnClickListener {
            sheet.dismiss()
            showDeleteCategoryDialog(category, onDone)
        }

        view.findViewById<TextView>(R.id.tvSheetCancel).setOnClickListener {
            sheet.dismiss()
            onDone?.invoke()
        }

        sheet.show()
    }

    private fun showRenameCategoryDialog(
        category: CustomCategory,
        onDone: (() -> Unit)? = null
    ) {
        showCategoryEditDialog(
            title = "Rename category",
            hint = "Category name",
            subtitle = "Rename this category. Words inside it will not be affected.",
            currentValue = category.name,
            maxLength = 50,
            extraValidate = { newName: String ->
                when {
                    newName.equals(category.name, ignoreCase = true) -> null
                    customCategories.any { it.name.equals(newName, ignoreCase = true) } ->
                        "\"$newName\" already exists"
                    else -> null
                }
            }
        ) { newName ->
            if (!newName.equals(category.name, ignoreCase = true)) {
                customCategoryManager.rename(category.id, newName)
                val index = customCategories.indexOfFirst { it.id == category.id }
                if (index >= 0) {
                    customCategories[index] = customCategoryManager.get(category.id)!!
                }

                if (selectedCategory == category.name) {
                    selectedCategory = newName
                    //actvCategory.setText(newName, false)
                }

                refreshCategoryDropdown()
                applyFilters()
                Toast.makeText(this, "Category renamed to \"$newName\"", Toast.LENGTH_SHORT).show()
            }
            onDone?.invoke()
        }
    }

    private fun showDeleteCategoryDialog(
        category: CustomCategory,
        onDone: (() -> Unit)? = null
    ) {
        val wordCount = category.wordIds.size
        val message = if (wordCount > 0)
            "Delete \"${category.name}\"? This will also remove $wordCount " +
            "word${if (wordCount != 1) "s" else ""} from this category."
        else
            "Delete \"${category.name}\"? This action cannot be undone."

        AlertDialog.Builder(this)
            .setTitle("Delete category")
            .setMessage(message)
            .setPositiveButton("Delete") { _, _ ->
                customCategoryManager.delete(category.id)
                customCategories.removeAll { it.id == category.id }

                if (selectedCategory == category.name) {
                    selectedCategory = "All Categories"
                    //actvCategory.setText("", false)
                }

                refreshCategoryDropdown()
                applyFilters()
                Toast.makeText(this, "\"${category.name}\" deleted", Toast.LENGTH_SHORT).show()
                onDone?.invoke()
            }
            .setNegativeButton("Cancel") { _, _ ->
                onDone?.invoke()
            }
            .show()
    }

    // ── RecyclerView setup ────────────────────────────────────────────────────

    private fun setupRecyclerView() {
        adapter = SimpleWordAdapter(mutableListOf()) { word -> openWordDetail(word) }
        rvWords.layoutManager = LinearLayoutManager(this)
        // Row height doesn't depend on content, so RecyclerView can skip a full
        // layout pass whenever the data set changes.
        rvWords.setHasFixedSize(true)
        rvWords.adapter = adapter
    }

    private fun openWordDetail(word: WordBankWord) {
        startActivity(Intent(this, WordDetailActivity::class.java).apply {
            putExtra(WordDetailActivity.EXTRA_WORD_ID, word.id)
        })
    }

    // ── Wire listeners ────────────────────────────────────────────────────────

    private fun wireListeners() {
        //btnCreateCategory.setOnClickListener { showCreateCategoryDialog() }
        //btnCreateCategory.setOnLongClickListener {
        //    if (customCategories.isNotEmpty()) {
        //        Toast.makeText(this, "Long press on a category in the dropdown to manage it", Toast.LENGTH_LONG).show()
        //    }
        //    true
        //}
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
        view.findViewById<MaterialButton>(R.id.btnConfirmCancel).text = "CLOSE"
        view.findViewById<MaterialButton>(R.id.btnConfirmAction).text = "CLEAR"

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
            if (metered) "DOWNLOAD ANYWAY" else "DOWNLOAD"

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
        if (drawerLayout.isDrawerOpen(GravityCompat.START)) {
            drawerLayout.closeDrawer(GravityCompat.START)
        } else if (!isGridMode) {
            showGridMode()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

}