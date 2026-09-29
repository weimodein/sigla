package com.example.sigla

import android.animation.ValueAnimator
import android.content.Context
import android.os.Build
import android.provider.Settings
import android.view.View
import android.view.animation.Animation
import android.view.animation.AnimationUtils
import android.view.animation.LayoutAnimationController
import androidx.recyclerview.widget.RecyclerView

/**
 * Whether the system's "Remove animations" setting is off, i.e. animations
 * should run. `ValueAnimator.areAnimatorsEnabled()` (API 26+) is Android's
 * own check; below that, read the animator duration scale directly — 0 means
 * off, and this is the same setting `Settings.Global.ANIMATOR_DURATION_SCALE`
 * exposes on every API level, `ValueAnimator` included.
 */
internal fun systemAnimationsEnabled(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ValueAnimator.areAnimatorsEnabled()
    } else {
        Settings.Global.getFloat(
            context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f
        ) != 0f
    }

/** Items past this index share its delay, so a long list never waits to appear. */
internal const val LIST_STAGGER_CAP = 8

/**
 * A list plays its entrance once per screen instance, on its first non-empty
 * data. Search keystrokes, tab returns and refreshes arrive with it already
 * played; an empty first load does not spend it. With system animations off
 * ([animationsEnabled] false), the caller must still mark it played — the
 * entrance is skipped, not merely deferred, so turning animations back on
 * later does not retroactively animate rows already on screen.
 */
internal fun shouldPlayListEntrance(
    alreadyPlayed: Boolean,
    itemCount: Int,
    animationsEnabled: Boolean = true,
): Boolean = !alreadyPlayed && itemCount > 0 && animationsEnabled

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
        val animationsEnabled = systemAnimationsEnabled(list.context)
        if (!animationsEnabled && !played && itemCount > 0) {
            // Skipped, not deferred: mark it spent so re-enabling animations
            // later does not retroactively animate rows already on screen.
            played = true
            return
        }
        if (!shouldPlayListEntrance(played, itemCount, animationsEnabled)) return
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
