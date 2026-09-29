package com.example.sigla

import com.example.sigla.TapSignSession.State

/**
 * What a Tap state change should look and feel like — spec §5.1. Pure, so the
 * rules are tested without a device; MainActivity applies the result to views.
 */
internal data class TapFeedback(
    val tick: Boolean,
    val pulse: Boolean,
    val ring: Boolean,
    // Arming the next sign clears the previous word, so it cannot be mistaken
    // for the new result. Idle keeps it up for the partner to read.
    val clearResult: Boolean,
)

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
        clearResult = changed && to == State.READY,
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
 * Leaving the translator clears the result in both modes: Live drops its hide
 * timer on stop, and in Tap a word still up on return would read as fresh.
 * Kept as a function (with the mode) so the rule stays pinned by a test.
 */
@Suppress("UNUSED_PARAMETER")
internal fun clearResultOnStop(tapMode: Boolean): Boolean = true
