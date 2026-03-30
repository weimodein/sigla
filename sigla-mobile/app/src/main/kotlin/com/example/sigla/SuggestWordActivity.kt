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
                    if (body.exists) {
                        // Word already exists - ask if they want to contribute samples
                        AlertDialog.Builder(this@SuggestWordActivity)
                            .setTitle(getString(R.string.word_exists_title))
                            .setMessage(getString(R.string.word_exists_message))
                            .setPositiveButton("Contribute") { _, _ ->
                                navigateToCollection(body.word_id ?: body.word?.id ?: 0, normalizedWord)
                            }
                            .setNegativeButton("Cancel", null)
                            .show()
                    } else {
                        val wordId = body.word_id ?: body.word?.id ?: 0
                        Toast.makeText(this@SuggestWordActivity,
                            "Word submitted! Now collect gesture samples.", Toast.LENGTH_SHORT).show()
                        navigateToCollection(wordId, normalizedWord)
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

    private fun navigateToCollection(wordId: Int, wordLabel: String) {
        val intent = Intent(this, CollectionActivity::class.java).apply {
            putExtra("word_id", wordId)
            putExtra("word_label", wordLabel)
            putExtra("mode", "suggest")
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
