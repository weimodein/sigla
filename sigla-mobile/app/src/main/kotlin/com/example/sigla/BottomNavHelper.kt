package com.example.sigla

import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat

enum class Tab { HOME, WORD_BANK, HISTORY, SETTINGS }

/**
 * Wires view_bottom_nav.xml on a tab screen (spec §3).
 *
 * Tabs are separate Activities. Switching reorders the existing instance to the
 * front with no animation, so a tab keeps its scroll position and state and the
 * switch feels like a tab change. The centre button opens the translator on top.
 */
object BottomNavHelper {

    private class TabViews(val tab: Tab, val root: Int, val icon: Int, val label: Int)

    private val TABS = listOf(
        TabViews(Tab.HOME, R.id.tabHome, R.id.tabHomeIcon, R.id.tabHomeLabel),
        TabViews(Tab.WORD_BANK, R.id.tabWordBank, R.id.tabWordBankIcon, R.id.tabWordBankLabel),
        TabViews(Tab.HISTORY, R.id.tabHistory, R.id.tabHistoryIcon, R.id.tabHistoryLabel),
        TabViews(Tab.SETTINGS, R.id.tabSettings, R.id.tabSettingsIcon, R.id.tabSettingsLabel),
    )

    internal fun activityFor(tab: Tab): Class<out Activity> = when (tab) {
        Tab.HOME -> HomeActivity::class.java
        Tab.WORD_BANK -> WordBankActivity::class.java
        Tab.HISTORY -> TranslationHistoryActivity::class.java
        Tab.SETTINGS -> SettingsActivity::class.java
    }

    fun setup(activity: Activity, current: Tab) {
        val on = ContextCompat.getColor(activity, R.color.sg_brand_text)
        val off = ContextCompat.getColor(activity, R.color.sg_text_secondary)
        val semibold = ResourcesCompat.getFont(activity, R.font.poppins_semibold)
        val regular = ResourcesCompat.getFont(activity, R.font.poppins_regular)
        for (t in TABS) {
            val selected = t.tab == current
            activity.findViewById<ImageView>(t.icon).imageTintList =
                ColorStateList.valueOf(if (selected) on else off)
            activity.findViewById<TextView>(t.label).apply {
                setTextColor(if (selected) on else off)
                typeface = if (selected) semibold else regular
            }
            activity.findViewById<View>(t.root).apply {
                isSelected = selected
                setOnClickListener { open(activity, t.tab) }
            }
        }
        activity.findViewById<View>(R.id.fabTranslate).setOnClickListener { openTranslator(activity) }
    }

    fun open(activity: Activity, tab: Tab) {
        val target = activityFor(tab)
        if (activity.javaClass == target) return
        activity.startActivity(Intent(activity, target).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        @Suppress("DEPRECATION")
        activity.overridePendingTransition(0, 0)
    }

    fun openWordBankSearch(activity: Activity) {
        activity.startActivity(
            Intent(activity, WordBankActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                .putExtra(WordBankActivity.EXTRA_FOCUS_SEARCH, true)
        )
        @Suppress("DEPRECATION")
        activity.overridePendingTransition(0, 0)
    }

    fun openTranslator(activity: Activity) {
        activity.startActivity(Intent(activity, MainActivity::class.java))
    }
}
