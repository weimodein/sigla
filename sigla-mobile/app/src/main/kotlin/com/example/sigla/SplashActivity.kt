package com.example.sigla

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class SplashActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val session = SessionManager.getInstance(this)
        val next = when {
            !session.isOnboardingDone -> OnboardingActivity::class.java
            else                      -> MainActivity::class.java
        }
        startActivity(Intent(this, next))
        finish()
    }
}
