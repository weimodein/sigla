package com.example.sigla

import android.app.Dialog
import android.os.Bundle
import android.os.CountDownTimer
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.TextView
import androidx.core.view.isVisible
import androidx.fragment.app.DialogFragment
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch

/**
 * AuthDialogFragment
 *
 * Full-screen dialog that manages all auth flows:
 *   Sign In → (success) → dismiss
 *   Sign Up → Verify Email → Set Password → Success → Sign In screen
 *   Forgot Password → Verify Email → Reset Password → Success → Sign In screen
 *
 * Show it from any Activity or Fragment:
 *   AuthDialogFragment().show(supportFragmentManager, "auth")
 *
 * Listen for successful sign-in by setting a callback:
 *   val f = AuthDialogFragment()
 *   f.onSignedIn = { -> /* update UI */ }
 *   f.show(supportFragmentManager, "auth")
 */
class AuthDialogFragment : DialogFragment() {

    // ── Callback ──────────────────────────────────────────────────────────────
    var onSignedIn: (() -> Unit)? = null

    // ── State ─────────────────────────────────────────────────────────────────
    private enum class Screen { SIGN_IN, SIGN_UP, VERIFY, SET_PASSWORD, FORGOT_PASSWORD, SUCCESS }
    private var currentScreen = Screen.SIGN_IN

    /** Tracks whether the verify screen was reached from SIGN_UP or FORGOT_PASSWORD */
    private var verifySource: Screen = Screen.SIGN_UP

    /** The email collected during sign-up or forgot-password flows */
    private var pendingEmail = ""
    private var pendingUsername = ""

    // Verification rules (per scope doc)
    private val maxAttempts = 5
    private val codeTtlMs = 5 * 60 * 1000L        // 5 minutes
    private val resendCooldownMs = 60 * 1000L      // 1 minute
    private var attemptsLeft = maxAttempts
    private var expiryTimer: CountDownTimer? = null
    private var resendTimer: CountDownTimer? = null
    private var resendOnCooldown = false

    // Session manager
    private lateinit var session: SessionManager

    // ── Password policy ───────────────────────────────────────────────────────
    /**
     * Symbols accepted in passwords. Using a safe, well-known set that covers
     * keyboard-reachable special characters.
     */
    private val symbolRegex = Regex("""[!@#$%^&*()_\-+=\[\]{};:'",.<>?/\\|`~]""")

    // ── Views (lateinit, bound in onCreateView) ───────────────────────────────
    private lateinit var screens: Map<Screen, View>

    // Sign In
    private lateinit var etSignInEmail: TextInputEditText
    private lateinit var etSignInPassword: TextInputEditText
    private lateinit var tvSignInError: TextView
    private lateinit var btnSignIn: MaterialButton
    private lateinit var tvForgotPassword: TextView
    private lateinit var tvGoToSignUp: TextView

    // Sign Up
    private lateinit var etSignUpUsername: TextInputEditText
    private lateinit var etSignUpEmail: TextInputEditText
    private lateinit var tvSignUpError: TextView
    private lateinit var btnSendCode: MaterialButton
    private lateinit var tvGoToSignIn: TextView

    // Verify
    private lateinit var tvVerifyTitle: TextView
    private lateinit var tvVerifySubtitle: TextView
    private lateinit var otpDigits: List<TextInputEditText>
    private lateinit var tvAttemptsLeft: TextView
    private lateinit var tvVerifyError: TextView
    private lateinit var btnVerifyCode: MaterialButton
    private lateinit var tvResendCode: TextView
    private lateinit var tvResendCooldown: TextView
    private lateinit var tvVerifyBack: TextView

    // Set Password
    private lateinit var tvSetPasswordTitle: TextView
    private lateinit var tvSetPasswordSubtitle: TextView
    private lateinit var etNewPassword: TextInputEditText
    private lateinit var etConfirmPassword: TextInputEditText
    private lateinit var tvSetPasswordError: TextView
    private lateinit var btnSavePassword: MaterialButton

    // Password strength indicator views (in screenSetPassword)
    private lateinit var tvPasswordStrengthLabel: TextView
    private lateinit var strengthBar1: View
    private lateinit var strengthBar2: View
    private lateinit var strengthBar3: View
    private lateinit var strengthBar4: View
    private lateinit var tvRuleLength: TextView
    private lateinit var tvRuleLetter: TextView
    private lateinit var tvRuleDigit: TextView
    private lateinit var tvRuleSymbol: TextView

    // Forgot Password
    private lateinit var etForgotEmail: TextInputEditText
    private lateinit var tvForgotError: TextView
    private lateinit var btnForgotSendCode: MaterialButton
    private lateinit var tvForgotBack: TextView

    // Success
    private lateinit var tvSuccessTitle: TextView
    private lateinit var tvSuccessSubtitle: TextView
    private lateinit var btnSuccessGoSignIn: MaterialButton

    // Close
    private lateinit var btnCloseAuth: View

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val dialog = super.onCreateDialog(savedInstanceState)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        return dialog
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.apply {
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundDrawableResource(android.R.color.transparent)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        return inflater.inflate(R.layout.dialog_auth, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        session = SessionManager.getInstance(requireContext())
        bindViews(view)
        wireListeners()
        showScreen(Screen.SIGN_IN)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        expiryTimer?.cancel()
        resendTimer?.cancel()
    }

    // ── View Binding ──────────────────────────────────────────────────────────
    private fun bindViews(v: View) {
        btnCloseAuth = v.findViewById(R.id.btnCloseAuth)

        // Screen containers
        screens = mapOf(
            Screen.SIGN_IN         to v.findViewById(R.id.screenSignIn),
            Screen.SIGN_UP         to v.findViewById(R.id.screenSignUp),
            Screen.VERIFY          to v.findViewById(R.id.screenVerify),
            Screen.SET_PASSWORD    to v.findViewById(R.id.screenSetPassword),
            Screen.FORGOT_PASSWORD to v.findViewById(R.id.screenForgotPassword),
            Screen.SUCCESS         to v.findViewById(R.id.screenSuccess),
        )

        // Sign In
        etSignInEmail    = v.findViewById(R.id.etSignInEmail)
        etSignInPassword = v.findViewById(R.id.etSignInPassword)
        tvSignInError    = v.findViewById(R.id.tvSignInError)
        btnSignIn        = v.findViewById(R.id.btnSignIn)
        tvForgotPassword = v.findViewById(R.id.tvForgotPassword)
        tvGoToSignUp     = v.findViewById(R.id.tvGoToSignUp)

        // Sign Up
        etSignUpUsername = v.findViewById(R.id.etSignUpUsername)
        etSignUpEmail    = v.findViewById(R.id.etSignUpEmail)
        tvSignUpError    = v.findViewById(R.id.tvSignUpError)
        btnSendCode      = v.findViewById(R.id.btnSendCode)
        tvGoToSignIn     = v.findViewById(R.id.tvGoToSignIn)

        // Verify
        tvVerifyTitle    = v.findViewById(R.id.tvVerifyTitle)
        tvVerifySubtitle = v.findViewById(R.id.tvVerifySubtitle)
        otpDigits        = listOf(
            v.findViewById(R.id.otpDigit1), v.findViewById(R.id.otpDigit2),
            v.findViewById(R.id.otpDigit3), v.findViewById(R.id.otpDigit4),
            v.findViewById(R.id.otpDigit5), v.findViewById(R.id.otpDigit6),
        )
        tvAttemptsLeft   = v.findViewById(R.id.tvAttemptsLeft)
        tvVerifyError    = v.findViewById(R.id.tvVerifyError)
        btnVerifyCode    = v.findViewById(R.id.btnVerifyCode)
        tvResendCode     = v.findViewById(R.id.tvResendCode)
        tvResendCooldown = v.findViewById(R.id.tvResendCooldown)
        tvVerifyBack     = v.findViewById(R.id.tvVerifyBack)

        // Set Password
        tvSetPasswordTitle    = v.findViewById(R.id.tvSetPasswordTitle)
        tvSetPasswordSubtitle = v.findViewById(R.id.tvSetPasswordSubtitle)
        etNewPassword         = v.findViewById(R.id.etNewPassword)
        etConfirmPassword     = v.findViewById(R.id.etConfirmPassword)
        tvSetPasswordError    = v.findViewById(R.id.tvSetPasswordError)
        btnSavePassword       = v.findViewById(R.id.btnSavePassword)

        // Password strength UI
        tvPasswordStrengthLabel = v.findViewById(R.id.tvPasswordStrengthLabel)
        strengthBar1            = v.findViewById(R.id.strengthBar1)
        strengthBar2            = v.findViewById(R.id.strengthBar2)
        strengthBar3            = v.findViewById(R.id.strengthBar3)
        strengthBar4            = v.findViewById(R.id.strengthBar4)
        tvRuleLength            = v.findViewById(R.id.tvRuleLength)
        tvRuleLetter            = v.findViewById(R.id.tvRuleLetter)
        tvRuleDigit             = v.findViewById(R.id.tvRuleDigit)
        tvRuleSymbol            = v.findViewById(R.id.tvRuleSymbol)

        // Forgot Password
        etForgotEmail     = v.findViewById(R.id.etForgotEmail)
        tvForgotError     = v.findViewById(R.id.tvForgotError)
        btnForgotSendCode = v.findViewById(R.id.btnForgotSendCode)
        tvForgotBack      = v.findViewById(R.id.tvForgotBack)

        // Success
        tvSuccessTitle      = v.findViewById(R.id.tvSuccessTitle)
        tvSuccessSubtitle   = v.findViewById(R.id.tvSuccessSubtitle)
        btnSuccessGoSignIn  = v.findViewById(R.id.btnSuccessGoSignIn)
    }

    // ── Click listeners ───────────────────────────────────────────────────────
    private fun wireListeners() {
        btnCloseAuth.setOnClickListener { dismiss() }

        // ── Sign In screen
        btnSignIn.setOnClickListener { attemptSignIn() }
        tvForgotPassword.setOnClickListener { showScreen(Screen.FORGOT_PASSWORD) }
        tvGoToSignUp.setOnClickListener { showScreen(Screen.SIGN_UP) }

        // ── Sign Up screen
        btnSendCode.setOnClickListener { attemptSendSignUpCode() }
        tvGoToSignIn.setOnClickListener { showScreen(Screen.SIGN_IN) }

        // ── Verify screen
        wireOtpAutoAdvance()
        btnVerifyCode.setOnClickListener { attemptVerify() }
        tvResendCode.setOnClickListener { if (!resendOnCooldown) resendCode() }
        tvVerifyBack.setOnClickListener {
            when (verifySource) {
                Screen.SIGN_UP         -> showScreen(Screen.SIGN_UP)
                Screen.FORGOT_PASSWORD -> showScreen(Screen.FORGOT_PASSWORD)
                else                   -> showScreen(Screen.SIGN_IN)
            }
        }

        // ── Set Password screen — live strength meter
        etNewPassword.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                updatePasswordStrengthUI(s?.toString() ?: "")
            }
        })
        btnSavePassword.setOnClickListener { attemptSavePassword() }

        // ── Forgot Password screen
        btnForgotSendCode.setOnClickListener { attemptSendForgotCode() }
        tvForgotBack.setOnClickListener { showScreen(Screen.SIGN_IN) }

        // ── Success screen
        btnSuccessGoSignIn.setOnClickListener { showScreen(Screen.SIGN_IN) }
    }

    // ── Screen switching ──────────────────────────────────────────────────────
    private fun showScreen(screen: Screen) {
        currentScreen = screen
        screens.forEach { (s, v) -> v.isVisible = (s == screen) }

        // Reset password fields and strength meter whenever Set Password is shown
        if (screen == Screen.SET_PASSWORD) {
            etNewPassword.setText("")
            etConfirmPassword.setText("")
            hideError(tvSetPasswordError)
            updatePasswordStrengthUI("")
        }
    }

    // ── Auto-advance OTP digits ───────────────────────────────────────────────
    private fun wireOtpAutoAdvance() {
        otpDigits.forEachIndexed { index, et ->
            et.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    if (!s.isNullOrEmpty()) {
                        if (index < otpDigits.lastIndex) otpDigits[index + 1].requestFocus()
                        else btnVerifyCode.requestFocus()
                    }
                }
            })
            et.setOnKeyListener { _, keyCode, event ->
                if (keyCode == android.view.KeyEvent.KEYCODE_DEL
                    && event.action == android.view.KeyEvent.ACTION_DOWN
                    && et.text.isNullOrEmpty()
                    && index > 0) {
                    otpDigits[index - 1].apply { requestFocus(); setText("") }
                    true
                } else false
            }
        }
    }

    // ── Sign In ───────────────────────────────────────────────────────────────
    private fun attemptSignIn() {
        val email = etSignInEmail.text?.toString()?.trim() ?: ""
        val password = etSignInPassword.text?.toString() ?: ""

        if (email.isBlank() || !android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            showSignInError("Please enter a valid email address.")
            return
        }
        if (password.isBlank()) {
            showSignInError("Please enter your password.")
            return
        }

        clearSignInError()
        setLoading(btnSignIn, true, "Signing in...")

        lifecycleScope.launch {
            try {
                val response = ApiClient.get().login(LoginRequest(email, password))
                if (response.isSuccessful && response.body()?.token != null) {
                    val body = response.body()!!
                    val user = body.user!!
                    session.saveUser(user.id, user.username, user.email, user.name ?: user.username, body.token!!)
                    onSignedIn?.invoke()
                    dismiss()
                } else {
                    val errorMsg = parseError(response)
                    showSignInError(errorMsg)
                }
            } catch (e: Exception) {
                showSignInError("Connection failed: ${e.message}")
            } finally {
                setLoading(btnSignIn, false, "Sign In")
            }
        }
    }

    // ── Send Code (Sign Up) ───────────────────────────────────────────────────
    private fun attemptSendSignUpCode() {
        val username = etSignUpUsername.text?.toString()?.trim() ?: ""
        val email = etSignUpEmail.text?.toString()?.trim() ?: ""

        if (username.isBlank()) {
            showError(tvSignUpError, "Username cannot be blank.")
            return
        }
        if (username.length < 3) {
            showError(tvSignUpError, "Username must be at least 3 characters.")
            return
        }
        if (username.length > 20) {
            showError(tvSignUpError, "Username must be 20 characters or fewer.")
            return
        }
        if (!username.matches(Regex("^[a-zA-Z0-9_]+$"))) {
            showError(tvSignUpError, "Username can only contain letters, numbers, and underscores.")
            return
        }
        if (email.isBlank()) {
            showError(tvSignUpError, "Email cannot be blank.")
            return
        }
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            showError(tvSignUpError, "Please enter a valid email address.")
            return
        }

        pendingUsername = username
        pendingEmail = email
        verifySource = Screen.SIGN_UP
        hideError(tvSignUpError)
        setLoading(btnSendCode, true, "Sending...")

        lifecycleScope.launch {
            try {
                val response = ApiClient.get().register(RegisterRequest(username, email))
                if (response.isSuccessful) {
                    sendCodeAndEnterVerifyScreen(
                        title = "Verify your email",
                        subtitle = "We sent a 6-digit code to\n${maskEmail(email)}"
                    )
                } else {
                    val errorMsg = parseError(response)
                    showError(tvSignUpError, errorMsg)
                    setLoading(btnSendCode, false, "Send Verification Code")
                }
            } catch (e: Exception) {
                showError(tvSignUpError, "Connection failed: ${e.message}")
                setLoading(btnSendCode, false, "Send Verification Code")
            }
        }
    }

    // ── Send Code (Forgot Password) ───────────────────────────────────────────
    private fun attemptSendForgotCode() {
        val email = etForgotEmail.text?.toString()?.trim() ?: ""

        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            showError(tvForgotError, "Please enter a valid email address.")
            return
        }

        pendingEmail = email
        verifySource = Screen.FORGOT_PASSWORD
        hideError(tvForgotError)
        setLoading(btnForgotSendCode, true, "Sending...")

        lifecycleScope.launch {
            try {
                val response = ApiClient.get().forgotPassword(ForgotPasswordRequest(email))
                if (response.isSuccessful) {
                    sendCodeAndEnterVerifyScreen(
                        title = "Reset password",
                        subtitle = "We sent a 6-digit code to\n${maskEmail(email)}"
                    )
                } else {
                    val errorMsg = parseError(response)
                    showError(tvForgotError, errorMsg)
                    setLoading(btnForgotSendCode, false, "Send Verification Code")
                }
            } catch (e: Exception) {
                showError(tvForgotError, "Connection failed: ${e.message}")
                setLoading(btnForgotSendCode, false, "Send Verification Code")
            }
        }
    }

    // ── Enter Verify Screen ───────────────────────────────────────────────────
    private fun sendCodeAndEnterVerifyScreen(title: String, subtitle: String) {
        attemptsLeft = maxAttempts
        otpDigits.forEach { it.setText("") }
        otpDigits.first().requestFocus()
        hideError(tvVerifyError)
        resendOnCooldown = false
        tvResendCooldown.isVisible = false
        tvResendCode.alpha = 1f
        tvResendCode.isEnabled = true

        tvVerifyTitle.text = title
        tvVerifySubtitle.text = subtitle
        updateAttemptsLabel()

        startExpiryTimer()
        startResendCooldown()
        showScreen(Screen.VERIFY)

        // Reset button states
        setLoading(btnSendCode, false, "Send Verification Code")
        setLoading(btnForgotSendCode, false, "Send Verification Code")
    }

    // ── Verify Code ───────────────────────────────────────────────────────────
    private fun attemptVerify() {
        val code = otpDigits.joinToString("") { it.text?.toString() ?: "" }
        if (code.length < 6) {
            showError(tvVerifyError, "Please enter all 6 digits.")
            return
        }

        setLoading(btnVerifyCode, true, "Verifying...")

        lifecycleScope.launch {
            try {
                val response = if (verifySource == Screen.SIGN_UP) {
                    ApiClient.get().verifyEmail(VerifyEmailRequest(pendingEmail, code))
                } else {
                    ApiClient.get().verifyResetCode(VerifyResetRequest(pendingEmail, code))
                }

                if (response.isSuccessful) {
                    proceedAfterVerify()
                } else {
                    val errorMsg = parseError(response)
                    handleWrongCode(errorMsg)
                }
            } catch (e: Exception) {
                showError(tvVerifyError, "Connection failed: ${e.message}")
                setLoading(btnVerifyCode, false, "Verify")
            }
        }
    }

    private fun proceedAfterVerify() {
        expiryTimer?.cancel()
        setLoading(btnVerifyCode, false, "Verify")

        when (verifySource) {
            Screen.SIGN_UP -> {
                tvSetPasswordTitle.text = "Set your password"
                tvSetPasswordSubtitle.text = "Choose a strong password for your account"
                showScreen(Screen.SET_PASSWORD)
            }
            Screen.FORGOT_PASSWORD -> {
                tvSetPasswordTitle.text = "New password"
                tvSetPasswordSubtitle.text = "Enter a new password for ${pendingEmail}"
                showScreen(Screen.SET_PASSWORD)
            }
            else -> showScreen(Screen.SIGN_IN)
        }
    }

    private fun handleWrongCode(errorMsg: String) {
        attemptsLeft--
        setLoading(btnVerifyCode, false, "Verify")

        if (attemptsLeft <= 0) {
            expiryTimer?.cancel()
            showError(tvVerifyError, "Maximum attempts exceeded. Please request a new code.")
            btnVerifyCode.isEnabled = false
            tvResendCode.isEnabled = true
            tvResendCode.alpha = 1f
            resendOnCooldown = false
            tvResendCooldown.isVisible = false
        } else {
            showError(tvVerifyError, "$errorMsg $attemptsLeft attempt${if (attemptsLeft == 1) "" else "s"} remaining.")
            updateAttemptsLabel()
        }
    }

    // ── Resend Code ───────────────────────────────────────────────────────────
    private fun resendCode() {
        setLoading(null, true, null)

        lifecycleScope.launch {
            try {
                val type = if (verifySource == Screen.SIGN_UP) "registration" else "password_reset"
                val response = ApiClient.get().resendCode(ResendCodeRequest(pendingEmail, type))

                if (response.isSuccessful) {
                    attemptsLeft = maxAttempts
                    otpDigits.forEach { it.setText("") }
                    otpDigits.first().requestFocus()
                    hideError(tvVerifyError)
                    updateAttemptsLabel()
                    startExpiryTimer()
                    startResendCooldown()
                    showInfo(tvVerifyError, "New code sent to ${pendingEmail}", isError = false)
                } else {
                    val errorMsg = parseError(response)
                    showError(tvVerifyError, errorMsg)
                }
            } catch (e: Exception) {
                showError(tvVerifyError, "Connection failed: ${e.message}")
            } finally {
                setLoading(null, false, null)
            }
        }
    }

    // ── Set Password ──────────────────────────────────────────────────────────

    /**
     * Validates the password against the security policy:
     *   • At least 8 characters
     *   • At least one letter (upper or lower)
     *   • At least one digit
     *   • At least one special/symbol character
     *
     * Returns null on success or an error string to display.
     */
    private fun validatePassword(password: String): String? {
        if (password.length < 8)
            return "Password must be at least 8 characters."
        if (!password.any { it.isLetter() })
            return "Password must contain at least one letter."
        if (!password.any { it.isDigit() })
            return "Password must contain at least one number."
        if (!symbolRegex.containsMatchIn(password))
            return "Password must contain at least one symbol (e.g. !@#\$%^&*)."
        return null
    }

    private fun attemptSavePassword() {
        val pw1 = etNewPassword.text?.toString() ?: ""
        val pw2 = etConfirmPassword.text?.toString() ?: ""

        // Run policy validation first
        val policyError = validatePassword(pw1)
        if (policyError != null) {
            showError(tvSetPasswordError, policyError)
            return
        }

        if (pw1 != pw2) {
            showError(tvSetPasswordError, "Passwords do not match.")
            return
        }

        hideError(tvSetPasswordError)
        setLoading(btnSavePassword, true, "Saving...")

        lifecycleScope.launch {
            try {
                val response = if (verifySource == Screen.SIGN_UP) {
                    ApiClient.get().setPassword(SetPasswordRequest(pendingUsername, pendingEmail, pw1))
                } else {
                    ApiClient.get().resetPassword(ResetPasswordRequest(pendingEmail, pw1))
                }

                if (response.isSuccessful) {
                    val body = response.body()
                    // If the response includes a token (auto-login after set password)
                    if (body?.token != null && body.user != null) {
                        val user = body.user!!
                        session.saveUser(user.id, user.username, user.email, user.name ?: user.username, body.token)
                        onSignedIn?.invoke()
                        dismiss()
                    } else {
                        showSuccessScreen()
                    }
                } else {
                    val errorMsg = parseError(response)
                    showError(tvSetPasswordError, errorMsg)
                }
            } catch (e: Exception) {
                showError(tvSetPasswordError, "Connection failed: ${e.message}")
            } finally {
                setLoading(btnSavePassword, false, "Save")
            }
        }
    }

    private fun showSuccessScreen() {
        when (verifySource) {
            Screen.SIGN_UP -> {
                tvSuccessTitle.text = "Account created!"
                tvSuccessSubtitle.text = "You can now sign in with your email and password."
            }
            Screen.FORGOT_PASSWORD -> {
                tvSuccessTitle.text = "Password updated!"
                tvSuccessSubtitle.text = "You can now sign in with your new password."
            }
            else -> {}
        }
        showScreen(Screen.SUCCESS)
    }

    // ── Password strength meter ───────────────────────────────────────────────

    private data class PasswordRules(
        val hasLength: Boolean,
        val hasLetter: Boolean,
        val hasDigit: Boolean,
        val hasSymbol: Boolean,
    ) {
        val score: Int get() = listOf(hasLength, hasLetter, hasDigit, hasSymbol).count { it }
    }

    private fun evaluatePassword(password: String) = PasswordRules(
        hasLength = password.length >= 8,
        hasLetter = password.any { it.isLetter() },
        hasDigit  = password.any { it.isDigit() },
        hasSymbol = symbolRegex.containsMatchIn(password),
    )

    /**
     * Updates the four strength bars and checklist rule labels in real time.
     * Colors:
     *   0 rules met  → all bars grey
     *   1 rule       → 1 bar red   (Weak)
     *   2 rules      → 2 bars amber (Fair)
     *   3 rules      → 3 bars blue  (Good)
     *   4 rules      → 4 bars green (Strong)
     */
    private fun updatePasswordStrengthUI(password: String) {
        val rules = evaluatePassword(password)
        val bars = listOf(strengthBar1, strengthBar2, strengthBar3, strengthBar4)

        // Color constants (match your theme)
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

        tvPasswordStrengthLabel.text = label
        tvPasswordStrengthLabel.setTextColor(activeColor)

        // Checklist rules
        fun TextView.applyRule(met: Boolean) {
            val checkMark = if (met) "✓" else "✗"
            val color = if (met) colorGreen else android.graphics.Color.parseColor("#9E9E9E")
            setTextColor(color)
            // Prepend or replace the icon prefix
            val current = text.toString().trimStart('✓', '✗', ' ')
            text = "$checkMark $current"
        }

        tvRuleLength.applyRule(rules.hasLength)
        tvRuleLetter.applyRule(rules.hasLetter)
        tvRuleDigit.applyRule(rules.hasDigit)
        tvRuleSymbol.applyRule(rules.hasSymbol)
    }

    // ── Timers ────────────────────────────────────────────────────────────────
    private fun startExpiryTimer() {
        expiryTimer?.cancel()
        expiryTimer = object : CountDownTimer(codeTtlMs, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val minutes = millisUntilFinished / 60000
                val seconds = (millisUntilFinished % 60000) / 1000
                updateAttemptsLabel(String.format("Expires in %d:%02d", minutes, seconds))
            }
            override fun onFinish() {
                updateAttemptsLabel("Code expired")
                showError(tvVerifyError, "The verification code has expired. Please request a new one.")
                btnVerifyCode.isEnabled = false
            }
        }.start()
    }

    private fun startResendCooldown() {
        resendOnCooldown = true
        tvResendCode.alpha = 0.4f
        tvResendCode.isEnabled = false
        tvResendCooldown.isVisible = true
        resendTimer?.cancel()
        resendTimer = object : CountDownTimer(resendCooldownMs, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val s = (millisUntilFinished / 1000).toInt()
                tvResendCooldown.text = " (0:${String.format("%02d", s)})"
            }
            override fun onFinish() {
                resendOnCooldown = false
                tvResendCode.alpha = 1f
                tvResendCode.isEnabled = true
                tvResendCooldown.isVisible = false
            }
        }.start()
    }

    // ── UI Helpers ────────────────────────────────────────────────────────────
    private fun updateAttemptsLabel(expiry: String = "Expires in 5:00") {
        tvAttemptsLeft.text = "$attemptsLeft attempt${if (attemptsLeft == 1) "" else "s"} remaining · $expiry"
    }

    private fun setLoading(button: MaterialButton?, loading: Boolean, text: String?) {
        button?.apply {
            isEnabled = !loading
            text?.let { setText(it) }
        }
    }

    private fun showSignInError(msg: String) {
        tvSignInError.text = msg
        tvSignInError.isVisible = true
    }

    private fun clearSignInError() {
        tvSignInError.text = ""
        tvSignInError.isVisible = false
    }

    private fun showError(tv: TextView, msg: String) {
        tv.text = msg
        tv.isVisible = true
    }

    private fun showInfo(tv: TextView, msg: String, isError: Boolean = false) {
        tv.text = msg
        tv.isVisible = true
        if (!isError) {
            tv.postDelayed({ tv.isVisible = false }, 3000)
        }
    }

    private fun hideError(tv: TextView) {
        tv.text = ""
        tv.isVisible = false
    }

    private fun maskEmail(email: String): String {
        val parts = email.split("@")
        if (parts.size != 2) return email
        val local = parts[0].take(2) + "**"
        val domain = parts[1].let {
            val dot = it.lastIndexOf('.')
            if (dot > 0) it.take(2) + "*".repeat(dot - 2) + it.substring(dot)
            else it.take(2) + "***"
        }
        return "$local@$domain"
    }

    private fun parseError(response: retrofit2.Response<*>): String {
        return try {
            val errorBody = response.errorBody()?.string() ?: ""
            val json = com.google.gson.JsonParser.parseString(errorBody).asJsonObject
            json.get("message")?.asString ?: "Something went wrong"
        } catch (e: Exception) {
            "Something went wrong"
        }
    }
}