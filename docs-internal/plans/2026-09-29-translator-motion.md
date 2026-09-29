# Translator Motion and Haptics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every translator state change a motion cue and add haptics at three key moments, on top of a shared motion kit later rounds reuse.

**Architecture:** A small `object Motion` (tokens, easing, view helpers) and `object Haptics` wrap plain Android view animation and `performHapticFeedback`. The *decisions* (which Tap transition ticks, whether a result emphasizes or swaps, whether a text swap is needed) are pure functions in `TranslatorFeedback.kt` / `Motion.kt`, unit-tested on the JVM. `MainActivity` calls the helpers at the existing state-change sites.

**Tech Stack:** Kotlin, Android Views (`ViewPropertyAnimator`, `ObjectAnimator`, `ValueAnimator.ofArgb`, `PathInterpolator`), JUnit 4. No new dependencies.

**Spec:** `docs-internal/specs/2026-09-29-translator-motion-design.md`

## Global Constraints

- minSdk 24, compileSdk/targetSdk 34 (`sigla-mobile/app/build.gradle.kts`). API-30+ calls need an `SDK_INT` guard.
- **No new dependencies.**
- Durations: `QUICK` 120 ms, `STANDARD` 220 ms, `EMPHASIS` 320 ms. Easing: `ENTER` `(0, 0, 0.2, 1)`, `EXIT` `(0.4, 0, 1, 1)`, `STANDARD_EASE` `(0.4, 0, 0.2, 1)`.
- Animate only `alpha`, `translationX/Y`, `scaleX/Y` and colour — never layout properties.
- Every helper cancels the view's running animation first and must leave the view in the correct final visibility even when interrupted.
- Nothing may animate per camera frame. The ~15 Hz overlay/progress path only triggers on edges (hands appear/lost).
- Live result stays visible `2000` ms after the **latest** result.
- Haptics via `View.performHapticFeedback` only (honours the system setting, no permission).
- Build/test from `sigla-mobile/` with Java from Android Studio: prefix Gradle with `JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`.
- `adb` is at `$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe`. The reference phone (Android 15, MIUI) blocks `adb shell input` (tap/key injection); `am start` and `settings put` work.

## Review Focus

1. **Two Live results less than 2 s apart** — the second must stay its full 2 s and never blank early (the old timer bug). Pinned by the Task 3 device check "Live timer".
2. **Tap state re-rendered without a real transition** (`renderTapState` called again, e.g. from `hideTapPrompt`) — must not vibrate twice. Pinned by `sameStateReRenderDoesNotTick` in Task 2.
3. **Several status/text updates within one swap** (`setStatus` fires "Starting camera…" then "Loading hand tracking…" within milliseconds) — the final text must be the last one set, never a stale one. Pinned by `MotionTextSwapTest` in Task 1 and the Task 6 reduced-motion/normal status check.
4. **System "Remove animations" on** — result card, prompts, ring, overlay and tints must still end in the correct state. Pinned by the Task 6 reduced-motion run (`settings put global animator_duration_scale 0`).
5. **Leaving the translator mid-animation or with a Live result pending** — no crash, and the pending hide must not fire into a stopped screen. Pinned by the Task 3 step adding `removeCallbacks(hideResult)` to `stopVision()` and the Task 6 "leave mid-result" check.

---

## File Structure

| File | Responsibility |
|---|---|
| `sigla-mobile/app/src/main/kotlin/com/example/sigla/Motion.kt` | **New.** Tokens, easing, helpers (`reveal`, `hide`, `emphasize`, `swapText`, `setText`, `fadeTo`, `pulse`/`stopPulse`, `tintTo`, `isShowing`) and the pure `needsTextSwap`. |
| `sigla-mobile/app/src/main/res/values/motion_ids.xml` | **New.** View-tag keys the helpers use to track in-flight state. |
| `sigla-mobile/app/src/main/kotlin/com/example/sigla/Haptics.kt` | **New.** `tick`, `confirm`. |
| `sigla-mobile/app/src/main/kotlin/com/example/sigla/TranslatorFeedback.kt` | **New.** Pure decisions: `tapFeedback`, `resultMotion`. |
| `sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt` | **Modify.** Call the above at each state-change site. |
| `sigla-mobile/app/src/test/kotlin/com/example/sigla/MotionTextSwapTest.kt` | **New.** Tests `needsTextSwap`. |
| `sigla-mobile/app/src/test/kotlin/com/example/sigla/TranslatorFeedbackTest.kt` | **New.** Tests `tapFeedback`, `resultMotion`. |
| `docs-internal/specs/2026-09-29-translator-motion-design.md` | **Modify.** Record the helper additions and the Tap-button deviation. |

---

### Task 1: Motion kit and performance baseline

**Files:**
- Create: `sigla-mobile/app/src/main/kotlin/com/example/sigla/Motion.kt`
- Create: `sigla-mobile/app/src/main/res/values/motion_ids.xml`
- Test: `sigla-mobile/app/src/test/kotlin/com/example/sigla/MotionTextSwapTest.kt`
- Modify: `docs-internal/specs/2026-09-29-translator-motion-design.md` (§3.2 table)

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3–5):
  - `Motion.QUICK: Long`, `Motion.STANDARD: Long`, `Motion.EMPHASIS: Long`
  - `Motion.ENTER`, `Motion.EXIT`, `Motion.STANDARD_EASE: PathInterpolator`
  - `Motion.reveal(view: View, startDelay: Long = 0L, dyDp: Float = 8f)`
  - `Motion.hide(view: View, endVisibility: Int)` — `View.INVISIBLE` or `View.GONE`
  - `Motion.emphasize(view: View, startDelay: Long = 0L)`
  - `Motion.swapText(view: TextView, text: CharSequence)`
  - `Motion.setText(view: TextView, text: CharSequence)` — immediate; cancels only a pending swap
  - `Motion.fadeTo(view: View, alpha: Float, duration: Long, interpolator: TimeInterpolator, endAction: (() -> Unit)? = null)`
  - `Motion.pulse(view: View)`, `Motion.stopPulse(view: View)`
  - `Motion.tintTo(view: View, color: Int, duration: Long = Motion.STANDARD)`
  - `Motion.isShowing(view: View): Boolean`
  - `internal fun needsTextSwap(current: CharSequence?, pending: CharSequence?, next: CharSequence): Boolean`

- [ ] **Step 1: Record the performance baseline (before any code change)**

The phone currently runs the `main` build (no motion). Open the translator in **Live** mode on the phone (someone signs in front of the camera for ~30 s), then run from any shell:

```bash
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
"$ADB" logcat -c
# ~30 s of continuous Live recognition happens now
sleep 30
PID=$("$ADB" shell pidof com.example.sigla)
"$ADB" logcat -d -v time --pid="$PID" | grep -E "Choreographer.*Skipped|Davey" | tee /tmp/motion_baseline.txt | wc -l
```

Record the count (and the largest "Skipped N frames") in the task notes. This is the bar Task 6 compares against.

- [ ] **Step 2: Write the failing test**

Create `sigla-mobile/app/src/test/kotlin/com/example/sigla/MotionTextSwapTest.kt`:

```kotlin
package com.example.sigla

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionTextSwapTest {

    @Test
    fun swapsWhenTheTextDiffers() {
        assertTrue(needsTextSwap(current = "Loading", pending = null, next = "Ready"))
    }

    @Test
    fun skipsWhenTheTextIsAlreadyShown() {
        assertFalse(needsTextSwap(current = "Ready", pending = null, next = "Ready"))
    }

    @Test
    fun comparesAgainstThePendingTextWhileASwapIsInFlight() {
        // "Starting camera…" is on screen, "Loading hand tracking…" is mid-swap.
        assertFalse(needsTextSwap("Starting camera…", "Loading hand tracking…", "Loading hand tracking…"))
        assertTrue(needsTextSwap("Starting camera…", "Loading hand tracking…", "Checking for model updates…"))
        // Going back to what is currently on screen still counts as a change,
        // because the pending swap would otherwise overwrite it.
        assertTrue(needsTextSwap("Starting camera…", "Loading hand tracking…", "Starting camera…"))
    }

    @Test
    fun comparesContentNotSpanType() {
        val spanned = android.text.SpannableString("HELLO")
        assertFalse(needsTextSwap(current = spanned, pending = null, next = "HELLO"))
    }
}
```

Note: `SpannableString` needs the Android jar, which JVM unit tests stub. If the last test throws `RuntimeException: Method ... not mocked`, replace `android.text.SpannableString("HELLO")` with `StringBuilder("HELLO")` (a non-String `CharSequence` exercises the same `toString()` comparison).

- [ ] **Step 3: Run the test to verify it fails**

Run (from `sigla-mobile/`):
```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.MotionTextSwapTest" -q
```
Expected: FAIL — compilation error `Unresolved reference: needsTextSwap`.

- [ ] **Step 4: Add the tag ids**

Create `sigla-mobile/app/src/main/res/values/motion_ids.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- View-tag keys Motion.kt uses to track in-flight state per view. -->
<resources>
    <item name="motion_hiding" type="id" />
    <item name="motion_pending_text" type="id" />
    <item name="motion_pulse" type="id" />
    <item name="motion_tint" type="id" />
</resources>
```

- [ ] **Step 5: Write the Motion kit**

Create `sigla-mobile/app/src/main/kotlin/com/example/sigla/Motion.kt`:

```kotlin
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
```

Two properties of `ViewPropertyAnimator` this relies on: start delay and interpolator **persist between uses of the same view**, so every helper sets all three (`setStartDelay`, `setDuration`, `setInterpolator`) explicitly; and `withEndAction` does **not** run when the animation is cancelled, which is what lets a `reveal` cancel a `hide` and leave the view visible.

- [ ] **Step 6: Run the test to verify it passes**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.MotionTextSwapTest" -q
```
Expected: PASS (4 tests). Also run `:app:assembleDebug -q` — expected: builds.

- [ ] **Step 7: Record the helper additions in the spec**

In `docs-internal/specs/2026-09-29-translator-motion-design.md` §3.2, change the `reveal` row's first cell to `` `reveal(view, startDelay = 0, dy = 8dp)` `` and add these rows after `emphasize`:

```markdown
| `setText(textView, text)` | Immediate text change for values that update many times a second (frame counter, recording timer). Cancels only a swap in flight. |
| `fadeTo(view, alpha, duration, interpolator, endAction)` | Plain alpha fade for views whose visibility is managed elsewhere (the landmark overlay). |
| `isShowing(view)` | Visible and not on its way out. |
```

- [ ] **Step 8: Commit**

```bash
git add sigla-mobile/app/src/main/kotlin/com/example/sigla/Motion.kt \
        sigla-mobile/app/src/main/res/values/motion_ids.xml \
        sigla-mobile/app/src/test/kotlin/com/example/sigla/MotionTextSwapTest.kt \
        docs-internal/specs/2026-09-29-translator-motion-design.md
git commit -m "feat(mobile): add the shared Motion kit"
```

---

### Task 2: Haptics and translator feedback decisions

**Files:**
- Create: `sigla-mobile/app/src/main/kotlin/com/example/sigla/Haptics.kt`
- Create: `sigla-mobile/app/src/main/kotlin/com/example/sigla/TranslatorFeedback.kt`
- Test: `sigla-mobile/app/src/test/kotlin/com/example/sigla/TranslatorFeedbackTest.kt`

**Interfaces:**
- Consumes: `TapSignSession.State` (existing enum: `IDLE, READY, RECORDING, PROCESSING`).
- Produces (used by Tasks 3–4):
  - `Haptics.tick(view: View)`, `Haptics.confirm(view: View)`
  - `internal data class TapFeedback(val tick: Boolean, val pulse: Boolean, val ring: Boolean)`
  - `internal fun tapFeedback(from: TapSignSession.State?, to: TapSignSession.State): TapFeedback`
  - `internal enum class ResultMotion { EMPHASIZE, SWAP }`
  - `internal fun resultMotion(cardShowing: Boolean): ResultMotion`

- [ ] **Step 1: Write the failing test**

Create `sigla-mobile/app/src/test/kotlin/com/example/sigla/TranslatorFeedbackTest.kt`:

```kotlin
package com.example.sigla

import com.example.sigla.TapSignSession.State.IDLE
import com.example.sigla.TapSignSession.State.PROCESSING
import com.example.sigla.TapSignSession.State.READY
import com.example.sigla.TapSignSession.State.RECORDING
import org.junit.Assert.assertEquals
import org.junit.Test

class TranslatorFeedbackTest {

    @Test
    fun armingPulsesWithoutATick() {
        assertEquals(TapFeedback(tick = false, pulse = true, ring = false), tapFeedback(IDLE, READY))
    }

    @Test
    fun startingToRecordTicksAndShowsTheRing() {
        assertEquals(TapFeedback(tick = true, pulse = false, ring = true), tapFeedback(READY, RECORDING))
    }

    @Test
    fun stoppingForRecognitionTicks() {
        assertEquals(TapFeedback(tick = true, pulse = false, ring = false), tapFeedback(RECORDING, PROCESSING))
    }

    @Test
    fun cancellingDoesNotTick() {
        for (from in listOf(READY, RECORDING, PROCESSING)) {
            assertEquals("from $from", TapFeedback(tick = false, pulse = false, ring = false), tapFeedback(from, IDLE))
        }
    }

    @Test
    fun sameStateReRenderDoesNotTick() {
        assertEquals(TapFeedback(tick = false, pulse = false, ring = true), tapFeedback(RECORDING, RECORDING))
        assertEquals(TapFeedback(tick = false, pulse = true, ring = false), tapFeedback(READY, READY))
    }

    @Test
    fun firstRenderHasNoPreviousState() {
        assertEquals(TapFeedback(tick = false, pulse = false, ring = false), tapFeedback(null, IDLE))
    }

    @Test
    fun aHiddenCardEmphasizesAndAShowingCardSwaps() {
        assertEquals(ResultMotion.EMPHASIZE, resultMotion(cardShowing = false))
        assertEquals(ResultMotion.SWAP, resultMotion(cardShowing = true))
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.TranslatorFeedbackTest" -q
```
Expected: FAIL — `Unresolved reference: tapFeedback` (and `TapFeedback`, `resultMotion`, `ResultMotion`).

- [ ] **Step 3: Write the decisions**

Create `sigla-mobile/app/src/main/kotlin/com/example/sigla/TranslatorFeedback.kt`:

```kotlin
package com.example.sigla

import com.example.sigla.TapSignSession.State

/**
 * What a Tap state change should look and feel like — spec §5.1. Pure, so the
 * rules are tested without a device; MainActivity applies the result to views.
 */
internal data class TapFeedback(val tick: Boolean, val pulse: Boolean, val ring: Boolean)

internal fun tapFeedback(from: State?, to: State): TapFeedback {
    val changed = from != to
    val startedRecording = changed && to == State.RECORDING
    // Only recording → recognizing ticks. Cancelling back to IDLE is not
    // "recording stopped for recognition", so it stays silent.
    val stoppedForRecognition = changed && from == State.RECORDING && to == State.PROCESSING
    return TapFeedback(
        tick = startedRecording || stoppedForRecognition,
        pulse = to == State.READY,
        ring = to == State.RECORDING,
    )
}

/** How a recognized word arrives: a fresh entrance, or a swap in a card already up. */
internal enum class ResultMotion { EMPHASIZE, SWAP }

internal fun resultMotion(cardShowing: Boolean): ResultMotion =
    if (cardShowing) ResultMotion.SWAP else ResultMotion.EMPHASIZE
```

Create `sigla-mobile/app/src/main/kotlin/com/example/sigla/Haptics.kt`:

```kotlin
package com.example.sigla

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * Short vibrations at key translator moments — spec §4. performHapticFeedback
 * honours the system touch-vibration setting and needs no permission.
 */
object Haptics {
    /** Tap recording started or stopped for recognition. */
    fun tick(view: View) {
        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
    }

    /** A word was recognized. CONFIRM exists from Android 11 (API 30). */
    fun confirm(view: View) {
        view.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM
            else HapticFeedbackConstants.LONG_PRESS
        )
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest --tests "com.example.sigla.TranslatorFeedbackTest" -q
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add sigla-mobile/app/src/main/kotlin/com/example/sigla/Haptics.kt \
        sigla-mobile/app/src/main/kotlin/com/example/sigla/TranslatorFeedback.kt \
        sigla-mobile/app/src/test/kotlin/com/example/sigla/TranslatorFeedbackTest.kt
git commit -m "feat(mobile): add haptics and translator feedback decisions"
```

---

### Task 3: Result card motion, Live expiry fix, confirm haptic

**Files:**
- Modify: `sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt` — `showResult` (~line 696), `selectMode` (~786), `stopVision` (~490), Filipino toggle in `setupButtons` (~961), new fields near `hideTapPrompt` (~252).

**Interfaces:**
- Consumes: `Motion.emphasize`, `Motion.reveal`, `Motion.hide`, `Motion.swapText`, `Motion.isShowing`, `Haptics.confirm`, `resultMotion`, `ResultMotion` (Tasks 1–2).
- Produces: `private val hideResult: Runnable`, `private fun scheduleResultHide()`, `private fun clearResult()` inside `MainActivity`. Self-contained; no later task calls them.

- [ ] **Step 1: Add the constants and the tracked hide**

At the top of `MainActivity.kt`, next to the other `private const val`s (after `CAMERA_PERMISSION`):

```kotlin
// Live mode: a result stays up this long after the LATEST recognition.
private const val LIVE_RESULT_VISIBLE_MS = 2000L
// The Filipino line follows the word slightly, so the eye reads the word first.
private const val RESULT_FILIPINO_DELAY_MS = 80L
```

Directly after `private val hideTapPrompt = Runnable { renderTapState() }`:

```kotlin
    // One tracked hide for the Live result card. Each result re-posts it, so an
    // earlier result's timer can no longer hide a newer result early.
    private val hideResult = Runnable { Motion.hide(binding.cardResult, View.INVISIBLE) }

    private fun scheduleResultHide() {
        binding.cardResult.removeCallbacks(hideResult)
        binding.cardResult.postDelayed(hideResult, LIVE_RESULT_VISIBLE_MS)
    }

    private fun clearResult() {
        binding.cardResult.removeCallbacks(hideResult)
        Motion.hide(binding.cardResult, View.INVISIBLE)
    }
```

- [ ] **Step 2: Replace `showResult`**

Replace the whole `showResult` function with:

```kotlin
    /** Renders a recognition result. Called on the UI thread. */
    private fun showResult(result: PredictionResult) {
        // Confidence is no longer shown to the user, but it is still recorded
        // with each history entry (see historyManager.add below).
        val pct = (result.confidence * 100).toInt()

        lastLabel = result.label
        val word = result.label.uppercase()
        val filipino = getFilipinoTranslation(result.label)
        val showFilipinoLine = filipino != null && showFilipino

        when (resultMotion(Motion.isShowing(binding.cardResult))) {
            ResultMotion.EMPHASIZE -> {
                binding.tvResult.text = word
                if (showFilipinoLine) {
                    binding.tvFilipinoResult.text = filipino
                    // INVISIBLE, not GONE: the line keeps its space, so the card
                    // does not change height when it fades in a moment later.
                    binding.tvFilipinoResult.visibility = View.INVISIBLE
                    Motion.reveal(binding.tvFilipinoResult, startDelay = RESULT_FILIPINO_DELAY_MS)
                } else {
                    binding.tvFilipinoResult.visibility = View.GONE
                }
                Motion.emphasize(binding.cardResult)
            }
            ResultMotion.SWAP -> {
                Motion.swapText(binding.tvResult, word)
                if (showFilipinoLine) {
                    if (binding.tvFilipinoResult.visibility == View.VISIBLE) {
                        Motion.swapText(binding.tvFilipinoResult, filipino!!)
                    } else {
                        binding.tvFilipinoResult.text = filipino
                        Motion.reveal(binding.tvFilipinoResult)
                    }
                } else {
                    Motion.hide(binding.tvFilipinoResult, View.GONE)
                }
            }
        }
        Haptics.confirm(binding.root)

        binding.progressBuffer.setProgress(0, true)
        binding.tvBufferPercent.text = "0%"

        // Text-to-speech
        speak(result.label)

        // Save to history off the main thread: add() serializes the whole
        // list and writes prefs, and this fires at the exact moment the
        // result card animates in.
        val gestureType = if (result.isMotion) "motion" else "static"
        val label = result.label
        lifecycleScope.launch(Dispatchers.IO) {
            historyManager.add(label, pct, gestureType)
        }

        // Distinguishes "no translation for this label" from "toggle is off" —
        // the missing-entry case used to fail silently.
        if (filipino == null) {
            Log.d(TAG, "No Filipino translation for '${result.label}' " +
                "(${filipinoMap.size} translation(s) loaded)")
        }

        if (!tapMode) scheduleResultHide()
    }
```

- [ ] **Step 3: Use `clearResult` on mode switch**

In `selectMode`, replace `binding.cardResult.visibility = View.INVISIBLE` with:

```kotlin
        clearResult()
```

- [ ] **Step 4: Drop a pending hide when the screen stops**

In `stopVision()`, directly after `cancelTap()` (the first line, before `if (!visionActive) return`):

```kotlin
        binding.cardResult.removeCallbacks(hideResult)
```

- [ ] **Step 5: Animate the Filipino toggle**

In `setupButtons`, replace the `if (translation != null) { … } else { … }` block inside the Filipino toggle listener with:

```kotlin
            if (translation != null) {
                binding.tvFilipinoResult.text = translation
                Motion.reveal(binding.tvFilipinoResult)
            } else {
                Motion.hide(binding.tvFilipinoResult, View.GONE)
            }
```

- [ ] **Step 6: Build and run all unit tests**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest :app:assembleDebug -q
```
Expected: BUILD SUCCESSFUL, all tests pass.

- [ ] **Step 7: Device check — Live timer (Review Focus 1)**

Install and open the translator in **Live** mode:
```bash
"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" install -r app/build/outputs/apk/debug/app-debug.apk
```
The signer signs one word, then a second word about 1–1.5 s later. Expected:
- The first word scales/fades in (not a pop) with a firm vibration.
- The second word replaces the first with a quick text fade, and another vibration.
- The card stays up a full ~2 s after the **second** word, then fades out (does not vanish).

Record the outcome in the task notes.

- [ ] **Step 8: Commit**

```bash
git add sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt
git commit -m "feat(mobile): animate translator results and fix the Live result timer

Each Live result re-posts one tracked hide instead of scheduling its own,
so an earlier result can no longer hide a newer one early."
```

---

### Task 4: Tap controls and prompts

**Files:**
- Modify: `sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt` — `tapPulse` field (~237), `tapRingTicker` (~238), `showTapMessage` (~769), `renderTapState` (~816), imports.
- Modify: `docs-internal/specs/2026-09-29-translator-motion-design.md` (§5 Tap row)

**Interfaces:**
- Consumes: `Motion.pulse`, `Motion.stopPulse`, `Motion.tintTo`, `Motion.reveal`, `Motion.hide`, `Motion.swapText`, `Motion.setText`, `Motion.isShowing`, `Motion.QUICK`, `Haptics.tick`, `tapFeedback` (Tasks 1–2).
- Produces: `private var lastRenderedTapState: TapSignSession.State?` and `private fun showTapPrompt(text: CharSequence)` inside `MainActivity`.

- [ ] **Step 1: Replace the pulse field and delay the first ticker update**

Replace `private var tapPulse: ObjectAnimator? = null` with:

```kotlin
    // The Tap state last drawn by renderTapState, so a re-render without a real
    // transition does not vibrate again. null = nothing drawn yet / Live mode.
    private var lastRenderedTapState: TapSignSession.State? = null
```

In `tapRingTicker.run()`, replace `binding.tvTapPrompt.text = recordingPromptText(elapsed)` with:

```kotlin
            // Updates 10×/s — set directly; a fading swap would flicker.
            Motion.setText(binding.tvTapPrompt, recordingPromptText(elapsed))
```

- [ ] **Step 2: Add the prompt helper**

Directly after `showTapMessage`, add:

```kotlin
    /** Shows [text] in the Tap prompt: fades in if hidden, swaps if already up. */
    private fun showTapPrompt(text: CharSequence) {
        if (Motion.isShowing(binding.tvTapPrompt)) {
            Motion.swapText(binding.tvTapPrompt, text)
        } else {
            binding.tvTapPrompt.text = text
            Motion.reveal(binding.tvTapPrompt)
        }
    }
```

Replace the body of `showTapMessage` with:

```kotlin
    private fun showTapMessage(message: String) {
        renderTapState()
        showTapPrompt(message)
        binding.tvTapPrompt.removeCallbacks(hideTapPrompt)
        binding.tvTapPrompt.postDelayed(hideTapPrompt, 3000)
    }
```

- [ ] **Step 3: Replace `renderTapState`**

Replace the whole function with:

```kotlin
    /** Draws the tap controls for the current mode and session state. Main thread only. */
    private fun renderTapState() {
        val liveVisibility = if (tapMode) View.GONE else View.VISIBLE
        binding.tvDetectionLabel.visibility = liveVisibility
        binding.progressBuffer.visibility = liveVisibility
        binding.liveStatsRow.visibility = liveVisibility
        binding.tapControls.visibility = if (tapMode) View.VISIBLE else View.GONE

        Motion.stopPulse(binding.btnTapRecord)
        binding.tapRecordRing.removeCallbacks(tapRingTicker)
        if (!tapMode) {
            lastRenderedTapState = null
            return
        }

        val state = tapSession.state
        val feedback = tapFeedback(lastRenderedTapState, state)
        lastRenderedTapState = state
        if (feedback.tick) Haptics.tick(binding.btnTapRecord)

        val accent = ContextCompat.getColor(this, R.color.sg_brand)
        val red = ContextCompat.getColor(this, R.color.sg_danger)
        binding.tvTapPrompt.removeCallbacks(hideTapPrompt)

        // The button's text is set directly: its alpha belongs to the Ready
        // pulse, and a fading text swap would fight it. Tint, ring and haptics
        // carry the state change.
        when (state) {
            TapSignSession.State.IDLE -> {
                binding.btnTapRecord.text = "Tap to sign"
                binding.btnTapRecord.isEnabled = true
                Motion.tintTo(binding.btnTapRecord, accent, Motion.QUICK)
                Motion.hide(binding.tvTapPrompt, View.GONE)
            }
            TapSignSession.State.READY -> {
                binding.btnTapRecord.text = "Cancel"
                binding.btnTapRecord.isEnabled = true
                Motion.tintTo(binding.btnTapRecord, accent, Motion.QUICK)
                showTapPrompt("Ready — start signing")
            }
            TapSignSession.State.RECORDING -> {
                binding.btnTapRecord.text = "Stop"
                binding.btnTapRecord.isEnabled = true
                Motion.tintTo(binding.btnTapRecord, red, Motion.QUICK)
                // feedback.tick is true exactly when RECORDING was just entered,
                // so a same-state re-render keeps the ring's progress.
                if (feedback.tick) binding.tapRecordRing.setProgressCompat(0, false)
                showTapPrompt(recordingPromptText(0L))
                // First tick after the prompt's swap has finished, so the
                // 10×/s timer updates do not cut the swap short.
                binding.tapRecordRing.postDelayed(tapRingTicker, Motion.QUICK)
            }
            TapSignSession.State.PROCESSING -> {
                binding.btnTapRecord.text = "…"
                binding.btnTapRecord.isEnabled = false
                showTapPrompt("Recognizing…")
            }
        }

        if (feedback.ring) {
            if (!Motion.isShowing(binding.tapRecordRing)) Motion.reveal(binding.tapRecordRing, dyDp = 0f)
        } else {
            Motion.hide(binding.tapRecordRing, View.INVISIBLE)
        }
        if (feedback.pulse) Motion.pulse(binding.btnTapRecord)
    }
```

- [ ] **Step 4: Clean up imports**

`ObjectAnimator` and `ValueAnimator` are no longer used in `MainActivity.kt`. Confirm with:

```bash
grep -n "ObjectAnimator\|ValueAnimator" sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt
```
Expected: only the two `import` lines. Delete those two lines.

- [ ] **Step 5: Record the Tap-button deviation in the spec**

In `docs-internal/specs/2026-09-29-translator-motion-design.md` §5, in the row starting `| Tap Idle/Ready/Recording/Processing`, replace `` `btnTapRecord` text via `swapText`, tint via `tintTo`. `` with:

```markdown
`btnTapRecord` text set directly (its alpha belongs to the Ready pulse, so a fading swap would fight it); tint via `tintTo` (`QUICK`). The recording timer text uses `setText`, first update delayed by `QUICK` so the prompt's swap completes.
```

- [ ] **Step 6: Build and run all unit tests**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest :app:assembleDebug -q
```
Expected: BUILD SUCCESSFUL, all tests pass.

- [ ] **Step 7: Device check — Tap flow**

Install, open the translator in **Tap** mode, and (by hand — input injection is blocked) go through:
1. Tap "Tap to sign": button pulses as before, "Ready — start signing" fades in. **No** vibration.
2. Start signing: light tick; button eases to red "Stop"; ring fades in and fills; prompt swaps to "Recording… 0.0s" then counts smoothly (no flicker).
3. Recording ends: light tick; prompt swaps to "Recognizing…"; ring fades out.
4. Result: card emphasizes with a firm vibration (Task 3).
5. Tap "Tap to sign", then "Cancel" from Ready: **no** vibration; prompt fades out.

Record the outcome in the task notes.

- [ ] **Step 8: Commit**

```bash
git add sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt \
        docs-internal/specs/2026-09-29-translator-motion-design.md
git commit -m "feat(mobile): animate Tap controls and prompts, tick on record start/stop"
```

---

### Task 5: Status line, toggles, Live progress and hands overlay

**Files:**
- Modify: `sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt` — `setStatus` (~646), `onNoHands` in `setupCallbacks` (~675), `drainOverlayUpdate` (~886), `flushCollectingState` (~918), `applyToggleStyle` (~1040), `applySegmentStyle` (~1048), new overlay fields.

**Interfaces:**
- Consumes: `Motion.swapText`, `Motion.setText`, `Motion.tintTo`, `Motion.fadeTo`, `Motion.QUICK`, `Motion.STANDARD`, `Motion.ENTER`, `Motion.EXIT` (Task 1).
- Produces: `private var overlayShown: Boolean`, `private fun showOverlay()`, `private fun hideOverlay()` inside `MainActivity`.

- [ ] **Step 1: Status line**

Replace the body of `setStatus` with:

```kotlin
    private fun setStatus(text: String, kind: StatusKind) {
        Motion.swapText(binding.tvStatus, text)
        val colour = when (kind) {
            StatusKind.LOADING -> R.color.sg_text_secondary
            StatusKind.READY -> R.color.sg_success
            StatusKind.ERROR -> R.color.sg_danger
        }
        Motion.tintTo(binding.statusDot, ContextCompat.getColor(this, colour))
    }
```

- [ ] **Step 2: Toggles**

In `applyToggleStyle`, replace
`button.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this, bg))`
with
```kotlin
        Motion.tintTo(button, ContextCompat.getColor(this, bg), Motion.QUICK)
```

In `applySegmentStyle`, replace
```kotlin
        button.backgroundTintList = ColorStateList.valueOf(
            if (on) ContextCompat.getColor(this, R.color.sg_brand) else Color.TRANSPARENT
        )
```
with
```kotlin
        Motion.tintTo(
            button,
            if (on) ContextCompat.getColor(this, R.color.sg_brand) else Color.TRANSPARENT,
            Motion.QUICK,
        )
```

- [ ] **Step 3: Hands overlay fade on the empty ↔ non-empty edge**

Add near `pendingOverlayResult`'s declaration (search `pendingOverlayResult` for the field):

```kotlin
    // Whether the landmark overlay is faded in. Changes only on the hands
    // appear / lost edge — never per frame.
    private var overlayShown = true

    private fun showOverlay() {
        if (overlayShown) return
        overlayShown = true
        Motion.fadeTo(binding.overlayView, 1f, Motion.QUICK, Motion.ENTER)
    }

    private fun hideOverlay() {
        if (!overlayShown) return
        overlayShown = false
        Motion.fadeTo(binding.overlayView, 0f, Motion.STANDARD, Motion.EXIT) {
            // Hands may have come back during the fade.
            if (!overlayShown) binding.overlayView.clear()
        }
    }
```

In `drainOverlayUpdate`, directly after the `binding.overlayView.setLandmarks(…)` call:

```kotlin
                if (displayed.landmarks.isNotEmpty()) showOverlay()
```

- [ ] **Step 4: `onNoHands` and progress**

In `setupCallbacks`' `onNoHands` block, replace
```kotlin
                binding.tvFrames.text             = "No hands"
```
with
```kotlin
                Motion.swapText(binding.tvFrames, "No hands")
```
replace
```kotlin
                binding.progressBuffer.progress   = 0
```
with
```kotlin
                binding.progressBuffer.setProgress(0, true)
```
and replace
```kotlin
                binding.overlayView.clear()
```
with
```kotlin
                hideOverlay()
```

In `flushCollectingState`, replace `binding.progressBuffer.progress = pct` with
```kotlin
            binding.progressBuffer.setProgress(pct, true)
```
and replace `binding.tvFrames.text = "$frames"` with
```kotlin
            // Changes almost every frame: immediate, and it cancels a "No hands"
            // swap still in flight so that text cannot land on top of a count.
            Motion.setText(binding.tvFrames, "$frames")
```

- [ ] **Step 5: Build and run all unit tests**

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:testDebugUnitTest :app:assembleDebug -q
```
Expected: BUILD SUCCESSFUL, all tests pass. Then confirm nothing still writes the tint or progress directly:
```bash
grep -n "progressBuffer.progress\|statusDot.backgroundTintList\|overlayView.clear()" sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt
```
Expected: only the `overlayView.clear()` inside `hideOverlay`.

- [ ] **Step 6: Commit**

```bash
git add sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt
git commit -m "feat(mobile): ease translator status, toggles, progress and hands overlay"
```

---

### Task 6: On-device verification

**Files:** none changed unless a check fails (then fix in the owning task's file and re-run that task's steps).

- [ ] **Step 1: Install**

```bash
cd sigla-mobile
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:assembleDebug -q
"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" install -r app/build/outputs/apk/debug/app-debug.apk
```

- [ ] **Step 2: Performance vs baseline (success criterion)**

Repeat Task 1 Step 1 exactly (Live mode, ~30 s of continuous signing), writing to `/tmp/motion_after.txt`. Expected: no more `Skipped`/`Davey` entries than the baseline, and no new large skips (> 30 frames). Paste both counts in the task notes.

- [ ] **Step 3: Status line and toggles**

Cold-start the translator:
```bash
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
"$ADB" shell am force-stop com.example.sigla
"$ADB" shell am start -n com.example.sigla/.SplashActivity
```
Open the translator (by hand). Expected: status text changes fade ("Starting camera…" → … → "Ready") and ends on **"Ready"** with a green dot. Tap Live/Tap and Words/Letters: highlight eases, no snap.

- [ ] **Step 4: Reduced motion (Review Focus 4)**

```bash
"$ADB" shell settings get global animator_duration_scale   # note the current value, usually 1.0 or null
"$ADB" shell settings put global animator_duration_scale 0
```
Repeat Task 3 Step 7 and Task 4 Step 7 quickly. Expected: everything appears/disappears instantly and ends in the right state — result card visible then gone after 2 s (Live), prompts shown/hidden, ring hidden after recording, status "Ready", no stuck half-transparent views. Then **restore**:
```bash
"$ADB" shell settings put global animator_duration_scale 1
```
(use the value noted above if it was not 1.0; if it was `null`, run `settings delete global animator_duration_scale`).

- [ ] **Step 5: Leave mid-result (Review Focus 5)**

In Live mode, sign a word and press Back / switch tabs within 2 s of the result. Then:
```bash
"$ADB" logcat -d -v time | grep -E "FATAL|AndroidRuntime" | tail -5
```
Expected: no crash lines. Reopen the translator: no stale result card showing.

- [ ] **Step 6: Push the branch for review**

```bash
git push -u origin feature/translator-motion
```
