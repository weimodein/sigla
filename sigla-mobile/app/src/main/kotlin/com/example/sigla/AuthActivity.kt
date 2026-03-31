package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import android.widget.ProgressBar
import android.widget.TextView
import kotlinx.coroutines.launch

class AuthActivity : AppCompatActivity() {

    private lateinit var session: SessionManager

    // Layouts
    private lateinit var layoutSignIn: View
    private lateinit var layoutRegister: View
    private lateinit var layoutVerify: View
    private lateinit var layoutSetPassword: View

    // Common
    private lateinit var tvTitle: TextView
    private lateinit var tvError: TextView
    private lateinit var tvInfo: TextView
    private lateinit var progress: ProgressBar

    // Sign In fields
    private lateinit var etSignInEmail: TextInputEditText
    private lateinit var etSignInPassword: TextInputEditText

    // Register fields
    private lateinit var etRegUsername: TextInputEditText
    private lateinit var etRegEmail: TextInputEditText

    // Verify fields
    private lateinit var etVerifyCode: TextInputEditText
    private lateinit var tvVerifySubtitle: TextView

    // Set Password fields
    private lateinit var etNewPassword: TextInputEditText
    private lateinit var etConfirmPassword: TextInputEditText

    // State
    private var pendingEmail = ""
    private var pendingUsername = ""
    private var flowType = "registration" // "registration" or "reset"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_auth)

        session = SessionManager.getInstance(this)

        bindViews()
        setupListeners()
    }

    private fun bindViews() {
        layoutSignIn     = findViewById(R.id.layoutSignIn)
        layoutRegister   = findViewById(R.id.layoutRegister)
        layoutVerify     = findViewById(R.id.layoutVerify)
        layoutSetPassword = findViewById(R.id.layoutSetPassword)

        tvTitle   = findViewById(R.id.tvAuthTitle)
        tvError   = findViewById(R.id.tvAuthError)
        tvInfo    = findViewById(R.id.tvAuthInfo)
        progress  = findViewById(R.id.progressAuth)

        etSignInEmail    = findViewById(R.id.etSignInEmail)
        etSignInPassword = findViewById(R.id.etSignInPassword)

        etRegUsername = findViewById(R.id.etRegUsername)
        etRegEmail   = findViewById(R.id.etRegEmail)

        etVerifyCode    = findViewById(R.id.etVerifyCode)
        tvVerifySubtitle = findViewById(R.id.tvVerifySubtitle)

        etNewPassword    = findViewById(R.id.etNewPassword)
        etConfirmPassword = findViewById(R.id.etConfirmPassword)
    }

    private fun setupListeners() {
        // Sign In
        findViewById<MaterialButton>(R.id.btnSignIn).setOnClickListener { doSignIn() }
        findViewById<MaterialButton>(R.id.btnGoRegister).setOnClickListener { showScreen("register") }
        findViewById<MaterialButton>(R.id.btnContinueGuest).setOnClickListener {
            startActivity(Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
            finish()
        }
        findViewById<TextView>(R.id.tvForgotPassword).setOnClickListener { showScreen("register_forgot") }

        // Register
        findViewById<MaterialButton>(R.id.btnSendCode).setOnClickListener { doSendCode() }
        findViewById<MaterialButton>(R.id.btnGoSignIn).setOnClickListener { showScreen("signin") }

        // Verify
        findViewById<MaterialButton>(R.id.btnVerifyCode).setOnClickListener { doVerifyCode() }
        findViewById<MaterialButton>(R.id.btnResendCode).setOnClickListener { doResendCode() }

        // Set Password
        findViewById<MaterialButton>(R.id.btnSavePassword).setOnClickListener { doSetPassword() }
    }

    private fun showScreen(screen: String) {
        clearMessages()
        layoutSignIn.visibility = View.GONE
        layoutRegister.visibility = View.GONE
        layoutVerify.visibility = View.GONE
        layoutSetPassword.visibility = View.GONE

        when (screen) {
            "signin" -> {
                tvTitle.text = "Sign In"
                layoutSignIn.visibility = View.VISIBLE
            }
            "register" -> {
                tvTitle.text = "Create Account"
                flowType = "registration"
                layoutRegister.visibility = View.VISIBLE
                findViewById<MaterialButton>(R.id.btnSendCode).text = "Send Verification Code"
            }
            "register_forgot" -> {
                tvTitle.text = "Reset Password"
                flowType = "reset"
                layoutRegister.visibility = View.VISIBLE
                findViewById<MaterialButton>(R.id.btnSendCode).text = "Send Reset Code"
                // Hide username field for forgot password
                findViewById<View>(R.id.etRegUsername).parent.let {
                    (it as View).visibility = if (flowType == "reset") View.GONE else View.VISIBLE
                }
            }
            "verify" -> {
                tvTitle.text = getString(R.string.verify_email_title)
                layoutVerify.visibility = View.VISIBLE
            }
            "set_password" -> {
                tvTitle.text = getString(R.string.set_password_title)
                layoutSetPassword.visibility = View.VISIBLE
            }
        }
    }

    // ── Sign In ──────────────────────────────────────────────────────

    private fun doSignIn() {
        val email = etSignInEmail.text.toString().trim()
        val password = etSignInPassword.text.toString()

        if (email.isEmpty() || password.isEmpty()) {
            showError("Please fill in all fields")
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            try {
                val response = ApiClient.get().login(LoginRequest(email, password))
                if (response.isSuccessful) {
                    val body = response.body()!!
                    val user = body.user!!
                    session.saveUser(user.id, user.username, user.email, user.username, body.token!!)
                    startActivity(Intent(this@AuthActivity, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
                    finish()
                } else {
                    showError(parseError(response))
                }
            } catch (e: Exception) {
                showError("Connection failed: ${e.message}")
            } finally {
                setLoading(false)
            }
        }
    }

    // ── Registration / Forgot Password ──────────────────────────────

    private fun doSendCode() {
        val email = etRegEmail.text.toString().trim()

        if (email.isEmpty()) {
            showError("Please enter your email")
            return
        }

        if (flowType == "registration") {
            val username = etRegUsername.text.toString().trim()
            if (username.isEmpty()) {
                showError("Please enter a username")
                return
            }
            pendingUsername = username
            pendingEmail = email
            setLoading(true)
            lifecycleScope.launch {
                try {
                    val response = ApiClient.get().register(RegisterRequest(username, email))
                    if (response.isSuccessful) {
                        showInfo("Verification code sent to $email")
                        showScreen("verify")
                    } else {
                        showError(parseError(response))
                    }
                } catch (e: Exception) {
                    showError("Connection failed: ${e.message}")
                } finally {
                    setLoading(false)
                }
            }
        } else {
            // Forgot password
            pendingEmail = email
            setLoading(true)
            lifecycleScope.launch {
                try {
                    val response = ApiClient.get().forgotPassword(ForgotPasswordRequest(email))
                    if (response.isSuccessful) {
                        showInfo("Reset code sent to $email")
                        showScreen("verify")
                    } else {
                        showError(parseError(response))
                    }
                } catch (e: Exception) {
                    showError("Connection failed: ${e.message}")
                } finally {
                    setLoading(false)
                }
            }
        }
    }

    // ── Verify Code ──────────────────────────────────────────────────

    private fun doVerifyCode() {
        val code = etVerifyCode.text.toString().trim()
        if (code.length != 6) {
            showError("Please enter the 6-digit code")
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            try {
                val response = if (flowType == "registration") {
                    ApiClient.get().verifyEmail(VerifyEmailRequest(pendingEmail, code))
                } else {
                    ApiClient.get().verifyResetCode(VerifyResetRequest(pendingEmail, code))
                }

                if (response.isSuccessful) {
                    showScreen("set_password")
                    showInfo("Email verified. Set your password.")
                } else {
                    showError(parseError(response))
                }
            } catch (e: Exception) {
                showError("Connection failed: ${e.message}")
            } finally {
                setLoading(false)
            }
        }
    }

    private fun doResendCode() {
        setLoading(true)
        lifecycleScope.launch {
            try {
                val type = if (flowType == "registration") "registration" else "password_reset"
                val response = ApiClient.get().resendCode(ResendCodeRequest(pendingEmail, type))
                if (response.isSuccessful) {
                    showInfo("Code resent to $pendingEmail")
                } else {
                    showError(parseError(response))
                }
            } catch (e: Exception) {
                showError("Connection failed: ${e.message}")
            } finally {
                setLoading(false)
            }
        }
    }

    // ── Set Password ────────────────────────────────────────────────

    private fun doSetPassword() {
        val pw = etNewPassword.text.toString()
        val confirm = etConfirmPassword.text.toString()

        if (pw.length < 6) {
            showError("Password must be at least 6 characters")
            return
        }
        if (pw != confirm) {
            showError("Passwords do not match")
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            try {
                val response = if (flowType == "registration") {
                    ApiClient.get().setPassword(SetPasswordRequest(pendingUsername, pendingEmail, pw))
                } else {
                    ApiClient.get().resetPassword(ResetPasswordRequest(pendingEmail, pw))
                }

                if (response.isSuccessful) {
                    val body = response.body()!!
                    if (body.token != null && body.user != null) {
                        val user = body.user
                        session.saveUser(user.id, user.username, user.email, user.username, body.token)
                        startActivity(Intent(this@AuthActivity, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
                        finish()
                    } else {
                        showInfo("Password set. Please sign in.")
                        showScreen("signin")
                    }
                } else {
                    showError(parseError(response))
                }
            } catch (e: Exception) {
                showError("Connection failed: ${e.message}")
            } finally {
                setLoading(false)
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private fun setLoading(loading: Boolean) {
        progress.visibility = if (loading) View.VISIBLE else View.GONE
    }

    private fun showError(msg: String) {
        tvError.text = msg
        tvError.visibility = View.VISIBLE
        tvInfo.visibility = View.GONE
    }

    private fun showInfo(msg: String) {
        tvInfo.text = msg
        tvInfo.visibility = View.VISIBLE
        tvError.visibility = View.GONE
    }

    private fun clearMessages() {
        tvError.visibility = View.GONE
        tvInfo.visibility = View.GONE
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
