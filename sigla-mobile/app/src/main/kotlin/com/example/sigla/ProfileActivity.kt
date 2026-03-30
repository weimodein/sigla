package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch

class ProfileActivity : AppCompatActivity() {

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var session: SessionManager

    private lateinit var etName: TextInputEditText
    private lateinit var etUsername: TextInputEditText
    private lateinit var etEmail: TextInputEditText
    private lateinit var tvError: TextView
    private lateinit var tvInfo: TextView
    private lateinit var progress: ProgressBar

    // Password change
    private lateinit var layoutPwStep1: View
    private lateinit var layoutPwStep2: View
    private lateinit var etPwCode: TextInputEditText
    private lateinit var etPwNew: TextInputEditText
    private lateinit var etPwConfirm: TextInputEditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_profile)

        session = SessionManager.getInstance(this)
        drawerLayout = findViewById(R.id.drawerLayout)

        if (!session.isLoggedIn) {
            startActivity(Intent(this, AuthActivity::class.java))
            finish()
            return
        }

        // Sidebar
        val sidebar = drawerLayout.getChildAt(1)
        NavigationHelper.setup(this, drawerLayout, sidebar, Screen.PROFILE)
        findViewById<MaterialButton>(R.id.btnMenu).setOnClickListener {
            drawerLayout.openDrawer(sidebar)
        }

        etName = findViewById(R.id.etName)
        etUsername = findViewById(R.id.etUsername)
        etEmail = findViewById(R.id.etEmail)
        tvError = findViewById(R.id.tvProfileError)
        tvInfo = findViewById(R.id.tvProfileInfo)
        progress = findViewById(R.id.progressProfile)
        layoutPwStep1 = findViewById(R.id.layoutPwStep1)
        layoutPwStep2 = findViewById(R.id.layoutPwStep2)
        etPwCode = findViewById(R.id.etPwCode)
        etPwNew = findViewById(R.id.etPwNew)
        etPwConfirm = findViewById(R.id.etPwConfirm)

        // Populate fields
        etName.setText(session.name ?: "")
        etUsername.setText(session.username ?: "")
        etEmail.setText(session.email ?: "")

        // Save profile
        findViewById<MaterialButton>(R.id.btnSaveProfile).setOnClickListener { saveProfile() }

        // Change password flow
        findViewById<MaterialButton>(R.id.btnSendPwCode).setOnClickListener { sendPasswordCode() }
        findViewById<MaterialButton>(R.id.btnChangePassword).setOnClickListener { changePassword() }

        // Logout
        findViewById<MaterialButton>(R.id.btnLogout).setOnClickListener {
            AlertDialog.Builder(this)
                .setMessage(getString(R.string.logout_confirm))
                .setPositiveButton("Sign Out") { _, _ ->
                    session.clearSession()
                    startActivity(Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }

    private fun saveProfile() {
        val name = etName.text.toString().trim()
        val username = etUsername.text.toString().trim()

        if (username.isEmpty()) {
            showError("Username cannot be empty")
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            try {
                val response = ApiClient.get(session.token)
                    .updateProfile(session.userId, UpdateProfileRequest(username, name))
                if (response.isSuccessful) {
                    session.username = username
                    session.name = name
                    showInfo("Profile updated")
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

    private fun sendPasswordCode() {
        val email = session.email ?: return
        setLoading(true)
        lifecycleScope.launch {
            try {
                val response = ApiClient.get().forgotPassword(ForgotPasswordRequest(email))
                if (response.isSuccessful) {
                    layoutPwStep1.visibility = View.GONE
                    layoutPwStep2.visibility = View.VISIBLE
                    showInfo("Verification code sent to $email")
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

    private fun changePassword() {
        val code = etPwCode.text.toString().trim()
        val newPw = etPwNew.text.toString()
        val confirmPw = etPwConfirm.text.toString()

        if (code.length != 6) {
            showError("Enter the 6-digit code")
            return
        }
        if (newPw.length < 6) {
            showError("Password must be at least 6 characters")
            return
        }
        if (newPw != confirmPw) {
            showError("Passwords do not match")
            return
        }

        val email = session.email ?: return
        setLoading(true)
        lifecycleScope.launch {
            try {
                // First verify the reset code
                val verifyResponse = ApiClient.get().verifyResetCode(VerifyResetRequest(email, code))
                if (!verifyResponse.isSuccessful) {
                    showError("Invalid or expired code")
                    setLoading(false)
                    return@launch
                }

                // Then reset the password
                val resetResponse = ApiClient.get().resetPassword(ResetPasswordRequest(email, newPw))
                if (resetResponse.isSuccessful) {
                    showInfo("Password changed successfully")
                    layoutPwStep2.visibility = View.GONE
                    layoutPwStep1.visibility = View.VISIBLE
                    etPwCode.text?.clear()
                    etPwNew.text?.clear()
                    etPwConfirm.text?.clear()
                } else {
                    showError(parseError(resetResponse))
                }
            } catch (e: Exception) {
                showError("Connection failed: ${e.message}")
            } finally {
                setLoading(false)
            }
        }
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

    private fun setLoading(loading: Boolean) {
        progress.visibility = if (loading) View.VISIBLE else View.GONE
    }

    private fun parseError(response: retrofit2.Response<*>): String {
        return try {
            val errorBody = response.errorBody()?.string() ?: ""
            val json = com.google.gson.JsonParser.parseString(errorBody).asJsonObject
            json.get("message")?.asString ?: "Something went wrong"
        } catch (e: Exception) { "Something went wrong" }
    }
}
