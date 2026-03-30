package com.example.sigla

import android.app.Activity
import android.content.Intent
import android.widget.TextView
import androidx.drawerlayout.widget.DrawerLayout
import android.view.View

enum class Screen { MAIN, WORD_BANK, HISTORY, SUGGEST, NOTIFICATIONS, PROFILE, SETTINGS }

object NavigationHelper {

    fun setup(
        activity: Activity,
        drawerLayout: DrawerLayout,
        sidebar: View,
        current: Screen
    ) {
        val session = SessionManager.getInstance(activity)

        // User greeting
        sidebar.findViewById<TextView>(R.id.tvSidebarUser).text =
            if (session.isLoggedIn) "@${session.username}" else "Guest"

        // Auth action label
        sidebar.findViewById<TextView>(R.id.tvNavAuthAction).text =
            if (session.isLoggedIn) activity.getString(R.string.nav_sign_out)
            else activity.getString(R.string.nav_sign_in)

        // Highlight current item
        highlightCurrent(sidebar, current)

        // Navigation clicks
        sidebar.findViewById<View>(R.id.navItemMain).setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.MAIN) {
                activity.startActivity(Intent(activity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
                activity.finish()
            }
        }
        sidebar.findViewById<View>(R.id.navItemWordBank).setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.WORD_BANK) {
                activity.startActivity(Intent(activity, WordBankActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }
        sidebar.findViewById<View>(R.id.navItemHistory).setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.HISTORY) {
                activity.startActivity(Intent(activity, TranslationHistoryActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }
        sidebar.findViewById<View>(R.id.navItemSuggest).setOnClickListener {
            drawerLayout.closeDrawers()
            if (!session.isLoggedIn) {
                activity.startActivity(Intent(activity, AuthActivity::class.java))
                return@setOnClickListener
            }
            if (current != Screen.SUGGEST) {
                activity.startActivity(Intent(activity, SuggestWordActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }
        sidebar.findViewById<View>(R.id.navItemNotifications).setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.NOTIFICATIONS) {
                activity.startActivity(Intent(activity, NotificationsActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }
        sidebar.findViewById<View>(R.id.navItemProfile).setOnClickListener {
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
        sidebar.findViewById<View>(R.id.navItemSettings).setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.SETTINGS) {
                activity.startActivity(Intent(activity, SettingsActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }
        sidebar.findViewById<View>(R.id.navItemAuthAction).setOnClickListener {
            drawerLayout.closeDrawers()
            if (session.isLoggedIn) {
                session.clearSession()
                // Return to main
                activity.startActivity(Intent(activity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
            } else {
                activity.startActivity(Intent(activity, AuthActivity::class.java))
            }
        }
    }

    private fun highlightCurrent(sidebar: View, current: Screen) {
        val activeColor = 0xFF1E3A8A.toInt()
        val map = mapOf(
            Screen.MAIN          to R.id.navItemMain,
            Screen.WORD_BANK     to R.id.navItemWordBank,
            Screen.HISTORY       to R.id.navItemHistory,
            Screen.SUGGEST       to R.id.navItemSuggest,
            Screen.NOTIFICATIONS to R.id.navItemNotifications,
            Screen.PROFILE       to R.id.navItemProfile,
            Screen.SETTINGS      to R.id.navItemSettings,
        )
        map[current]?.let { id ->
            sidebar.findViewById<View>(id)?.setBackgroundColor(activeColor)
        }
    }
}
