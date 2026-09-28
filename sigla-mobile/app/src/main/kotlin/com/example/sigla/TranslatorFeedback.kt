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

/** What the landmark overlay does with one camera frame. */
internal enum class OverlayAction { DRAW, DRAW_AND_SHOW, HIDE, SKIP }

/**
 * Hands in frame: draw (fading in if hidden). No hands: do NOT draw the empty
 * frame — that blanks the skeleton instantly — but fade the last one out, once.
 * Decided per frame from two booleans, so the ~15 Hz path gains no animation.
 */
internal fun overlayAction(shown: Boolean, hasHands: Boolean): OverlayAction = when {
    hasHands && shown -> OverlayAction.DRAW
    hasHands -> OverlayAction.DRAW_AND_SHOW
    shown -> OverlayAction.HIDE
    else -> OverlayAction.SKIP
}

/**
 * Leaving the translator drops the Live result's hide timer, so a Live card must
 * go with it or it would still be up on return. A Tap result is meant to stay.
 */
internal fun clearResultOnStop(tapMode: Boolean): Boolean = !tapMode
