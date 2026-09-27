package com.example.sigla

internal const val TAP_READY_TIMEOUT_MS = 5_000L
internal const val TAP_MAX_RECORDING_MS = 4_000L
// Same count PredictionService uses (NO_HAND_TIMEOUT) to decide a sign has
// ended; at 24 fps it is also extract.py's 0.25 s MAX_MISSING_HAND_SECONDS.
internal const val TAP_STOP_AFTER_NO_HAND_FRAMES = 6

internal const val TAP_NOT_RECOGNIZED = "Not recognized — try again"
internal const val TAP_NO_HANDS_SEEN = "No hands seen — tap and try again"

/** User-facing copy for each rejection. Exhaustive: a new reason fails to compile. */
internal fun tapRejectionMessage(reason: ClipRejection): String = when (reason) {
    ClipRejection.NO_HANDS -> TAP_NO_HANDS_SEEN
    ClipRejection.MIN_HAND_FRAMES,
    ClipRejection.TOO_SHORT -> "Sign was too quick — try again, a little slower"
    ClipRejection.HAND_COVERAGE,
    ClipRejection.HAND_GAP,
    ClipRejection.TOO_SPARSE -> "Keep your hands in frame"
    ClipRejection.POSE_COVERAGE,
    ClipRejection.WINDOW_POSE -> "Step back so your shoulders are in view"
    ClipRejection.LOW_MOTION -> "No clear movement — try again"
}

/**
 * Tap mode's cycle: IDLE → (tap) → READY → (hands appear) → RECORDING →
 * (hands gone 6 frames / tap / 4 s) → PROCESSING → (finishProcessing) → IDLE.
 *
 * onFrame() is called on MediaPipe's callback thread and tap()/cancel() on the
 * UI thread, so every entry point is synchronized. The clock is injected for
 * tests. [generation] changes on every cancel, so a result computed for a
 * recording that was cancelled meanwhile can be recognised and dropped.
 */
class TapSignSession(private val clock: () -> Long) {

    enum class State { IDLE, READY, RECORDING, PROCESSING }

    sealed class Event {
        object Armed : Event()
        object Cancelled : Event()
        object RecordingStarted : Event()
        object NoHandsTimeout : Event()
        class Captured(val generation: Int, val frames: List<RecordedFrame>) : Event()
    }

    @get:Synchronized
    var state = State.IDLE
        private set

    private var generation = 0
    private var readySince = 0L
    private var recordingSince = 0L
    private var noHandRun = 0
    // The last few frames before the first hand, so the recording carries the
    // same leading pad extract.py's trim keeps (TRIM_PAD_FRAMES).
    private val preRoll = ArrayDeque<RecordedFrame>()
    private val frames = ArrayList<RecordedFrame>()

    @Synchronized
    fun tap(): Event? = when (state) {
        State.IDLE -> {
            state = State.READY
            readySince = clock()
            preRoll.clear()
            Event.Armed
        }
        State.READY -> { reset(); Event.Cancelled }
        State.RECORDING -> capture()
        State.PROCESSING -> null
    }

    @Synchronized
    fun onFrame(features: FloatArray, handsDetected: Int): Event? {
        if (state != State.READY && state != State.RECORDING) return null
        val now = clock()
        val detected = if (handsDetected > 0) features.copyOf() else null
        // Same rule as PredictionService.processFrame: a collapsed detection is
        // not a hand.
        val usable = detected != null && handExtentOk(detected)
        val frame = RecordedFrame(now, detected)

        if (state == State.READY) {
            if (usable) {
                frames.clear()
                frames.addAll(preRoll)
                frames.add(frame)
                preRoll.clear()
                state = State.RECORDING
                recordingSince = now
                noHandRun = 0
                return Event.RecordingStarted
            }
            if (now - readySince >= TAP_READY_TIMEOUT_MS) {
                reset()
                return Event.NoHandsTimeout
            }
            preRoll.addLast(frame)
            while (preRoll.size > TAP_TRIM_PAD_FRAMES) preRoll.removeFirst()
            return null
        }

        frames.add(frame)
        noHandRun = if (usable) 0 else noHandRun + 1
        if (noHandRun >= TAP_STOP_AFTER_NO_HAND_FRAMES ||
            now - recordingSince >= TAP_MAX_RECORDING_MS) {
            return capture()
        }
        return null
    }

    /** PROCESSING → IDLE. False when the recording was cancelled meanwhile,
     * in which case the caller must discard its result. */
    @Synchronized
    fun finishProcessing(generation: Int): Boolean {
        if (generation != this.generation || state != State.PROCESSING) return false
        state = State.IDLE
        return true
    }

    /** Any state → IDLE, discarding the recording and any pending result. */
    @Synchronized
    fun cancel() = reset()

    @Synchronized
    fun recordingElapsedMs(): Long =
        if (state == State.RECORDING) clock() - recordingSince else 0L

    private fun capture(): Event {
        state = State.PROCESSING
        val captured = Event.Captured(generation, frames.toList())
        frames.clear()
        return captured
    }

    private fun reset() {
        state = State.IDLE
        generation++
        frames.clear()
        preRoll.clear()
        noHandRun = 0
    }
}
