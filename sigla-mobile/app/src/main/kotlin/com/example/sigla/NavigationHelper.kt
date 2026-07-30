package com.example.sigla

import android.app.Activity
import android.content.Intent
import android.widget.ImageView
import androidx.drawerlayout.widget.DrawerLayout
import android.view.View
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
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
        // tvSidebarUsername / tvSidebarEmail / btnSidebarSignIn are deliberately not
        // looked up here: none of them exist in nav_sidebar.xml (the layout that's
        // actually inflated), so every lookup was a guaranteed full-hierarchy miss
        // paid on every navigation between modules (same issue fixed in MainActivity's
        // setActiveNavItem).

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

        sidebar.findViewById<View>(R.id.navSettings)?.setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.SETTINGS) {
                activity.startActivity(Intent(activity, SettingsActivity::class.java))
                if (current != Screen.MAIN) activity.finish()
            }
        }
        // navNotifications / navProfile / btnSidebarSignIn are deliberately not wired
        // here: none of those ids exist in nav_sidebar.xml, so each lookup was a
        // guaranteed full-hierarchy miss paid on every navigation between modules.
    }

    private fun highlightCurrent(sidebar: View, current: Screen) {
        // Only the ids nav_sidebar.xml actually defines — navNotifications and
        // navProfile were full-hierarchy misses on every call.
        val allNavItems = listOf(
            R.id.navMainInterface, R.id.navWordBank, R.id.navTranslationHistory,
            R.id.navSettings
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