package com.example.sigla

import android.animation.ObjectAnimator
import android.animation.TimeInterpolator
import android.animation.ValueAnimator
import android.content.res.ColorStateList
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.TextView

/**
 * True when showing [next] requires a swap: compared against the text a swap
 * already in flight will land on ([pending]), else what is on screen.
 * Content comparison, so a Spanned "HELLO" equals the String "HELLO".
 */
internal fun needsTextSwap(current: CharSequence?, pending: CharSequence?, next: CharSequence): Boolean =
    (pending ?: current)?.toString() != next.toString()

/**
 * Shared motion tokens and helpers — docs-internal/specs/2026-09-29-translator-motion-design.md §3.
 *
 * Every helper cancels the view's running animation first and starts from the
 * current value, so rapid state changes never stack or snap back, and always
 * leaves the correct final visibility. With the system animator scale at 0
 * ("Remove animations") Android completes these immediately and end actions
 * still run, so reduced motion needs no extra branch.
 */
object Motion {
    const val QUICK = 120L
    const val STANDARD = 220L
    const val EMPHASIS = 320L

    val ENTER = PathInterpolator(0f, 0f, 0.2f, 1f)
    val EXIT = PathInterpolator(0.4f, 0f, 1f, 1f)
    val STANDARD_EASE = PathInterpolator(0.4f, 0f, 0.2f, 1f)

    private const val EMPHASIS_START_SCALE = 0.92f
    private const val PULSE_MS = 600L
    private const val PULSE_ALPHA = 0.45f

    /** Visible and not on its way out. */
    fun isShowing(view: View): Boolean =
        view.visibility == View.VISIBLE && view.getTag(R.id.motion_hiding) != true

    /** Fade in and slide up from [dyDp]. Already visible: settle from the current values. */
    fun reveal(view: View, startDelay: Long = 0L, dyDp: Float = 8f) {
        begin(view)
        if (view.visibility != View.VISIBLE) {
            view.alpha = 0f
            view.translationY = dyDp * view.resources.displayMetrics.density
            view.visibility = View.VISIBLE
        }
        view.animate().alpha(1f).translationY(0f)
            .setStartDelay(startDelay).setDuration(STANDARD).setInterpolator(ENTER)
    }

    /** Fade out, then set [endVisibility] and restore the resting values. */
    fun hide(view: View, endVisibility: Int) {
        begin(view)
        if (view.visibility != View.VISIBLE) {
            view.visibility = endVisibility
            return
        }
        view.setTag(R.id.motion_hiding, true)
        view.animate().alpha(0f)
            .setStartDelay(0).setDuration(STANDARD).setInterpolator(EXIT)
            .withEndAction {
                view.setTag(R.id.motion_hiding, null)
                view.visibility = endVisibility
                view.alpha = 1f
                view.translationY = 0f
                view.scaleX = 1f
                view.scaleY = 1f
            }
    }

    /** The most noticeable entrance: scale up slightly while fading in. */
    fun emphasize(view: View, startDelay: Long = 0L) {
        // Decide before begin(), which clears the hiding flag. A card on its way
        // out counts as entering, so a new word interrupting its exit still pops.
        val entering = view.visibility != View.VISIBLE || view.getTag(R.id.motion_hiding) == true
        begin(view)
        if (view.visibility != View.VISIBLE) {
            view.alpha = 0f
            view.visibility = View.VISIBLE
        }
        if (entering) {
            view.scaleX = EMPHASIS_START_SCALE
            view.scaleY = EMPHASIS_START_SCALE
        }
        view.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f)
            .setStartDelay(startDelay).setDuration(EMPHASIS).setInterpolator(ENTER)
    }

    /** Quick fade out, change the text, fade back in. No-op if nothing would change. */
    fun swapText(view: TextView, text: CharSequence) {
        val pending = view.getTag(R.id.motion_pending_text) as CharSequence?
        if (!needsTextSwap(view.text, pending, text)) return
        begin(view)
        if (view.visibility != View.VISIBLE) {
            view.text = text
            view.alpha = 1f
            return
        }
        view.setTag(R.id.motion_pending_text, text)
        view.animate().alpha(0f)
            .setStartDelay(0).setDuration(QUICK / 2).setInterpolator(EXIT)
            .withEndAction {
                view.setTag(R.id.motion_pending_text, null)
                view.text = text
                view.animate().alpha(1f)
                    .setStartDelay(0).setDuration(QUICK / 2).setInterpolator(ENTER)
            }
    }

    /**
     * Set text immediately, for values that change many times a second (a
     * counter, a timer). Cancels only a text swap in flight; an entrance or
     * exit animation on the same view keeps running.
     */
    fun setText(view: TextView, text: CharSequence) {
        if (view.getTag(R.id.motion_pending_text) != null) {
            view.animate().cancel()
            view.setTag(R.id.motion_pending_text, null)
            view.alpha = 1f
        }
        view.text = text
    }

    /** Plain alpha fade for views whose visibility is managed elsewhere. */
    fun fadeTo(
        view: View,
        alpha: Float,
        duration: Long,
        interpolator: TimeInterpolator,
        endAction: (() -> Unit)? = null,
    ) {
        view.animate().cancel()
        val anim = view.animate().alpha(alpha)
            .setStartDelay(0).setDuration(duration).setInterpolator(interpolator)
        if (endAction != null) anim.withEndAction(endAction)
    }

    /** Repeating attention pulse (alpha 1 ↔ 0.45). Replaces any pulse already running. */
    fun pulse(view: View) {
        stopPulse(view)
        val anim = ObjectAnimator.ofFloat(view, View.ALPHA, 1f, PULSE_ALPHA).apply {
            duration = PULSE_MS
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
            start()
        }
        view.setTag(R.id.motion_pulse, anim)
    }

    fun stopPulse(view: View) {
        (view.getTag(R.id.motion_pulse) as? ObjectAnimator)?.cancel()
        view.setTag(R.id.motion_pulse, null)
        view.alpha = 1f
    }

    /** Ease the background tint to [color] from wherever it is now. */
    fun tintTo(view: View, color: Int, duration: Long = STANDARD) {
        (view.getTag(R.id.motion_tint) as? ValueAnimator)?.cancel()
        val from = view.backgroundTintList?.defaultColor
        if (from == null || from == color) {
            view.backgroundTintList = ColorStateList.valueOf(color)
            return
        }
        val anim = ValueAnimator.ofArgb(from, color).apply {
            this.duration = duration
            interpolator = STANDARD_EASE
            addUpdateListener { view.backgroundTintList = ColorStateList.valueOf(it.animatedValue as Int) }
            start()
        }
        view.setTag(R.id.motion_tint, anim)
    }

    /**
     * Cancel what is running on [view]. A text swap cut short lands its text
     * now, so the final text is never lost to an interruption.
     */
    private fun begin(view: View) {
        view.animate().cancel()
        view.setTag(R.id.motion_hiding, null)
        val pending = view.getTag(R.id.motion_pending_text) as CharSequence?
        if (pending != null && view is TextView) {
            view.text = pending
            view.setTag(R.id.motion_pending_text, null)
        }
    }
}
