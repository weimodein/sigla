package com.example.sigla

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.os.Bundle
import android.os.CountDownTimer
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.core.view.isVisible
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

    // ── Password policy ───────────────────────────────────────────────────────
    /**
     * Symbols accepted in passwords — same set used in AuthDialogFragment so
     * policy is consistent across the whole app.
     */
    private val symbolRegex = Regex("""[!@#$%^&*()_\-+=\[\]{};:'",.<>?/\\|`~]""")

    // ── OTP state (Change Password flow) ─────────────────────────────────────
    private val maxOtpAttempts   = 5
    private val codeTtlMs        = 5 * 60 * 1000L   // 5 minutes
    private val resendCooldownMs = 60 * 1000L        // 1 minute
    private var otpAttemptsLeft  = maxOtpAttempts
    private var otpExpiryTimer:  CountDownTimer? = null
    private var otpResendTimer:  CountDownTimer? = null
    private var otpResendOnCooldown = false

    // Keep references to the OTP dialog controls across timer callbacks
    private var otpDialogRef: AlertDialog? = null
    private var otpDigitsRef: List<TextInputEditText> = emptyList()
    private var tvOtpAttemptsRef: TextView? = null
    private var tvOtpErrorRef:    TextView? = null
    private var tvOtpResendRef:   TextView? = null
    private var tvOtpResendCooldownRef: TextView? = null

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_profile)

        session = SessionManager.getInstance(this)

        if (!session.isLoggedIn) {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
            )
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

    override fun onDestroy() {
        super.onDestroy()
        otpExpiryTimer?.cancel()
        otpResendTimer?.cancel()
    }

    // ── Sidebar helpers ───────────────────────────────────────────────────────

    private fun refreshSidebarAuthState() {
        val sidebar   = drawer.getChildAt(1) ?: return
        val tvUser    = sidebar.findViewById<TextView>(R.id.tvSidebarUsername)
        val tvMail    = sidebar.findViewById<TextView>(R.id.tvSidebarEmail)
        val btnSignIn = sidebar.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnSidebarSignIn)
        if (session.isLoggedIn) {
            tvUser?.text    = session.username ?: "User"
            tvMail?.text    = session.email    ?: ""
            btnSignIn?.visibility = View.GONE
        } else {
            tvUser?.text    = "Guest User"
            tvMail?.text    = "Not signed in"
            btnSignIn?.visibility = View.VISIBLE
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

    // ── View binding ──────────────────────────────────────────────────────────

    private fun bindViews() {
        tvFullName        = findViewById(R.id.tvFullName)
        tvUsername        = findViewById(R.id.tvUsername)
        tvEmail           = findViewById(R.id.tvEmail)
        tvDisplayName     = findViewById(R.id.tvDisplayName)
        tvDisplayUsername = findViewById(R.id.tvDisplayUsername)
        tvAvatarInitials  = findViewById(R.id.tvAvatarInitials)
    }

    private fun setupTopBar() {
        findViewById<View>(R.id.btnSidebar).setOnClickListener {
            drawer.openDrawer(GravityCompat.START)
        }
    }

    private fun setupSidebar() {
        refreshSidebarAuthState()
        setActiveNavItem(R.id.navProfile)

        mapOf(
        R.id.navMainInterface       to {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        startActivity(intent)
        overridePendingTransition(0, 0)
        },
            R.id.navProfile             to { /* already here */ },
            R.id.navSettings            to { startActivity(Intent(this, SettingsActivity::class.java)); finish() },
        ).forEach { (id, action) ->
            findViewById<View>(id)?.setOnClickListener { drawer.closeDrawer(GravityCompat.START); action() }
        }

        findViewById<View>(R.id.btnSidebarSignIn)?.setOnClickListener {
            drawer.closeDrawers(); openAuthDialog()
        }
    }

    private fun setActiveNavItem(activeId: Int) {
        listOf(
            R.id.navMainInterface, R.id.navWordBank, R.id.navTranslationHistory,
            R.id.navNotifications, R.id.navProfile, R.id.navSettings
        ).forEach { id ->
            val view = findViewById<LinearLayout>(id) ?: return@forEach
            val isActive = (id == activeId)
            view.setBackgroundResource(if (isActive) R.drawable.bg_nav_item_selected else R.drawable.bg_nav_item_default)
            (view.getChildAt(0) as? ImageView)?.imageTintList =
                ColorStateList.valueOf(if (isActive) 0xFF4A90E2.toInt() else 0xFF6C757D.toInt())
            (view.getChildAt(1) as? TextView)?.apply {
                setTextColor(if (isActive) 0xFF4A90E2.toInt() else 0xFF6C757D.toInt())
                setTypeface(null, if (isActive) Typeface.BOLD else Typeface.NORMAL)
            }
        }
    }

    // ── User data ─────────────────────────────────────────────────────────────

    private fun loadUserData() {
        val fullName = session.name ?: session.username ?: "User"
        val username = session.username ?: "user"
        val email    = session.email ?: ""

        tvFullName.text        = fullName
        tvUsername.text        = username
        tvEmail.text           = email
        tvDisplayName.text     = fullName
        tvDisplayUsername.text = "@$username"
        tvAvatarInitials.text  = buildInitials(fullName)
    }

    private fun buildInitials(name: String): String =
        name.split(" ").filter { it.isNotBlank() }.take(2)
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
                        val r = ApiClient.get(session.token)
                            .updateProfile(session.userId, UpdateProfileRequest(session.username ?: "", newValue))
                        if (r.isSuccessful) {
                            session.name = newValue
                            tvFullName.text        = newValue
                            tvDisplayName.text     = newValue
                            tvAvatarInitials.text  = buildInitials(newValue)
                            toast("Name updated.")
                        } else toast(parseError(r))
                    } catch (e: Exception) { toast("Connection failed: ${e.message}") }
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
                        val r = ApiClient.get(session.token)
                            .updateProfile(session.userId, UpdateProfileRequest(newValue, session.name ?: ""))
                        if (r.isSuccessful) {
                            session.username       = newValue
                            tvUsername.text        = newValue
                            tvDisplayUsername.text = "@$newValue"
                            toast("Username updated.")
                        } else toast(parseError(r))
                    } catch (e: Exception) { toast("Connection failed: ${e.message}") }
                }
            }
        }

        // Change Password — send OTP first, then open boxed OTP dialog
        findViewById<View>(R.id.rowChangePassword)?.setOnClickListener {
            val email = session.email ?: return@setOnClickListener
            lifecycleScope.launch {
                try {
                    val r = ApiClient.get().forgotPassword(ForgotPasswordRequest(email))
                    if (r.isSuccessful) showOtpDialog()
                    else toast(parseError(r))
                } catch (e: Exception) { toast("Connection failed: ${e.message}") }
            }
        }

        // Logout
        findViewById<View>(R.id.btnLogout)?.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Log Out")
                .setMessage("Are you sure you want to log out?")
                .setPositiveButton("Log Out") { _, _ ->
                    session.clearSession()
                    startActivity(
                        Intent(this, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                    finish()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }

    // ── OTP dialog (Change Password step 1) ───────────────────────────────────

    private fun showOtpDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_otp_verify, null, false)

        val digits = listOf(
            dialogView.findViewById<TextInputEditText>(R.id.otpDigit1),
            dialogView.findViewById(R.id.otpDigit2),
            dialogView.findViewById(R.id.otpDigit3),
            dialogView.findViewById(R.id.otpDigit4),
            dialogView.findViewById(R.id.otpDigit5),
            dialogView.findViewById(R.id.otpDigit6),
        )
        val tvAttempts = dialogView.findViewById<TextView>(R.id.tvOtpAttemptsLeft)
        val tvError    = dialogView.findViewById<TextView>(R.id.tvOtpError)
        val tvResend   = dialogView.findViewById<TextView>(R.id.tvOtpResend)
        val tvCooldown = dialogView.findViewById<TextView>(R.id.tvOtpResendCooldown)

        // Cache refs so timers can update them
        otpDigitsRef           = digits
        tvOtpAttemptsRef       = tvAttempts
        tvOtpErrorRef          = tvError
        tvOtpResendRef         = tvResend
        tvOtpResendCooldownRef = tvCooldown
        otpAttemptsLeft        = maxOtpAttempts
        updateOtpAttemptsLabel()

        wireOtpAutoAdvance(digits)
        startOtpExpiryTimer()
        startOtpResendCooldown()

        tvResend.setOnClickListener {
            if (!otpResendOnCooldown) resendOtpCode(digits, tvAttempts, tvError, tvResend, tvCooldown)
        }

        val dialog = AlertDialog.Builder(this)
            .setTitle("Verify Your Email")
            .setView(dialogView)
            .setPositiveButton("Verify", null)     // null → override below to prevent auto-dismiss
            .setNegativeButton("Cancel") { _, _ -> cancelOtpTimers() }
            .setOnCancelListener { cancelOtpTimers() }
            .create()

        otpDialogRef = dialog

        dialog.setOnShowListener {
            digits.first().requestFocus()

            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val code = digits.joinToString("") { it.text?.toString() ?: "" }
                if (code.length < 6) {
                    showOtpError(tvError, "Please enter all 6 digits.")
                    return@setOnClickListener
                }
                verifyOtpAndProceed(code, dialog, tvError, tvAttempts)
            }
        }

        dialog.show()
    }

    /** Auto-advance focus as the user types each digit; backspace goes back. */
    private fun wireOtpAutoAdvance(digits: List<TextInputEditText>) {
        digits.forEachIndexed { i, et ->
            et.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
                override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    if (!s.isNullOrEmpty() && i < digits.lastIndex) digits[i + 1].requestFocus()
                }
            })
            et.setOnKeyListener { _, keyCode, event ->
                if (keyCode == android.view.KeyEvent.KEYCODE_DEL
                    && event.action == android.view.KeyEvent.ACTION_DOWN
                    && et.text.isNullOrEmpty() && i > 0) {
                    digits[i - 1].apply { requestFocus(); setText("") }
                    true
                } else false
            }
        }
    }

    private fun verifyOtpAndProceed(
        code: String,
        dialog: AlertDialog,
        tvError: TextView,
        tvAttempts: TextView,
    ) {
        val email = session.email ?: return
        lifecycleScope.launch {
            try {
                val r = ApiClient.get().verifyResetCode(VerifyResetRequest(email, code))
                if (r.isSuccessful) {
                    cancelOtpTimers()
                    dialog.dismiss()
                    showNewPasswordDialog(code)
                } else {
                    otpAttemptsLeft--
                    if (otpAttemptsLeft <= 0) {
                        cancelOtpTimers()
                        showOtpError(tvError, "Maximum attempts exceeded. Request a new code.")
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = false
                        tvOtpResendRef?.apply { alpha = 1f; isEnabled = true }
                        tvOtpResendCooldownRef?.isVisible = false
                        otpResendOnCooldown = false
                    } else {
                        val msg = parseError(r)
                        showOtpError(tvError, "$msg · $otpAttemptsLeft attempt${if (otpAttemptsLeft == 1) "" else "s"} left.")
                        updateOtpAttemptsLabel()
                    }
                }
            } catch (e: Exception) {
                showOtpError(tvError, "Connection failed: ${e.message}")
            }
        }
    }

    private fun resendOtpCode(
        digits: List<TextInputEditText>,
        tvAttempts: TextView,
        tvError: TextView,
        tvResend: TextView,
        tvCooldown: TextView,
    ) {
        val email = session.email ?: return
        lifecycleScope.launch {
            try {
                val r = ApiClient.get().forgotPassword(ForgotPasswordRequest(email))
                if (r.isSuccessful) {
                    otpAttemptsLeft = maxOtpAttempts
                    digits.forEach { it.setText("") }
                    digits.first().requestFocus()
                    tvError.isVisible = false
                    updateOtpAttemptsLabel()
                    startOtpExpiryTimer()
                    startOtpResendCooldown()
                    // brief confirmation
                    tvError.text = "New code sent."
                    tvError.setTextColor(android.graphics.Color.parseColor("#388E3C"))
                    tvError.isVisible = true
                    tvError.postDelayed({ tvError.isVisible = false; tvError.setTextColor(android.graphics.Color.parseColor("#D32F2F")) }, 3000)
                } else {
                    showOtpError(tvError, parseError(r))
                }
            } catch (e: Exception) { showOtpError(tvError, "Connection failed: ${e.message}") }
        }
    }

    // ── OTP timers ────────────────────────────────────────────────────────────

    private fun startOtpExpiryTimer() {
        otpExpiryTimer?.cancel()
        otpExpiryTimer = object : CountDownTimer(codeTtlMs, 1000) {
            override fun onTick(ms: Long) {
                val m = ms / 60000; val s = (ms % 60000) / 1000
                updateOtpAttemptsLabel(String.format("Expires in %d:%02d", m, s))
            }
            override fun onFinish() {
                updateOtpAttemptsLabel("Code expired")
                tvOtpErrorRef?.let { showOtpError(it, "The code has expired. Please request a new one.") }
                otpDialogRef?.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = false
            }
        }.start()
    }

    private fun startOtpResendCooldown() {
        otpResendOnCooldown = true
        tvOtpResendRef?.alpha    = 0.4f
        tvOtpResendRef?.isEnabled = false
        tvOtpResendCooldownRef?.isVisible = true
        otpResendTimer?.cancel()
        otpResendTimer = object : CountDownTimer(resendCooldownMs, 1000) {
            override fun onTick(ms: Long) {
                val s = (ms / 1000).toInt()
                tvOtpResendCooldownRef?.text = " (0:${String.format("%02d", s)})"
            }
            override fun onFinish() {
                otpResendOnCooldown = false
                tvOtpResendRef?.alpha    = 1f
                tvOtpResendRef?.isEnabled = true
                tvOtpResendCooldownRef?.isVisible = false
            }
        }.start()
    }

    private fun cancelOtpTimers() {
        otpExpiryTimer?.cancel()
        otpResendTimer?.cancel()
    }

    private fun updateOtpAttemptsLabel(expiry: String = "Expires in 5:00") {
        tvOtpAttemptsRef?.text =
            "$otpAttemptsLeft attempt${if (otpAttemptsLeft == 1) "" else "s"} remaining · $expiry"
    }

    private fun showOtpError(tv: TextView, msg: String) {
        tv.text = msg
        tv.isVisible = true
    }

    // ── New Password dialog (Change Password step 2) ──────────────────────────

    private fun showNewPasswordDialog(code: String) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_new_password, null, false)

        val tilNew     = dialogView.findViewById<TextInputLayout>(R.id.tilNewPassword)
        val etNew      = dialogView.findViewById<TextInputEditText>(R.id.etNewPassword)
        val tilConfirm = dialogView.findViewById<TextInputLayout>(R.id.tilConfirmPassword)
        val etConfirm  = dialogView.findViewById<TextInputEditText>(R.id.etConfirmPassword)
        val tvConfirmError = dialogView.findViewById<TextView>(R.id.tvConfirmError)

        // Strength meter views
        val bars = listOf(
            dialogView.findViewById<View>(R.id.strengthBar1),
            dialogView.findViewById(R.id.strengthBar2),
            dialogView.findViewById(R.id.strengthBar3),
            dialogView.findViewById(R.id.strengthBar4),
        )
        val tvStrengthLabel = dialogView.findViewById<TextView>(R.id.tvPasswordStrengthLabel)
        val tvRuleLength    = dialogView.findViewById<TextView>(R.id.tvRuleLength)
        val tvRuleLetter    = dialogView.findViewById<TextView>(R.id.tvRuleLetter)
        val tvRuleDigit     = dialogView.findViewById<TextView>(R.id.tvRuleDigit)
        val tvRuleSymbol    = dialogView.findViewById<TextView>(R.id.tvRuleSymbol)

        // Wire live strength meter
        etNew.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                updatePasswordStrengthUI(
                    s?.toString() ?: "",
                    bars, tvStrengthLabel,
                    tvRuleLength, tvRuleLetter, tvRuleDigit, tvRuleSymbol
                )
                tilNew.error = null  // clear error while user is typing
            }
        })

        val dialog = AlertDialog.Builder(this)
            .setTitle("Set New Password")
            .setView(dialogView)
            .setPositiveButton("Save Password", null)
            .setNegativeButton("Cancel", null)
            .create()

        dialog.setOnShowListener {
            etNew.requestFocus()

            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val pw1 = etNew.text?.toString() ?: ""
                val pw2 = etConfirm.text?.toString() ?: ""

                // Run policy check
                val policyError = validatePassword(pw1)
                if (policyError != null) {
                    tilNew.error = policyError
                    return@setOnClickListener
                }
                tilNew.error = null

                if (pw1 != pw2) {
                    tvConfirmError.text = "Passwords do not match."
                    tvConfirmError.isVisible = true
                    return@setOnClickListener
                }
                tvConfirmError.isVisible = false

                dialog.dismiss()
                doResetPassword(code, pw1)
            }
        }

        dialog.show()
    }

    private fun doResetPassword(code: String, newPassword: String) {
        val email = session.email ?: return
        lifecycleScope.launch {
            try {
                val r = ApiClient.get().resetPassword(ResetPasswordRequest(email, newPassword))
                if (r.isSuccessful) toast("Password changed successfully.")
                else toast(parseError(r))
            } catch (e: Exception) { toast("Connection failed: ${e.message}") }
        }
    }

    // ── Password policy helpers ───────────────────────────────────────────────

    /**
     * Returns null on success, or the first failing rule message.
     * Identical policy to AuthDialogFragment.
     */
    private fun validatePassword(password: String): String? = when {
        password.length < 8                       -> "Password must be at least 8 characters."
        !password.any { it.isLetter() }           -> "Password must contain at least one letter."
        !password.any { it.isDigit() }            -> "Password must contain at least one number."
        !symbolRegex.containsMatchIn(password)    -> "Password must contain at least one symbol (e.g. !@#\$%^&*)."
        else                                      -> null
    }

    private data class PasswordRules(
        val hasLength: Boolean, val hasLetter: Boolean,
        val hasDigit:  Boolean, val hasSymbol: Boolean,
    ) { val score get() = listOf(hasLength, hasLetter, hasDigit, hasSymbol).count { it } }

    private fun evaluatePassword(pw: String) = PasswordRules(
        hasLength = pw.length >= 8,
        hasLetter = pw.any { it.isLetter() },
        hasDigit  = pw.any { it.isDigit() },
        hasSymbol = symbolRegex.containsMatchIn(pw),
    )

    private fun updatePasswordStrengthUI(
        password: String,
        bars: List<View>,
        tvLabel: TextView,
        tvRuleLength: TextView,
        tvRuleLetter: TextView,
        tvRuleDigit:  TextView,
        tvRuleSymbol: TextView,
    ) {
        val rules = evaluatePassword(password)

        val colorGrey  = android.graphics.Color.parseColor("#E0E0E0")
        val colorRed   = android.graphics.Color.parseColor("#D32F2F")
        val colorAmber = android.graphics.Color.parseColor("#F9A825")
        val colorBlue  = android.graphics.Color.parseColor("#4A90E2")
        val colorGreen = android.graphics.Color.parseColor("#388E3C")

        val (activeColor, label) = when (rules.score) {
            0    -> colorGrey  to ""
            1    -> colorRed   to "Weak"
            2    -> colorAmber to "Fair"
            3    -> colorBlue  to "Good"
            else -> colorGreen to "Strong"
        }

        bars.forEachIndexed { i, bar ->
            bar.setBackgroundColor(if (i < rules.score) activeColor else colorGrey)
        }
        tvLabel.text = label
        tvLabel.setTextColor(activeColor)

        fun TextView.applyRule(met: Boolean) {
            val icon  = if (met) "✓" else "✗"
            val color = if (met) colorGreen else android.graphics.Color.parseColor("#9E9E9E")
            setTextColor(color)
            val body  = text.toString().trimStart('✓', '✗', ' ', ' ')
            text = "$icon  $body"
        }

        tvRuleLength.applyRule(rules.hasLength)
        tvRuleLetter.applyRule(rules.hasLetter)
        tvRuleDigit.applyRule(rules.hasDigit)
        tvRuleSymbol.applyRule(rules.hasSymbol)
    }

    // ── Generic inline-edit dialog ────────────────────────────────────────────

    private fun showEditDialog(
        title: String,
        hint: String,
        subtitle: String = "",
        currentValue: String,
        inputType: Int,
        maxLength: Int,
        onConfirm: (String) -> Unit,
    ) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_edit_field, null, false)
        val til   = dialogView.findViewById<TextInputLayout>(R.id.tilDialogField)
        val et    = dialogView.findViewById<TextInputEditText>(R.id.etDialogField)
        val tvSub = dialogView.findViewById<TextView>(R.id.tvDialogSubtitle)

        til.hint             = hint
        til.counterMaxLength = maxLength
        et.inputType         = inputType
        et.filters           = arrayOf(InputFilter.LengthFilter(maxLength))
        et.setText(currentValue)
        et.setSelection(currentValue.length)

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
                    til.error = "$hint cannot be empty"; return@setOnClickListener
                }
                if (inputType == InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) {
                    if (!Regex("^[a-zA-Z0-9_]+$").matches(newValue)) {
                        til.error = "Only letters, numbers, and underscores allowed"; return@setOnClickListener
                    }
                }
                til.error = null
                dialog.dismiss()
                onConfirm(newValue)
            }
        }

        dialog.show()
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun parseError(response: retrofit2.Response<*>): String {
        return try {
            val body = response.errorBody()?.string() ?: ""
            com.google.gson.JsonParser.parseString(body).asJsonObject
                .get("message")?.asString ?: "Something went wrong"
        } catch (e: Exception) { "Something went wrong" }
    }

    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        if (drawer.isDrawerOpen(GravityCompat.START)) drawer.closeDrawer(GravityCompat.START)
        else {
            @Suppress("DEPRECATION") super.onBackPressed()
        }
    }
}