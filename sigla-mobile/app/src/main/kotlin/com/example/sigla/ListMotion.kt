package com.example.sigla

import android.content.Context
import android.view.View
import android.view.animation.Animation
import android.view.animation.AnimationUtils
import android.view.animation.LayoutAnimationController
import androidx.recyclerview.widget.RecyclerView

/** Items past this index share its delay, so a long list never waits to appear. */
internal const val LIST_STAGGER_CAP = 8

/**
 * A list plays its entrance once per screen instance, on its first non-empty
 * data. Search keystrokes, tab returns and refreshes arrive with it already
 * played; an empty first load does not spend it.
 */
internal fun shouldPlayListEntrance(alreadyPlayed: Boolean, itemCount: Int): Boolean =
    !alreadyPlayed && itemCount > 0

/** Start delay for the item at [index]: one [stepMs] per item, capped. */
internal fun staggerDelayMs(index: Int, stepMs: Long, cap: Int = LIST_STAGGER_CAP): Long =
    minOf(maxOf(index, 0), cap - 1) * stepMs

/**
 * Plays a RecyclerView's staggered entrance once, on its first non-empty data.
 * Call [onData] every time the adapter's data is set.
 */
class ListEntrance(private val list: RecyclerView) {
    private var played = false

    fun onData(itemCount: Int) {
        if (!shouldPlayListEntrance(played, itemCount)) return
        played = true
        list.layoutAnimation = CappedListAnimation(list.context)
        list.setLayoutAnimationListener(object : Animation.AnimationListener {
            override fun onAnimationStart(animation: Animation?) = Unit
            override fun onAnimationRepeat(animation: Animation?) = Unit
            // Drop the controller once played, so later layouts (new rows,
            // filtering) can never pick it up again.
            override fun onAnimationEnd(animation: Animation?) {
                list.layoutAnimation = null
            }
        })
        list.scheduleLayoutAnimation()
    }
}

/** Layout animation whose per-item delay is [staggerDelayMs] — capped, unlike XML's. */
private class CappedListAnimation(context: Context) :
    LayoutAnimationController(AnimationUtils.loadAnimation(context, R.anim.list_item_enter), 0f) {

    private val stepMs = context.resources.getInteger(R.integer.motion_list_stagger).toLong()

    override fun getDelayForView(view: View): Long {
        val index = view.layoutParams?.layoutAnimationParameters?.index ?: 0
        return staggerDelayMs(index, stepMs)
    }
}

/** Empty states fade in rather than pop; hiding is instant (the list takes over). */
fun View.showEmptyState(show: Boolean) {
    if (show) {
        if (visibility != View.VISIBLE) Motion.reveal(this)
    } else {
        Motion.hideNow(this, View.GONE)
    }
}
