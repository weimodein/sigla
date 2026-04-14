package com.example.sigla

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlinx.coroutines.launch

class ProfileActivity : AppCompatActivity() {

    private lateinit var drawer: DrawerLayout
    private lateinit var session: SessionManager

    // ── Views cached at onCreate ──────────────────────────────────────────────
    private lateinit var tvFullName: TextView
    private lateinit var tvUsername: TextView
    private lateinit var tvEmail: TextView
    private lateinit var tvDisplayName: TextView
    private lateinit var tvDisplayUsername: TextView
    private lateinit var tvAvatarInitials: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_profile)

        session = SessionManager.getInstance(this)

        // Check if user is logged in
        if (!session.isLoggedIn) {
            startActivity(Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
            return
        }

        drawer = findViewById(R.id.drawerLayout)

        bindViews()
        setupTopBar()
        setupSidebar()
        loadUserData()
        setupButtons()
    }

    override fun onResume() {
        super.onResume()
        refreshSidebarAuthState()
    }
    // ── Refresh Side Bar ───────────────────────────────────────────────────
    private fun refreshSidebarAuthState() {
        val sidebar = drawer.getChildAt(1)
        val tvUsername = sidebar.findViewById<TextView>(R.id.tvSidebarUsername)
        val tvEmail = sidebar.findViewById<TextView>(R.id.tvSidebarEmail)
        val btnSignIn = sidebar.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnSidebarSignIn)
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
            loadUserData()
        }
        dialog.show(supportFragmentManager, "auth")
    }

    // ── Bind all views once ───────────────────────────────────────────────────

    private fun bindViews() {
        tvFullName        = findViewById(R.id.tvFullName)
        tvUsername        = findViewById(R.id.tvUsername)
        tvEmail           = findViewById(R.id.tvEmail)
        tvDisplayName     = findViewById(R.id.tvDisplayName)
        tvDisplayUsername = findViewById(R.id.tvDisplayUsername)
        tvAvatarInitials  = findViewById(R.id.tvAvatarInitials)
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private fun setupTopBar() {
        findViewById<View>(R.id.btnSidebar).setOnClickListener {
            drawer.openDrawer(GravityCompat.START)
        }
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────

    private fun setupSidebar() {
        refreshSidebarAuthState()
        setActiveNavItem(R.id.navProfile)

        findViewById<View>(R.id.navMainInterface)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.navWordBank)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, WordBankActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.navTranslationHistory)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, TranslationHistoryActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.navSuggestWord)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {
                startActivity(Intent(this, SuggestWordActivity::class.java))
                finish()
            } else {
                openAuthDialog()
            }
        }
        findViewById<View>(R.id.navNotifications)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {
                startActivity(Intent(this, NotificationsActivity::class.java))
                finish()
            } else {
                openAuthDialog()
            }
        }
        findViewById<View>(R.id.navProfile)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
        }
        findViewById<View>(R.id.navSettings)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, SettingsActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.btnSidebarSignIn)?.setOnClickListener {
            drawer.closeDrawers()
            openAuthDialog()
        }
    }

    private fun setActiveNavItem(activeId: Int) {
        val navIds = listOf(
            R.id.navMainInterface,
            R.id.navWordBank,
            R.id.navTranslationHistory,
            R.id.navSuggestWord,
            R.id.navNotifications,
            R.id.navProfile,
            R.id.navSettings
        )
        navIds.forEach { id ->
            val view = findViewById<LinearLayout>(id) ?: return@forEach
            if (id == activeId) {
                view.setBackgroundResource(R.drawable.bg_nav_item_selected)
                (view.getChildAt(0) as? ImageView)?.imageTintList =
                    ColorStateList.valueOf(0xFF4A90E2.toInt())
                (view.getChildAt(1) as? TextView)?.apply {
                    setTextColor(0xFF4A90E2.toInt())
                    setTypeface(null, Typeface.BOLD)
                }
            } else {
                view.setBackgroundResource(R.drawable.bg_nav_item_default)
                (view.getChildAt(0) as? ImageView)?.imageTintList =
                    ColorStateList.valueOf(0xFF6C757D.toInt())
                (view.getChildAt(1) as? TextView)?.apply {
                    setTextColor(0xFF6C757D.toInt())
                    setTypeface(null, Typeface.NORMAL)
                }
            }
        }
    }

    // ── Load user data from SessionManager ────────────────────────────────────

    private fun loadUserData() {
        val fullName = session.name ?: session.username ?: "User"
        val username = session.username ?: "user"
        val email = session.email ?: ""

        tvFullName.text = fullName
        tvUsername.text = username
        tvEmail.text = email
        tvDisplayName.text = fullName
        tvDisplayUsername.text = "@$username"
        tvAvatarInitials.text = buildInitials(fullName)
    }

    private fun buildInitials(fullName: String): String =
        fullName.split(" ")
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercaseChar().toString() }

    // ── Buttons ───────────────────────────────────────────────────────────────

    private fun setupButtons() {
        // Edit Full Name
        findViewById<View>(R.id.rowFullName)?.setOnClickListener {
            showEditDialog(
                title        = "Edit Name",
                hint         = "Full name",
                subtitle     = "This is the name displayed on your profile.",
                currentValue = tvFullName.text.toString(),
                inputType    = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS,
                maxLength    = 60
            ) { newValue ->
                lifecycleScope.launch {
                    try {
                        val response = ApiClient.get(session.token)
                            .updateProfile(session.userId, UpdateProfileRequest(session.username ?: "", newValue))
                        if (response.isSuccessful) {
                            session.name = newValue
                            tvFullName.text = newValue
                            tvDisplayName.text = newValue
                            tvAvatarInitials.text = buildInitials(newValue)
                            Toast.makeText(this@ProfileActivity, "Name updated.", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(this@ProfileActivity, parseError(response), Toast.LENGTH_SHORT).show()
                        }
                    } catch (e: Exception) {
                        Toast.makeText(this@ProfileActivity, "Connection failed: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }

        // Edit Username
        findViewById<View>(R.id.rowUsername)?.setOnClickListener {
            showEditDialog(
                title        = "Edit Username",
                hint         = "Username",
                subtitle     = "Letters, numbers, and underscores only. No spaces.",
                currentValue = tvUsername.text.toString(),
                inputType    = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
                maxLength    = 30
            ) { newValue ->
                lifecycleScope.launch {
                    try {
                        val response = ApiClient.get(session.token)
                            .updateProfile(session.userId, UpdateProfileRequest(newValue, session.name ?: ""))
                        if (response.isSuccessful) {
                            session.username = newValue
                            tvUsername.text = newValue
                            tvDisplayUsername.text = "@$newValue"
                            Toast.makeText(this@ProfileActivity, "Username updated.", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(this@ProfileActivity, parseError(response), Toast.LENGTH_SHORT).show()
                        }
                    } catch (e: Exception) {
                        Toast.makeText(this@ProfileActivity, "Connection failed: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }

        // Change Password
        findViewById<View>(R.id.rowChangePassword)?.setOnClickListener {
            val email = session.email ?: return@setOnClickListener
            
            lifecycleScope.launch {
                try {
                    val response = ApiClient.get().forgotPassword(ForgotPasswordRequest(email))
                    if (response.isSuccessful) {
                        showChangePasswordDialog()
                    } else {
                        Toast.makeText(this@ProfileActivity, parseError(response), Toast.LENGTH_SHORT).show()
                    }
                } catch (e: Exception) {
                    Toast.makeText(this@ProfileActivity, "Connection failed: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // Logout
        findViewById<View>(R.id.btnLogout)?.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Log Out")
                .setMessage("Are you sure you want to log out?")
                .setPositiveButton("Log Out") { _, _ ->
                    session.clearSession()
                    startActivity(Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
                    finish()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }

    // ── Generic inline-edit dialog ────────────────────────────────────────────

    private fun showEditDialog(
        title: String,
        hint: String,
        subtitle: String = "",
        currentValue: String,
        inputType: Int,
        maxLength: Int,
        onConfirm: (String) -> Unit
    ) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_edit_field, null, false)
        val til        = dialogView.findViewById<TextInputLayout>(R.id.tilDialogField)
        val et         = dialogView.findViewById<TextInputEditText>(R.id.etDialogField)
        val tvSub      = dialogView.findViewById<TextView>(R.id.tvDialogSubtitle)

        // Configure the field
        til.hint                = hint
        til.counterMaxLength    = maxLength
        et.inputType            = inputType
        et.filters              = arrayOf(InputFilter.LengthFilter(maxLength))
        et.setText(currentValue)
        et.setSelection(currentValue.length)

        // Optional subtitle
        if (subtitle.isNotEmpty()) {
            tvSub.text       = subtitle
            tvSub.visibility = View.VISIBLE
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

                // Username validation
                if (inputType == InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) {
                    val usernameRegex = Regex("^[a-zA-Z0-9_]+$")
                    if (!usernameRegex.matches(newValue)) {
                        til.error = "Only letters, numbers, and underscores allowed"
                        return@setOnClickListener
                    }
                }

                til.error = null
                dialog.dismiss()
                onConfirm(newValue)
            }
        }

        dialog.show()
    }

    // ── Change Password Dialog ────────────────────────────────────────────────

    private fun showChangePasswordDialog() {
        val inputCode = android.widget.EditText(this).apply {
            hint = "6-digit verification code"
            inputType = InputType.TYPE_CLASS_NUMBER
            maxLines = 1
            filters = arrayOf(InputFilter.LengthFilter(6))
        }

        AlertDialog.Builder(this)
            .setTitle("Verify Your Email")
            .setMessage("A 6-digit verification code has been sent to your registered email address. Enter it below to continue.")
            .setView(inputCode)
            .setPositiveButton("Verify") { _, _ ->
                val code = inputCode.text.toString().trim()
                if (code.length != 6) {
                    Toast.makeText(this, "Please enter a valid 6-digit code.", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                verifyCodeAndShowNewPassword(code)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun verifyCodeAndShowNewPassword(code: String) {
        val email = session.email ?: return
        
        lifecycleScope.launch {
            try {
                val verifyResponse = ApiClient.get().verifyResetCode(VerifyResetRequest(email, code))
                if (verifyResponse.isSuccessful) {
                    showNewPasswordDialog(code)
                } else {
                    Toast.makeText(this@ProfileActivity, "Invalid or expired code", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@ProfileActivity, "Connection failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showNewPasswordDialog(code: String) {
        val layout = layoutInflater.inflate(R.layout.dialog_new_password, null, false)
        val etNew = layout.findViewById<TextInputEditText>(R.id.etNewPassword)
        val etConfirm = layout.findViewById<TextInputEditText>(R.id.etConfirmPassword)

        AlertDialog.Builder(this)
            .setTitle("Set New Password")
            .setView(layout)
            .setPositiveButton("Save Password") { _, _ ->
                val newPass = etNew.text.toString().trim()
                val confirmPass = etConfirm.text.toString().trim()
                when {
                    newPass.length < 6 ->
                        Toast.makeText(this, "Password must be at least 6 characters.", Toast.LENGTH_SHORT).show()
                    newPass != confirmPass ->
                        Toast.makeText(this, "Passwords do not match.", Toast.LENGTH_SHORT).show()
                    else -> {
                        resetPassword(code, newPass)
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun resetPassword(code: String, newPassword: String) {
        val email = session.email ?: return
        
        lifecycleScope.launch {
            try {
                val response = ApiClient.get().resetPassword(ResetPasswordRequest(email, newPassword))
                if (response.isSuccessful) {
                    Toast.makeText(this@ProfileActivity, "Password changed successfully.", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this@ProfileActivity, parseError(response), Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@ProfileActivity, "Connection failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun parseError(response: retrofit2.Response<*>): String {
        return try {
            val errorBody = response.errorBody()?.string() ?: ""
            val json = com.google.gson.JsonParser.parseString(errorBody).asJsonObject
            json.get("message")?.asString ?: "Something went wrong"
        } catch (e: Exception) { "Something went wrong" }
    }

    // ── Back press ────────────────────────────────────────────────────────────

    @Deprecated("Use OnBackPressedDispatcher instead") 
    override fun onBackPressed() {
        if (drawer.isDrawerOpen(GravityCompat.START)) {
            drawer.closeDrawer(GravityCompat.START)
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }
}