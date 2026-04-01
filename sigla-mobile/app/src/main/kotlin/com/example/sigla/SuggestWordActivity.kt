package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.CheckBox
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.button.MaterialButtonToggleGroup
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch

class SuggestWordActivity : AppCompatActivity() {

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var session: SessionManager

    private lateinit var etWord: TextInputEditText
    private lateinit var etDescription: TextInputEditText
    private lateinit var toggleHands: MaterialButtonToggleGroup
    private lateinit var toggleGesture: MaterialButtonToggleGroup
    private lateinit var cbTerms: CheckBox
    private lateinit var tvError: TextView
    private lateinit var btnSubmit: MaterialButton
    private lateinit var progressSubmit: ProgressBar

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

        // Sidebar
        val sidebar = drawerLayout.getChildAt(1)
        NavigationHelper.setup(this, drawerLayout, sidebar, Screen.SUGGEST)
        findViewById<MaterialButton>(R.id.btnMenu).setOnClickListener {
            drawerLayout.openDrawer(sidebar)
        }

        etWord = findViewById(R.id.etWord)
        etDescription = findViewById(R.id.etDescription)
        toggleHands = findViewById(R.id.toggleHands)
        toggleGesture = findViewById(R.id.toggleGesture)
        cbTerms = findViewById(R.id.cbTerms)
        tvError = findViewById(R.id.tvError)
        btnSubmit = findViewById(R.id.btnSubmit)
        progressSubmit = findViewById(R.id.progressSubmit)

        // Default selections
        toggleHands.check(R.id.btnOneHand)
        toggleGesture.check(R.id.btnStatic)

        // View terms
        findViewById<TextView>(R.id.tvViewTerms).setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle(getString(R.string.terms_title))
                .setMessage(getString(R.string.terms_content))
                .setPositiveButton("Close", null)
                .show()
        }

        // Cancel
        findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { finish() }

        // Submit
        btnSubmit.setOnClickListener { submitWord() }
    }

    private fun submitWord() {
        val word = etWord.text.toString().trim()
        val description = etDescription.text.toString().trim()
        val handsCount = if (toggleHands.checkedButtonId == R.id.btnTwoHands) 2 else 1
        val gestureType = if (toggleGesture.checkedButtonId == R.id.btnMotion) "motion" else "static"

        // Validation
        if (word.isEmpty()) {
            showError("Please enter a word")
            return
        }
        if (description.isEmpty()) {
            showError("Please enter a description")
            return
        }
        if (!cbTerms.isChecked) {
            showError("Please accept the terms and conditions")
            return
        }

        // Normalize word (trim, lowercase for check)
        val normalizedWord = word.trim().lowercase()
            .replaceFirstChar { it.uppercase() }

        setLoading(true)
        lifecycleScope.launch {
            try {
                val api = ApiClient.get(session.token)
                val response = api.submitWord(
                    SubmitWordRequest(
                        label = normalizedWord,
                        description = description,
                        hands_count = handsCount,
                        gesture_type = gestureType
                    )
                )

                if (response.isSuccessful) {
                    val body = response.body()!!
                    val wordId = body.word_id ?: body.word?.id ?: 0
                    Toast.makeText(this@SuggestWordActivity,
                        "Word submitted! Now collect gesture samples.", Toast.LENGTH_SHORT).show()
                    navigateToCollection(wordId, normalizedWord, gestureType, handsCount)
                } else if (response.code() == 409) {
                    // Word already exists — check contribution eligibility
                    val errorBody = response.errorBody()?.string() ?: ""
                    try {
                        val json = com.google.gson.JsonParser.parseString(errorBody).asJsonObject
                        val isExisting = json.get("existing")?.asBoolean ?: false
                        if (isExisting) {
                            val wordId       = json.get("word_id")?.asInt ?: 0
                            val wordLabel    = json.get("label")?.asString ?: normalizedWord
                            val wordGesture  = json.get("gesture_type")?.asString ?: gestureType
                            val wordHands    = json.get("hands_count")?.asInt ?: handsCount
                            val isLocked     = json.get("is_locked")?.asBoolean ?: false
                            val userApproved = json.get("user_approved")?.asBoolean ?: false
                            val capReached   = json.get("cap_reached")?.asBoolean ?: false
                            val cap          = json.get("cap")?.asInt ?: 100

                            when {
                                isLocked -> AlertDialog.Builder(this@SuggestWordActivity)
                                    .setTitle("Submissions Locked")
                                    .setMessage("The administrator has locked submissions for \"$wordLabel\". You cannot contribute gesture samples for this word at this time.")
                                    .setPositiveButton("OK", null)
                                    .show()

                                userApproved -> AlertDialog.Builder(this@SuggestWordActivity)
                                    .setTitle("Already Approved")
                                    .setMessage("Your gesture samples for \"$wordLabel\" have already been approved. You cannot submit additional samples for this word.")
                                    .setPositiveButton("OK", null)
                                    .show()

                                capReached -> AlertDialog.Builder(this@SuggestWordActivity)
                                    .setTitle("Sample Limit Reached")
                                    .setMessage("You have already reached the maximum of $cap samples for \"$wordLabel\".")
                                    .setPositiveButton("OK", null)
                                    .show()

                                else -> AlertDialog.Builder(this@SuggestWordActivity)
                                    .setTitle(getString(R.string.word_exists_title))
                                    .setMessage(getString(R.string.word_exists_message))
                                    .setPositiveButton("Contribute") { _, _ ->
                                        navigateToCollection(wordId, wordLabel, wordGesture, wordHands)
                                    }
                                    .setNegativeButton("Cancel", null)
                                    .show()
                            }
                        } else {
                            showError(json.get("message")?.asString ?: "Submission failed")
                        }
                    } catch (e: Exception) {
                        showError("Submission failed")
                    }
                } else {
                    val errorBody = response.errorBody()?.string() ?: ""
                    val msg = try {
                        com.google.gson.JsonParser.parseString(errorBody).asJsonObject
                            .get("message")?.asString ?: "Submission failed"
                    } catch (e: Exception) { "Submission failed" }
                    showError(msg)
                }
            } catch (e: Exception) {
                showError("Connection failed: ${e.message}")
            } finally {
                setLoading(false)
            }
        }
    }

    private fun navigateToCollection(wordId: Int, wordLabel: String, gestureType: String, handsCount: Int) {
        val intent = Intent(this, CollectionActivity::class.java).apply {
            putExtra("word_id", wordId)
            putExtra("word_label", wordLabel)
            putExtra("mode", "suggest")
            putExtra("gesture_type", gestureType)
            putExtra("hands_count", handsCount)
        }
        startActivity(intent)
        finish()
    }

    private fun showError(msg: String) {
        tvError.text = msg
        tvError.visibility = View.VISIBLE
    }

    private fun setLoading(loading: Boolean) {
        progressSubmit.visibility = if (loading) View.VISIBLE else View.GONE
        btnSubmit.isEnabled = !loading
    }
}
