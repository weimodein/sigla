package com.example.sigla

import android.app.Activity
import android.content.Intent
import android.widget.ImageView
import android.widget.TextView
import androidx.drawerlayout.widget.DrawerLayout
import android.view.View
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class Screen { MAIN, WORD_BANK, HISTORY, NOTIFICATIONS, PROFILE, SETTINGS }

object NavigationHelper {

    fun setup(
        activity: Activity,
        drawerLayout: DrawerLayout,
        sidebar: View,
        current: Screen
    ) {
        val session = SessionManager.getInstance(activity)

        // User info
        val tvUsername = sidebar.findViewById<TextView>(R.id.tvSidebarUsername)
        val tvEmail = sidebar.findViewById<TextView>(R.id.tvSidebarEmail)
        val btnSignIn = sidebar.findViewById<MaterialButton>(R.id.btnSidebarSignIn)

        if (session.isLoggedIn) {
            tvUsername?.text = session.username ?: "User"
            tvEmail?.text = session.email ?: ""
            btnSignIn?.visibility = View.GONE
        } else {
            tvUsername?.text = "Guest User"
            tvEmail?.text = "Not signed in"
            btnSignIn?.visibility = View.VISIBLE
        }

        // Highlight current item
        highlightCurrent(sidebar, current)

        // Navigation clicks - using your new IDs
        sidebar.findViewById<View>(R.id.navMainInterface)?.setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.MAIN) {
                activity.startActivity(Intent(activity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
                activity.finish()
            }
        }

        sidebar.findViewById<View>(R.id.navWordBank)?.setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.WORD_BANK) {
                activity.startActivity(Intent(activity, WordBankActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }

        sidebar.findViewById<View>(R.id.navTranslationHistory)?.setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.HISTORY) {
                activity.startActivity(Intent(activity, TranslationHistoryActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }

        sidebar.findViewById<View>(R.id.navNotifications)?.setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.NOTIFICATIONS) {
                activity.startActivity(Intent(activity, NotificationsActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }

        sidebar.findViewById<View>(R.id.navProfile)?.setOnClickListener {
            drawerLayout.closeDrawers()
            if (!session.isLoggedIn) {
                activity.startActivity(Intent(activity, AuthActivity::class.java))
                return@setOnClickListener
            }
            if (current != Screen.PROFILE) {
                activity.startActivity(Intent(activity, ProfileActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }

        sidebar.findViewById<View>(R.id.navSettings)?.setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.SETTINGS) {
                activity.startActivity(Intent(activity, SettingsActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }

        // Sign In button
        btnSignIn?.setOnClickListener {
            drawerLayout.closeDrawers()
            activity.startActivity(Intent(activity, AuthActivity::class.java))
        }
    }

    private fun highlightCurrent(sidebar: View, current: Screen) {
        val selectedColor = 0xFF4A90E2.toInt()
        
        // Reset all first
        val allNavItems = listOf(
            R.id.navMainInterface, R.id.navWordBank, R.id.navTranslationHistory,
            R.id.navNotifications, R.id.navProfile, R.id.navSettings
        )
        
        allNavItems.forEach { id ->
            val item = sidebar.findViewById<View>(id)
            item?.setBackgroundResource(R.drawable.bg_nav_item_default)
        }
        
        // Highlight current
        val currentId = when (current) {
            Screen.MAIN -> R.id.navMainInterface
            Screen.WORD_BANK -> R.id.navWordBank
            Screen.HISTORY -> R.id.navTranslationHistory
            Screen.NOTIFICATIONS -> R.id.navNotifications
            Screen.PROFILE -> R.id.navProfile
            Screen.SETTINGS -> R.id.navSettings
        }
        
        val currentItem = sidebar.findViewById<View>(currentId)
        currentItem?.setBackgroundResource(R.drawable.bg_nav_item_selected)
    }
}