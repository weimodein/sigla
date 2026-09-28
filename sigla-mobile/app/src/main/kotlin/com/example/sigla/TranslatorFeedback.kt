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
