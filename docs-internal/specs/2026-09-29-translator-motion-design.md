# Translator Motion and Haptics — Design

**Date:** 2026-09-29
**Status:** Approved in design review, pending spec review
**Area:** sigla-mobile

## 1. Goal

Make the translator's state changes readable at a glance through motion and
haptics, for **both** people who use it: a hearing partner reading the result,
and a signer glancing at the screen mid-sign (front or back camera).

Today every translator change is instant: the result card pops in and, in Live
mode, vanishes; prompts, status and button states swap with no cue. The single
existing animation is the Tap "Ready" opacity pulse.

This is the first round of a larger motion effort. It also lays the shared
foundation (§3) that later rounds reuse. Screen transitions, list/content
entrance and general touch feedback are **out of scope** here and get their own
designs.

### Success criteria

- A recognized word is the most noticeable event on the screen, in both modes.
- No translator element appears, disappears or changes state without a cue.
- A signer can tell recording started, stopped, and a word was recognized
  without looking (haptics).
- No new skipped frames on the UI thread during Live recognition (the screen
  that previously ANR'd).
- With system "Remove animations" on, every element still ends in its correct
  visible/hidden state.

## 2. Approach

Plain Android view animations (`ViewPropertyAnimator`, `ObjectAnimator`,
`ValueAnimator`) behind a small shared kit. No new dependencies. Rejected:
MotionLayout (would mean converting the large translator layout, and its
transitions re-run layout on the screen least able to afford it) and Lottie
(needs designed assets and a ~0.5 MB dependency for what are state cues, not
illustrations).

## 3. Motion foundation — `Motion.kt`

A single `object Motion` in `com.example.sigla`. Every animation in this round
goes through it.

### 3.1 Tokens

| Token | ms | For |
|---|---|---|
| `QUICK` | 120 | State feedback: text swaps, colour changes |
| `STANDARD` | 220 | Enter/leave: prompts, overlay, status dot |
| `EMPHASIS` | 320 | A recognized word appearing |

Easing, as `PathInterpolator`s (Material standard curves):

- `ENTER` — decelerate, `(0, 0, 0.2, 1)`
- `EXIT` — accelerate, `(0.4, 0, 1, 1)`
- `STANDARD_EASE` — `(0.4, 0, 0.2, 1)`

### 3.2 Helpers

| Helper | Does |
|---|---|
| `reveal(view, startDelay = 0, dy = 8dp)` | Make visible; fade 0→1 and slide up from `dy`. `STANDARD`, `ENTER`. |
| `hide(view, endVisibility)` | Fade to 0, then set `INVISIBLE` or `GONE` and restore alpha/translation. `STANDARD`, `EXIT`. |
| `swapText(textView, text)` | Fade out (`QUICK/2`), set text, fade in (`QUICK/2`). No-op when text is unchanged. |
| `emphasize(view, startDelay = 0)` | Make visible; scale 0.92→1 and fade 0→1. `EMPHASIS`, `ENTER`. |
| `setText(textView, text)` | Immediate text change for values that update many times a second (frame counter, recording timer). Cancels only a swap in flight. |
| `fadeTo(view, alpha, duration, interpolator, endAction)` | Plain alpha fade for views whose visibility is managed elsewhere (the landmark overlay). |
| `isShowing(view)` | Visible and not on its way out. |
| `pulse(view)` / `stopPulse(view)` | Repeating alpha 1↔0.45, 600 ms, reverse (the existing Tap Ready look). `stopPulse` restores alpha 1. |
| `tintTo(view, color)` | Animate `backgroundTintList` from current to `color`. `STANDARD`, `STANDARD_EASE`. |

### 3.3 Rules every helper follows

1. **Cancel, then start from the current value.** Each helper calls
   `view.animate().cancel()` (and cancels its own tracked animator, stored in a
   view tag) before starting. Rapid state changes never stack or snap back.
2. **Always land in the correct end state**, including visibility, even when
   interrupted: end values are applied in end actions / cancel paths, and a
   `hide` that is cancelled by a `reveal`/`emphasize` leaves the view visible.
3. **Reduced motion is automatic.** With the system animator scale at 0, Android
   completes these animators immediately and their end actions still run, so
   rule 2 gives correct final states with no extra branching.
4. Only `alpha`, `translationX/Y`, `scaleX/Y` and colour are animated — never
   layout properties.

## 4. Haptics — `Haptics.kt`

`object Haptics` using `View.performHapticFeedback`, which honours the system
touch-vibration setting and needs no permission.

| Event | Constant (API ≥ 30) | Fallback (API 24–29) |
|---|---|---|
| `tick(view)` — Tap recording starts or stops | `CLOCK_TICK` | `CLOCK_TICK` |
| `confirm(view)` — a word is recognized (either mode) | `CONFIRM` | `LONG_PRESS` |

Nothing vibrates while Live mode is only collecting frames.

## 5. Translator behaviour

All changes are in `MainActivity.kt`, using the helpers above.

| Moment | Today | New |
|---|---|---|
| Word recognized (`showResult`) | `cardResult` set `VISIBLE` | Card hidden → `emphasize(cardResult)`, then `tvFilipinoResult` `reveal` with an 80 ms delay. Card already showing a word → `swapText(tvResult)` (and `swapText` on the Filipino line) without replaying `emphasize`. Either way, `Haptics.confirm`. |
| Live result expiry | `postDelayed(… INVISIBLE, 2000)`, never cancelled | One tracked `hideResult` runnable: removed and re-posted on every result, then `hide(cardResult, INVISIBLE)`. **Fixes** an earlier result's timer hiding a newer result early. |
| Tap result lifetime | Stayed until replaced or mode switch | Stays while idle (the partner reads it); `hide` when the next sign is armed (IDLE → READY). Decided by user in Task 6. |
| Leaving the translator (`stopVision`) | Live timer kept running off screen | Result cleared at once (no animation, off screen) in **both** modes. |
| Mode switch clears result (`selectMode`) | `INVISIBLE` | Cancel `hideResult`; `hide(cardResult, INVISIBLE)`. |
| Hands lost (`onNoHands`) | `overlayView.clear()`; texts set | Overlay fades to 0 (`STANDARD`, `EXIT`), then `clear()` and alpha restored. `tvFrames` → `swapText("No hands")`. `tvHandsWarning` → `hide(GONE)`. |
| Hands appear | Overlay draws instantly | When landmarks arrive while the overlay is hidden/cleared, fade overlay alpha 0→1 (`QUICK`). Tracked by a boolean; **no per-frame animation**. |
| Live progress (`flushCollectingState`) | `progressBuffer.progress = pct` | `progressBuffer.setProgress(pct, true)` (platform animated progress, API 24+). Reset to 0 also animated. |
| Tap Idle/Ready/Recording/Processing (`renderTapState`) | Text/tint swapped | `btnTapRecord` text set directly (its alpha belongs to the Ready pulse, so a fading swap would fight it); tint via `tintTo` (`QUICK`). The recording timer text uses `setText`, first update delayed by `QUICK` so the prompt's swap completes. Ready uses `Motion.pulse`, replacing the local `ObjectAnimator` field. `tapRecordRing` `reveal`/`hide`. `Haptics.tick` on entering RECORDING and on leaving it for PROCESSING. |
| Tap prompts/messages (`tvTapPrompt`, `showTapMessage`) | `VISIBLE`/`GONE` | `reveal` / `hide(GONE)`; text changes while visible use `swapText`. |
| Status line (`setStatus`) | Text + dot tint set | `swapText(tvStatus)`; `tintTo(statusDot)`. |
| Segments Tap/Live, Words/Letters (`applySegmentStyle`) | Tint/text colour set | `tintTo` on the segment background (`QUICK`); text colour set directly. |

**Excluded:** the camera preview and the landmark skeleton itself. Animating
either would make the drawing lag the real hand.

### 5.1 Testable decisions — `TranslatorFeedback.kt`

The *decision* of what feedback a Tap state change produces is a pure function,
separate from views:

```kotlin
internal data class TapFeedback(val tick: Boolean, val pulse: Boolean, val ring: Boolean, val clearResult: Boolean)
internal fun tapFeedback(from: TapSignSession.State?, to: TapSignSession.State): TapFeedback
```

- `→ READY`: pulse, no tick, no ring; clears the previous result (not on a same-state re-render).
- `READY → RECORDING`: tick, ring, no pulse.
- `RECORDING → PROCESSING`: tick, no ring, no pulse.
- `→ IDLE` (cancel from any state, or done after PROCESSING): nothing. A
  cancel is not a "recording stopped for recognition", so it does not tick.
- Same state re-rendered (`from == to`): no tick (prevents a double buzz when
  `renderTapState` is called again without a real transition).

`MainActivity` tracks the last rendered Tap state to supply `from`.

## 6. Performance

- The ~15 Hz overlay/progress path gains no per-frame animation: the overlay
  fade triggers only on the empty↔non-empty edge, and animated progress is the
  platform's own.
- Verification: logcat `Choreographer: Skipped N frames` / `Davey` during 30 s
  of continuous Live recognition, before and after, on the reference device.
  No new entries is the bar.

## 7. Testing

- **Unit (JVM):** `TranslatorFeedbackTest` for every row of §5.1, including the
  same-state case.
- **On device:**
  - Live: result emphasizes and fades after 2 s; a second result within 2 s
    stays its full 2 s (the timer fix).
  - Tap: Ready pulse → Recording (tick, ring) → Recognizing (tick) → result
    (confirm); cancel from Ready produces no tick.
  - Prompts reveal/hide; status and segment colours ease.
  - "Remove animations" on: result, prompts, ring and overlay all end in the
    correct visibility.
  - No new skipped frames (§6).

## 8. Files

| File | Change |
|---|---|
| `Motion.kt` | New — tokens, easing, helpers (§3). |
| `Haptics.kt` | New — `tick`, `confirm` (§4). |
| `TranslatorFeedback.kt` | New — `tapFeedback` (§5.1). |
| `MainActivity.kt` | Use the above per §5; `hideResult` runnable; last-rendered Tap state; remove `tapPulse`. |
| `TranslatorFeedbackTest.kt` | New — unit tests. |
