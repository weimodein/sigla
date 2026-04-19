package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.text.SpannableString
import android.text.Spanned
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import android.text.style.ForegroundColorSpan
import android.text.style.UnderlineSpan
import android.view.View
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlinx.coroutines.launch
import android.widget.ImageView
import androidx.core.view.isVisible
import com.google.android.material.dialog.MaterialAlertDialogBuilder

class SuggestWordActivity : AppCompatActivity() {

    // ── Views ──────────────────────────────────────────────────────────────────
    private lateinit var drawerLayout: DrawerLayout
    private lateinit var session: SessionManager
    private lateinit var btnSidebar: MaterialButton
    private lateinit var tilWord: TextInputLayout
    private lateinit var etWord: TextInputEditText
    private lateinit var tilDescription: TextInputLayout
    private lateinit var etDescription: TextInputEditText
    private lateinit var btnOneHand: LinearLayout
    private lateinit var btnTwoHands: LinearLayout
    private lateinit var btnStatic: LinearLayout
    private lateinit var btnMotion: LinearLayout
    private lateinit var tvGestureTypeHint: TextView
    private lateinit var tvSuggestError: TextView
    private lateinit var cbTerms: CheckBox
    private lateinit var tvTermsLabel: TextView
    private lateinit var btnStartCollecting: MaterialButton

    // ── Status banners ─────────────────────────────────────────────────────────
    private lateinit var wordStatusBanner: LinearLayout
    private lateinit var tvWordStatus: TextView
    private lateinit var quotaReachedBanner: LinearLayout

    // ── State ──────────────────────────────────────────────────────────────────
    private var isTwoHands = false
    private var isMotion = false
    
    private var remainingUserSamples: Int = 0

    // Request code for Terms Activity
    private val TERMS_REQUEST_CODE = 1001

    // ── Lifecycle ──────────────────────────────────────────────────────────────
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_suggest_word)

        session = SessionManager.getInstance(this)
        drawerLayout = findViewById(R.id.drawerLayout)
        
        // Require login
        if (!session.isLoggedIn) {
            startActivity(Intent(this, AuthActivity::class.java))
            finish()
            return
        }

        bindViews()
        setupTopBar()
        setupSidebar()
        setupHandButtons()
        setupGestureTypeButtons()
        setupTermsCheckbox()
        wireListeners()
    }

    override fun onResume() {
        super.onResume()
        refreshSidebarAuthState()  // ← UPDATE SIDEBAR WHEN ACTIVITY RESUMES
    }

    // ── Refresh Sidebar  ───────────────────────────────────────────────────────────
    private fun refreshSidebarAuthState() {
        val sidebar = drawerLayout.getChildAt(1) ?: return
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
    // ── View binding ───────────────────────────────────────────────────────────
    private fun bindViews() {
        drawerLayout      = findViewById(R.id.drawerLayout)
        btnSidebar        = findViewById(R.id.btnSidebar)
        tilWord           = findViewById(R.id.tilWord)
        etWord            = findViewById(R.id.etWord)
        tilDescription    = findViewById(R.id.tilDescription)
        etDescription     = findViewById(R.id.etDescription)
        btnOneHand        = findViewById(R.id.btnOneHand)
        btnTwoHands       = findViewById(R.id.btnTwoHands)
        btnStatic         = findViewById(R.id.btnStatic)
        btnMotion         = findViewById(R.id.btnMotion)
        tvGestureTypeHint = findViewById(R.id.tvGestureTypeHint)
        tvSuggestError    = findViewById(R.id.tvSuggestError)
        cbTerms           = findViewById(R.id.cbTerms)
        tvTermsLabel      = findViewById(R.id.tvTermsLabel)
        btnStartCollecting = findViewById(R.id.btnStartCollecting)

        // Status banners
        wordStatusBanner   = findViewById(R.id.wordStatusBanner)
        tvWordStatus       = findViewById(R.id.tvWordStatus)
        quotaReachedBanner = findViewById(R.id.quotaReachedBanner)
    }

    // ── Top bar ───────────────────────────────────────────────────────────────
    private fun setupTopBar() {
        btnSidebar.setOnClickListener { drawerLayout.openDrawer(GravityCompat.START) }
    }
    
    // ── Sidebar ───────────────────────────────────────────────────────────────
    private fun setupSidebar() {
        refreshSidebarAuthState()
        setActiveNavItem(R.id.navSuggestWord)

        findViewById<View>(R.id.navMainInterface)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (javaClass != MainActivity::class.java) {
                startActivity(Intent(this, MainActivity::class.java))
                finish()
            }
        }
        
        findViewById<View>(R.id.navWordBank)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (javaClass != WordBankActivity::class.java) {
                startActivity(Intent(this, WordBankActivity::class.java))
                finish()
            }
        }
        
        findViewById<View>(R.id.navTranslationHistory)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (javaClass != TranslationHistoryActivity::class.java) {
                startActivity(Intent(this, TranslationHistoryActivity::class.java))
                finish()
            }
        }
        
        // For Suggest Word - DON'T RESTART IF ALREADY HERE
        findViewById<View>(R.id.navSuggestWord)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {
                // Only navigate if not already on SuggestWordActivity
                if (javaClass != SuggestWordActivity::class.java) {
                    startActivity(Intent(this, SuggestWordActivity::class.java))
                    finish()
                }
            } else {
                openAuthDialog()
            }
        }
        
        // For Notifications - DON'T RESTART IF ALREADY HERE
        findViewById<View>(R.id.navNotifications)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {
                if (javaClass != NotificationsActivity::class.java) {
                    startActivity(Intent(this, NotificationsActivity::class.java))
                    finish()
                }
            } else {
                openAuthDialog()
            }
        }
        
        // For Profile - DON'T RESTART IF ALREADY HERE
        findViewById<View>(R.id.navProfile)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {
                if (javaClass != ProfileActivity::class.java) {
                    startActivity(Intent(this, ProfileActivity::class.java))
                    finish()
                }
            } else {
                openAuthDialog()
            }
        }
        
        findViewById<View>(R.id.navSettings)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (javaClass != SettingsActivity::class.java) {
                startActivity(Intent(this, SettingsActivity::class.java))
                finish()
            }
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

    // ── Number of Hands toggle ─────────────────────────────────────────────────
    private fun setupHandButtons() {
        setHandSelection(twoHands = false)

        btnOneHand.setOnClickListener {
            isTwoHands = false
            setHandSelection(twoHands = false)
        }
        btnTwoHands.setOnClickListener {
            isTwoHands = true
            setHandSelection(twoHands = true)
        }
    }

    private fun setHandSelection(twoHands: Boolean) {
        btnOneHand.setBackgroundResource(
            if (!twoHands) R.drawable.bg_selection_active else R.drawable.bg_selection_inactive
        )
        btnTwoHands.setBackgroundResource(
            if (twoHands) R.drawable.bg_selection_active else R.drawable.bg_selection_inactive
        )
    }

    // ── Gesture Type toggle ────────────────────────────────────────────────────
    private fun setupGestureTypeButtons() {
        setGestureSelection(motion = false)
        updateGestureHint(isMotion = false)

        btnStatic.setOnClickListener {
            isMotion = false
            setGestureSelection(motion = false)
            updateGestureHint(isMotion = false)
        }
        btnMotion.setOnClickListener {
            isMotion = true
            setGestureSelection(motion = true)
            updateGestureHint(isMotion = true)
        }
    }

    private fun setGestureSelection(motion: Boolean) {
        btnStatic.setBackgroundResource(
            if (!motion) R.drawable.bg_selection_active else R.drawable.bg_selection_inactive
        )
        btnMotion.setBackgroundResource(
            if (motion) R.drawable.bg_selection_active else R.drawable.bg_selection_inactive
        )
    }

    private fun updateGestureHint(isMotion: Boolean) {
        tvGestureTypeHint.text = if (isMotion)
            "Motion gestures involve movement, e.g. waving or swiping. Collection takes approx. 3–5 minutes. Max 50 samples."
        else
            "Static gestures are held still in one position. Collection takes approx. 3–5 minutes. Max 50 samples."
    }

    // ── Terms & Conditions label with clickable link ───────────────────────────
    private fun setupTermsCheckbox() {
        val fullText = "I have read the terms and conditions"
        val linkText = "terms and conditions"
        val linkStart = fullText.indexOf(linkText)
        val linkEnd = linkStart + linkText.length

        val spannable = SpannableString(fullText)
        spannable.setSpan(
            ForegroundColorSpan(0xFF1976D2.toInt()),
            linkStart, linkEnd,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
        )
        spannable.setSpan(
            UnderlineSpan(),
            linkStart, linkEnd,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
        )
        spannable.setSpan(
            object : ClickableSpan() {
                override fun onClick(widget: View) {
                    openTermsAndConditions()
                }
                override fun updateDrawState(ds: android.text.TextPaint) {
                    ds.color = 0xFF1976D2.toInt()
                    ds.isUnderlineText = true
                }
            },
            linkStart, linkEnd,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
        )

        tvTermsLabel.text = spannable
        tvTermsLabel.movementMethod = LinkMovementMethod.getInstance()
        tvTermsLabel.highlightColor = android.graphics.Color.TRANSPARENT
    }

    private fun openTermsAndConditions() {
        val intent = Intent(this, TermsActivity::class.java)
        startActivityForResult(intent, TERMS_REQUEST_CODE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        
        if (requestCode == TERMS_REQUEST_CODE && resultCode == RESULT_OK) {
            // User accepted terms - optionally auto-check the checkbox
            if (!cbTerms.isChecked) {
                cbTerms.isChecked = true
            }
        }
    }

    // ── Listeners ──────────────────────────────────────────────────────────────
    private fun wireListeners() {
        val termsRow = findViewById<View>(R.id.termsRow)
        termsRow.setOnClickListener {
            cbTerms.isChecked = !cbTerms.isChecked
        }

        cbTerms.setOnCheckedChangeListener { _, isChecked ->
            btnStartCollecting.isEnabled = isChecked && areFieldsValid()
            btnStartCollecting.alpha = if (btnStartCollecting.isEnabled) 1f else 0.45f
        }

        btnStartCollecting.setOnClickListener { showReviewDialog() }
        
        // Enable/disable based on field changes
        etWord.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) { validateFields() }
        })
        etDescription.addTextChangedListener(object : android.text.TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: android.text.Editable?) { validateFields() }
        })
    }
    
    private fun validateFields() {
        val wordValid = etWord.text?.toString()?.trim()?.isNotEmpty() == true
        val descValid = etDescription.text?.toString()?.trim()?.isNotEmpty() == true
        btnStartCollecting.isEnabled = cbTerms.isChecked && wordValid && descValid
        btnStartCollecting.alpha = if (btnStartCollecting.isEnabled) 1f else 0.45f
        // DO NOT add any finish() or startActivity() calls here
    }
    
    private fun areFieldsValid(): Boolean {
        return etWord.text?.toString()?.trim()?.isNotEmpty() == true &&
               etDescription.text?.toString()?.trim()?.isNotEmpty() == true
    }

    // ── Review Dialog ─────────────────────────────────────────────────────────
    private fun showReviewDialog() {
        val word = etWord.text?.toString()?.trim() ?: ""
        val description = etDescription.text?.toString()?.trim() ?: ""
        val handsLabel = if (isTwoHands) "Two Hands" else "One Hand"
        val gestureLabel = if (isMotion) "Motion" else "Static"

        val message = """
            Please review your submission before proceeding:

            Word:  $word
            Description:  $description
            Hand(s):  $handsLabel
            Gesture Type:  $gestureLabel
        """.trimIndent()

        MaterialAlertDialogBuilder(this)
            .setTitle("Review Your Submission")
            .setMessage(message)
            .setPositiveButton("Confirm & Submit") { dialog, _ ->
                dialog.dismiss()
                attemptSubmit()
            }
            .setNegativeButton("Edit") { dialog, _ ->
                dialog.dismiss()
            }
            .show()
    }

    // ── Submission to Backend ─────────────────────────────────────────────────
    private fun attemptSubmit() {
        val word = etWord.text?.toString()?.trim() ?: ""
        val description = etDescription.text?.toString()?.trim() ?: ""
        val handsCount = if (isTwoHands) 2 else 1
        val gestureType = if (isMotion) "motion" else "static"

        clearError()
        tilWord.error = null
        tilDescription.error = null

        setLoading(true)
        
        lifecycleScope.launch {
            try {
                val api = ApiClient.get(session.token)
                val response = api.submitWord(
                    SubmitWordRequest(
                        label = word,
                        description = description,
                        hands_count = handsCount,
                        gesture_type = gestureType
                    )
                )

                if (response.isSuccessful) {
                    val body = response.body()
                    if (body == null) {
                        showError("Server returned an empty response")
                        setLoading(false)
                        return@launch
                    }
                    val wordId = body.word_id ?: body.word?.id ?: 0

                    val sessionMax = 50
                    
                    Toast.makeText(this@SuggestWordActivity,
                        "Word submitted! Now collect gesture samples.", Toast.LENGTH_SHORT).show()
                    
                    navigateToCollection(wordId, word, gestureType, handsCount, sessionMax)
                    
                } else if (response.code() == 409) {
                    // Word already exists - parse error response
                    handleExistingWordResponse(response, word, handsCount, gestureType)
                } else {
                    showError(parseError(response))
                    setLoading(false)
                }
            } catch (e: Exception) {
                showError("Connection failed: ${e.message}")
                setLoading(false)
            }
        }
    }
    
    private fun handleExistingWordResponse(response: retrofit2.Response<*>, word: String, handsCount: Int, gestureType: String) {
        setLoading(false)
        showExistsBanner(word)
    }
    
    private fun navigateToCollection(wordId: Int, wordLabel: String, gestureType: String, handsCount: Int, targetCount: Int) {
        val intent = Intent(this, CollectionActivity::class.java).apply {
            putExtra("word_id", wordId)
            putExtra("word_label", wordLabel)
            putExtra("mode", "suggest")
            putExtra("gesture_type", gestureType)
            putExtra("hands_count", handsCount)
            putExtra("target_count", targetCount)
        }
        startActivity(intent)
        finish()
    }
    
    // ── Banner helpers ─────────────────────────────────────────────────────────
    private fun showCapReachedBanner(totalCap: Int, collected: Int) {
        quotaReachedBanner.isVisible = true
        wordStatusBanner.isVisible = false
        val tvQuotaMsg = quotaReachedBanner.findViewById<TextView>(R.id.tvWordStatus) ?: findViewById(R.id.tvWordStatus) as? TextView
        tvQuotaMsg?.text = "The maximum of $totalCap gesture samples for this word has already been collected ($collected/$totalCap). No more contributions are accepted."
        btnStartCollecting.isEnabled = false
        btnStartCollecting.text = "Start Collecting"
        btnStartCollecting.alpha = 0.45f
    }
    
    private fun showUserQuotaBanner(perUserCap: Int, userSamples: Int) {
        quotaReachedBanner.isVisible = true
        wordStatusBanner.isVisible = false
        val tvQuotaMsg = quotaReachedBanner.findViewById<TextView>(R.id.tvWordStatus) ?: findViewById(R.id.tvWordStatus) as? TextView
        tvQuotaMsg?.text = "You have already contributed the maximum of $perUserCap samples for this word ($userSamples/$perUserCap)."
        btnStartCollecting.isEnabled = false
        btnStartCollecting.text = "Start Collecting"
        btnStartCollecting.alpha = 0.45f
    }

    private fun showExistsBanner(word: String) {
        tvWordStatus.text = "\"$word\" is already in the system. You can only suggest words that are not yet available."
        wordStatusBanner.isVisible = true
        quotaReachedBanner.isVisible = false
        btnStartCollecting.isEnabled = false
        btnStartCollecting.text = "Start Collecting"
        btnStartCollecting.alpha = 0.45f
    }

    // ── Error helpers ──────────────────────────────────────────────────────────
    private fun showError(msg: String) {
        tvSuggestError.text = msg
        tvSuggestError.isVisible = true
    }

    private fun clearError() {
        tvSuggestError.text = ""
        tvSuggestError.isVisible = false
    }
    
    private fun setLoading(loading: Boolean) {
        btnStartCollecting.isEnabled = !loading
        btnStartCollecting.text = if (loading) "Checking..." else "Start Collecting"
    }
    
    private fun parseError(response: retrofit2.Response<*>): String {
        return try {
            val errorBody = response.errorBody()?.string() ?: ""
            val json = com.google.gson.JsonParser.parseString(errorBody).asJsonObject
            json.get("message")?.asString ?: "Something went wrong"
        } catch (e: Exception) { "Something went wrong" }
    }
}