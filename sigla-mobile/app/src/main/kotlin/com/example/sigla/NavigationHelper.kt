package com.example.sigla

import android.app.Activity
import android.content.Intent
import android.view.View
import androidx.drawerlayout.widget.DrawerLayout

enum class Screen { MAIN, WORD_BANK, HISTORY, SETTINGS }

object NavigationHelper {

    fun setup(
        activity: Activity,
        drawerLayout: DrawerLayout,
        sidebar: View,
        current: Screen
    ) {
        highlightCurrent(sidebar, current)

        sidebar.findViewById<View>(R.id.navMainInterface)?.setOnClickListener {
            drawerLayout.closeDrawers()
            if (current != Screen.MAIN) {
                activity.startActivity(
                    Intent(activity, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                )
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
    }

    private fun highlightCurrent(sidebar: View, current: Screen) {
        val allNavItems = listOf(
            R.id.navMainInterface,
            R.id.navWordBank,
            R.id.navTranslationHistory,
            R.id.navSettings
        )

        allNavItems.forEach { id ->
            sidebar.findViewById<View>(id)?.setBackgroundResource(R.drawable.bg_nav_item_default)
        }

        val currentId = when (current) {
            Screen.MAIN -> R.id.navMainInterface
            Screen.WORD_BANK -> R.id.navWordBank
            Screen.HISTORY -> R.id.navTranslationHistory
            Screen.SETTINGS -> R.id.navSettings
        }
        sidebar.findViewById<View>(currentId)
            ?.setBackgroundResource(R.drawable.bg_nav_item_selected)
    }
}
