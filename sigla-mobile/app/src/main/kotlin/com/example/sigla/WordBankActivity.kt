package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.text.InputFilter
import android.text.InputType
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import android.widget.ProgressBar
import android.widget.FrameLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.core.widget.addTextChangedListener
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlinx.coroutines.launch
import java.util.Locale

class WordBankActivity : AppCompatActivity() {

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var btnSidebar: MaterialButton
    private lateinit var btnCreateCategory: MaterialButton
    private lateinit var actvCategory: AutoCompleteTextView
    private lateinit var etSearch: TextInputEditText
    private lateinit var rvWords: RecyclerView
    private lateinit var emptyState: LinearLayout
    private lateinit var tvEntryCount: TextView
    private lateinit var progressLoading: ProgressBar
    private lateinit var adapter: WordBankAdapter
    private lateinit var session: SessionManager

    private var selectedCategory = "All Categories"
    private var searchQuery = ""
    private var allWords = listOf<WordBankWord>()
    private var isLoading = false

    // TTS
    private var tts: TextToSpeech? = null
    private var isTtsReady = false

    // Custom categories management
    private lateinit var customCategoryManager: CustomCategoryManager
    private var customCategories = mutableListOf<CustomCategory>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_word_bank)

        session = SessionManager.getInstance(this)    // ← ADD THIS
        drawerLayout = findViewById(R.id.drawerLayout) // ← ADD THIS

        bindViews()
        setupTopBar()
        setupSidebar()
        setupRecyclerView()
        setupCategoryDropdown()
        setupSearch()
        wireListeners()

        // Initialize TTS
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.ENGLISH
                isTtsReady = true
            }
        }

        // Initialize custom category manager
        customCategoryManager = CustomCategoryManager.getInstance(this)
        loadCustomCategories()

        // Load words from backend
        loadWords()
    }

    override fun onResume() {
        super.onResume()
        refreshSidebarAuthState()  // ← UPDATE SIDEBAR WHEN ACTIVITY RESUMES
    }
    // ── Refresh Sidebar ───────────────────────────────────────────────────────────────

    private fun refreshSidebarAuthState() {
        val sidebar = drawerLayout.getChildAt(1)  // ← USE YOUR drawerLayout VARIABLE NAME
        val tvUsername = sidebar.findViewById<TextView>(R.id.tvSidebarUsername)
        val tvEmail = sidebar.findViewById<TextView>(R.id.tvSidebarEmail)
        val btnSignIn = sidebar.findViewById<MaterialButton>(R.id.btnSidebarSignIn)
        val suggestBadge = sidebar.findViewById<TextView>(R.id.tvSuggestWordBadge)

        if (session.isLoggedIn) {
            tvUsername?.text = session.username ?: "User"
            tvEmail?.text = session.email ?: ""
            btnSignIn?.visibility = View.GONE
            suggestBadge?.visibility = View.GONE
        } else {
            tvUsername?.text = "Guest User"
            tvEmail?.text = "Not signed in"
            btnSignIn?.visibility = View.VISIBLE
            suggestBadge?.visibility = View.VISIBLE
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
        btnCreateCategory = findViewById(R.id.btnCreateCategory)
        actvCategory = findViewById(R.id.actvCategory)
        etSearch = findViewById(R.id.etSearch)
        rvWords = findViewById(R.id.rvWords)
        emptyState = findViewById(R.id.emptyState)
        tvEntryCount = findViewById(R.id.tvEntryCount)
        progressLoading = findViewById(R.id.progressLoading)
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
         // For Suggest Word - ADD LOGIN CHECK
        findViewById<View>(R.id.navSuggestWord)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {                    // ← ADD THIS CHECK
                startActivity(Intent(this, SuggestWordActivity::class.java))
                finish()
            } else {
                openAuthDialog()                         // ← ADD THIS
            }
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
            R.id.navSuggestWord, R.id.navNotifications, R.id.navProfile, R.id.navSettings
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
                if (allWords.isEmpty()) {
                    emptyState.visibility = View.VISIBLE
                    rvWords.visibility = View.GONE
                }
            }
        }
    }

    // ── Custom Categories ─────────────────────────────────────────────────────

    private fun loadCustomCategories() {
        customCategories = customCategoryManager.getAll().toMutableList()
        refreshCategoryDropdown()
    }

    // ── Category dropdown ─────────────────────────────────────────────────────

    private fun setupCategoryDropdown() {
        refreshCategoryDropdown()
        actvCategory.setOnItemClickListener { _, _, position, _ ->
            val allCategories = getCategoryDisplayList()
            selectedCategory = allCategories[position]
            applyFilters()
        }

        actvCategory.setOnLongClickListener {
            val currentText = actvCategory.text.toString()
            val customCat = customCategories.find { it.name == currentText }
            if (customCat != null) {
                showManageCategoryDialog(customCat)
                true
            } else {
                false
            }
        }
    }

    private fun getCategoryDisplayList(): List<String> {
        val systemCategories = listOf("All Categories") + getUniqueSystemCategories()
        val customCategoryNames = customCategories.map { it.name }
        return systemCategories + customCategoryNames
    }

    private fun getUniqueSystemCategories(): List<String> {
        return allWords.map { it.category }.distinct().sorted()
    }

    private fun refreshCategoryDropdown() {
        val allCategories = getCategoryDisplayList()
        val dropdownAdapter = ArrayAdapter(
            this, android.R.layout.simple_dropdown_item_1line, allCategories
        )
        actvCategory.setAdapter(dropdownAdapter)
    }

    // ── Search ────────────────────────────────────────────────────────────────

    private fun setupSearch() {
        etSearch.addTextChangedListener { text ->
            searchQuery = text?.toString()?.trim() ?: ""
            applyFilters()
        }
    }

    // ── Filtering ─────────────────────────────────────────────────────────────

    private fun applyFilters() {
        val filtered = allWords.filter { word ->
            val matchesCategory = when {
                selectedCategory == "All Categories" -> true
                else -> {
                    // Check if selected category is a custom category
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
        emptyState.visibility = if (count == 0 && !isLoading) View.VISIBLE else View.GONE
        rvWords.visibility = if (count == 0 && !isLoading) View.GONE else View.VISIBLE
    }

    // ── Word detail bottom sheet ──────────────────────────────────────────────

    private fun showWordDetail(word: WordBankWord) {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_word_detail, null)
        dialog.setContentView(view)

        view.findViewById<TextView>(R.id.tvDetailWord).text = word.label.uppercase()
        view.findViewById<TextView>(R.id.tvDetailCategory).text = word.category

        val gestureTypeText = "${word.gesture_type} • ${word.hands_count} hand${if (word.hands_count > 1) "s" else ""}"
        view.findViewById<TextView>(R.id.tvDetailGestureType).text = gestureTypeText

        val badgeColor = if (word.gesture_type == "static") 0xFF0056A4 else 0xFF00796B
        view.findViewById<TextView>(R.id.tvDetailGestureType)
            .setBackgroundColor(badgeColor.toInt())

        // Audio playback
        speakWord(word.label)

        view.findViewById<MaterialButton>(R.id.btnPlayAudio).setOnClickListener {
            speakWord(word.label)
        }

        // Video/Media setup
        val videoView        = view.findViewById<VideoView>(R.id.videoDemo)
        val ivThumbnail      = view.findViewById<ImageView>(R.id.ivThumbnail)
        val noMediaPlaceholder = view.findViewById<android.widget.LinearLayout>(R.id.noMediaPlaceholder)
        val progressVideo    = view.findViewById<ProgressBar>(R.id.progressVideo)
        val playOverlay      = view.findViewById<android.widget.LinearLayout>(R.id.playOverlay)

        val resolvedThumb = ApiClient.resolveUrl(word.thumbnail_url)
        val localThumb    = ModelUpdateManager.getLocalThumb(this, word.id)
        val thumbSource: Any? = localThumb ?: resolvedThumb
        val resolvedVideo = ApiClient.resolveUrl(word.video_url)

        when {
            // Motion gesture with a video URL → play video
            word.gesture_type == "motion" && !resolvedVideo.isNullOrBlank() -> {
                noMediaPlaceholder.visibility = View.GONE
                ivThumbnail.visibility        = View.GONE
                videoView.visibility          = View.VISIBLE
                progressVideo.visibility      = View.VISIBLE

                videoView.setVideoPath(resolvedVideo)
                videoView.setOnPreparedListener { mp ->
                    progressVideo.visibility = View.GONE
                    mp.isLooping = true
                    mp.start()
                }
                videoView.setOnErrorListener { _, _, _ ->
                    progressVideo.visibility  = View.GONE
                    videoView.visibility      = View.GONE
                    noMediaPlaceholder.visibility = View.VISIBLE
                    true
                }
                // Tap to play/pause
                videoView.setOnClickListener {
                    if (videoView.isPlaying) {
                        videoView.pause()
                        playOverlay.visibility = View.VISIBLE
                    } else {
                        videoView.start()
                        playOverlay.visibility = View.GONE
                    }
                }
                playOverlay.setOnClickListener {
                    videoView.start()
                    playOverlay.visibility = View.GONE
                }
            }

            // Static gesture with a thumbnail → show image
            thumbSource != null -> {
                noMediaPlaceholder.visibility = View.GONE
                videoView.visibility          = View.GONE
                ivThumbnail.visibility        = View.VISIBLE
                Glide.with(this)
                    .load(thumbSource)
                    .diskCacheStrategy(DiskCacheStrategy.ALL)
                    .centerCrop()
                    .into(ivThumbnail)
            }

            // Nothing set yet → show placeholder
            else -> {
                ivThumbnail.visibility    = View.GONE
                videoView.visibility      = View.GONE
                noMediaPlaceholder.visibility = View.VISIBLE
            }
        }

        // Update media caption
        val tvMediaCaption = view.findViewById<TextView>(R.id.tvMediaCaption)
        tvMediaCaption.text = when {
            word.gesture_type == "motion" && !resolvedVideo.isNullOrBlank() ->
                "Tap to play · pause · Motion gesture demonstration"
            thumbSource != null ->
                "Sample image of how to form this gesture"
            else ->
                "No demonstration available yet"
        }

        view.findViewById<MaterialButton>(R.id.btnAddToCategory).setOnClickListener {
            showAddToCategoryDialog(word)
            dialog.dismiss()
        }

        dialog.setOnDismissListener {
            videoView.stopPlayback()
        }

        dialog.show()
    }

    private fun speakWord(word: String) {
        if (isTtsReady) {
            tts?.speak(word, TextToSpeech.QUEUE_FLUSH, null, null)
        } else {
            Toast.makeText(this, "🔊 Playing: $word", Toast.LENGTH_SHORT).show()
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

    // FIX: added missing showCreateCategoryDialog referenced at lines 568 and 682
    private fun showCreateCategoryDialog() {
        showCategoryEditDialog(
            title = "Create category",
            hint = "Category name",
            subtitle = "Create a new custom category to organize words.",
            currentValue = "",
            maxLength = 50,
            extraValidate = { name ->
                if (customCategories.any { it.name.equals(name, ignoreCase = true) })
                    "\"$name\" already exists"
                else
                    null
            }
        ) { newName ->
            val newCat = customCategoryManager.create(newName)
            customCategories.add(newCat)
            refreshCategoryDropdown()
            Toast.makeText(this, "Category \"$newName\" created", Toast.LENGTH_SHORT).show()
        }
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
                    actvCategory.setText(newName, false)
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
                    actvCategory.setText("", false)
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

    // ── Add word to custom category ───────────────────────────────────────────

    private fun showAddToCategoryDialog(word: WordBankWord) {
        if (customCategories.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle("No Custom Categories")
                .setMessage("You haven't created any custom categories yet. Would you like to create one?")
                .setPositiveButton("Create") { _, _ -> showCreateCategoryDialog() }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }

        val options = customCategories.map { it.name }.toTypedArray()
        val checked = BooleanArray(customCategories.size) { i ->
            word.id in customCategories[i].wordIds
        }

        AlertDialog.Builder(this)
            .setTitle("Add \"${word.label}\" to categories")
            .setMultiChoiceItems(options, checked) { _, which, isChecked ->
                val category = customCategories[which]
                if (isChecked) {
                    customCategoryManager.addWord(category.id, word.id)
                    customCategories[which] = customCategoryManager.get(category.id)!!
                    Toast.makeText(this, "Added to \"${category.name}\"", Toast.LENGTH_SHORT).show()
                } else {
                    customCategoryManager.removeWord(category.id, word.id)
                    customCategories[which] = customCategoryManager.get(category.id)!!
                    Toast.makeText(this, "Removed from \"${category.name}\"", Toast.LENGTH_SHORT).show()
                }
                // Refresh if viewing this category
                if (selectedCategory == category.name) {
                    applyFilters()
                }
            }
            .setPositiveButton("Done", null)
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ── RecyclerView setup ────────────────────────────────────────────────────

    private fun setupRecyclerView() {
        adapter = WordBankAdapter(
            words = mutableListOf(),
            onWordClick = { word -> showWordDetail(word) },
            onDemoClick = { word -> showWordDetail(word) }
        )
        rvWords.layoutManager = LinearLayoutManager(this)
        rvWords.adapter = adapter
    }

    // ── Wire listeners ────────────────────────────────────────────────────────

    private fun wireListeners() {
        btnCreateCategory.setOnClickListener { showCreateCategoryDialog() }
        btnCreateCategory.setOnLongClickListener {
            if (customCategories.isNotEmpty()) {
                Toast.makeText(this, "Long press on a category in the dropdown to manage it", Toast.LENGTH_LONG).show()
            }
            true
        }
    }

    // ── Back press ────────────────────────────────────────────────────────────

    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        if (drawerLayout.isDrawerOpen(GravityCompat.START)) {
            drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }
}

// ── Adapter for WordBankWord ───────────────────────────────────────────────────

class WordBankAdapter(
    private val words: MutableList<WordBankWord>,
    private val onWordClick: (WordBankWord) -> Unit,
    private val onDemoClick: (WordBankWord) -> Unit
) : RecyclerView.Adapter<WordBankAdapter.WordViewHolder>() {

    class WordViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val tvWord: TextView = view.findViewById(R.id.tvWord)
        val tvCategory: TextView = view.findViewById(R.id.tvCategory)
        val tvGestureType: TextView = view.findViewById(R.id.tvGestureType)
        val btnWatchDemo: MaterialButton = view.findViewById(R.id.btnWatchDemo)
        val ivThumbnail: ImageView = view.findViewById(R.id.ivThumbnail)
        val llAudioFallback: android.widget.LinearLayout = view.findViewById(R.id.llAudioFallback)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): WordViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_word_entry, parent, false)
        return WordViewHolder(view)
    }

    override fun onBindViewHolder(holder: WordViewHolder, position: Int) {
        val word = words[position]
        holder.tvWord.text = word.label
        holder.tvCategory.text = word.category
        val gestureText = "${word.gesture_type} • ${word.hands_count}H"
        holder.tvGestureType.text = gestureText

        val badgeColor = if (word.gesture_type == "static") 0xFF0056A4 else 0xFF00796B
        holder.tvGestureType.setBackgroundColor(badgeColor.toInt())

        // Load thumbnail
        val resolvedThumb = ApiClient.resolveUrl(word.thumbnail_url)
        val localThumb = ModelUpdateManager.getLocalThumb(holder.itemView.context, word.id)
        val thumbSource: Any? = localThumb ?: resolvedThumb

        if (thumbSource != null) {
            Glide.with(holder.itemView.context)
                .load(thumbSource)
                .diskCacheStrategy(DiskCacheStrategy.ALL)
                .centerCrop()
                .placeholder(android.R.color.darker_gray)
                .error(android.R.color.darker_gray)
                .into(holder.ivThumbnail)
            holder.ivThumbnail.visibility = View.VISIBLE
            holder.llAudioFallback.visibility = View.GONE
        } else {
            holder.ivThumbnail.visibility = View.GONE
            holder.llAudioFallback.visibility = View.VISIBLE
        }

        holder.itemView.setOnClickListener { onWordClick(word) }
        holder.btnWatchDemo.setOnClickListener { onDemoClick(word) }
    }

    override fun getItemCount(): Int = words.size

    fun setWords(newWords: MutableList<WordBankWord>) {
        words.clear()
        words.addAll(newWords)
        notifyDataSetChanged()
    }
}