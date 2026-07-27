package com.example.sigla

import android.content.Context
import android.util.Log
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.FileInputStream
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.sqrt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// ── Constants ─────────────────────────────────────────────────────────────────
// Every sign is a motion gesture recognised by a single LSTM model over a
// sliding 30-frame window. There is no static model or static/motion race.
private const val TAG                    = "PredictionService"
private const val SEQUENCE_LENGTH        = 30    // LSTM input length
private const val FEATURE_SIZE           = 147   // 2 hands × 21 × 3 + 7 pose keypoints × 3
private const val MIN_MOTION_FRAMES      = 8      // begin inference once this many frames buffered
private const val MOTION_SLIDE_INTERVAL  = 2      // re-run the model every N frames
private const val MOTION_THRESHOLD       = 0.60f  // min confidence to accept a prediction
private const val MOTION_EARLY_CONF      = 0.60f  // confidence for early-exit streak counting
// Raised from 5/6 to 10/10 (2026-07-19) after simulating the live streak/early-exit logic
// against every real stored sample: at the old values, several signs that share an opening
// movement with another sign (GOOD EVENING/GOOD AFTERNOON, GOOD MORNING/HELLO, YES/YESTERDAY,
// HOW ARE YOU) could fire on that shared opening before the distinguishing tail of the
// gesture was ever captured (avg. fire point ~15/30 frames), causing wrong live predictions
// that never showed up in test.py's full-window evaluation. Requiring a longer streak fixed
// every one of those (94.3% -> 99.3% simulated early-fire accuracy across all 13 words) with
// no regression on any word that was already firing correctly. See PredictionService's
// runAndMaybeFire() for how this streak is counted.
private const val MOTION_EARLY_STREAK    = 10     // consistent frames before firing early
private const val EARLY_EXIT_THRESHOLD   = 0.95f  // very-high confidence fires immediately
private const val EARLY_EXIT_STREAK      = 10
private const val VELOCITY_WINDOW        = 8
private const val BUFFER_CAPACITY        = 90     // rolling frame buffer size
private const val NO_HAND_TIMEOUT        = 6      // frames with no hands before firing onNoHands
private const val BUFFER_FILL_MS         = 1500L  // run inference on the full window after this long
private const val DETECTION_COOLDOWN_MS  = 2000L  // wait before accepting the next gesture

// Key landmark indices for velocity (wrist + fingertips)
private val KEY_LANDMARKS = listOf(0, 4, 8, 12, 16, 20)
private val KEY_XY: List<Int> = KEY_LANDMARKS.flatMap { i -> listOf(i * 3, i * 3 + 1) }

// ── Data classes ──────────────────────────────────────────────────────────────
// isMotion is retained (always true) so existing callers compile unchanged.

data class PredictionResult(
    val label: String,
    val confidence: Float,
    val isMotion: Boolean = true,
    val earlyExit: Boolean = false
)

/**
 * A result decided under the lock but not yet delivered. Inference runs while
 * [PredictionService.lock] is held; onResult must be invoked after releasing it,
 * since the callback hops to the UI thread and the UI thread calls reset()/close().
 */
private data class PendingFire(val result: PredictionResult)

data class CollectingState(
    val progress: Float,
    val frames: Int,
    val velocity: Float,
    val isMotion: Boolean = true,
    val streak: Int = 0
)

// ── PredictionService ─────────────────────────────────────────────────────────

class PredictionService(private val context: Context) {

    // Callbacks
    var onResult: ((PredictionResult) -> Unit)? = null
    var onCollecting: ((CollectingState) -> Unit)? = null
    var onNoHands: (() -> Unit)? = null

    // Guards every mutable field below plus the interpreter's lifecycle.
    //
    // processFrame() runs on MediaPipe's result-callback thread while reset() and
    // close() are called from the UI thread (MainActivity's camera flip and
    // onStop/onDestroy). ArrayDeque is not thread-safe: a concurrent clear() against
    // addLast/removeFirst/toList could throw ConcurrentModificationException or
    // corrupt the deque. Worse, close() could null and free the interpreter between
    // runMotionInference's local-ref read and its interp.run() call — a native crash
    // that the Kotlin `catch` cannot intercept.
    private val lock = Any()

    // Model — @Volatile so isReady/motionInterp reads outside the lock see writes
    // from init()'s coroutine promptly.
    @Volatile private var motionInterp: Interpreter? = null
    private var motionLabels: List<String> = emptyList()

    @Volatile var isReady = false
        private set

    // Frame buffer
    private val frameBuffer  = ArrayDeque<FloatArray>()
    private var noHandFrames = 0
    private var collecting   = false
    private var bufStartTime = 0L
    private var framesSinceMotionRun = 0

    // Velocity tracking (for the collecting UI)
    private val velocityHistory = ArrayDeque<Float>()
    private var lastKeyXY: FloatArray? = null

    // Early-exit tracking
    private var motionEarlyStreak = 0
    private var motionEarlyLabel  = -1

    // Cooldown between detections
    private var lastDetectionTime = 0L

    // Pre-allocated output array (resized once labels are known)
    private var motionOutputArr: Array<FloatArray> = arrayOf(FloatArray(1))

    // ── Init ──────────────────────────────────────────────────────────────────
    fun getLabelCount(): Int = motionLabels.size

    /**
     * Loads the interpreter and waits for labels to arrive.
     *
     * Suspends until initialization actually finishes. The caller used to fire
     * this and then `delay(2000)` hoping labels had landed, which made every
     * entry to the camera screen sit idle for two seconds.
     */
    suspend fun init() {
        try {
            Log.d(TAG, "=== INIT START ===")
            val options = Interpreter.Options().apply { numThreads = 2 }

            // Load the model from assets or internal storage
            val motionBuf = withContext(Dispatchers.IO) {
                loadModelOrNull("sign_model_motion.tflite")
            }
            if (motionBuf == null) {
                Log.e(TAG, "Motion model not found")
                return
            }
            val interp = Interpreter(motionBuf, options)
            motionInterp = interp
            Log.d(TAG, "Interpreter created")

            val labels = withContext(Dispatchers.IO) { loadTrainedLabels() }
            if (labels == null) {
                interp.close()
                motionInterp = null
                return
            }

            // The model is the authority on how many classes exist. Sizing the
            // output buffer from the label list instead meant a labels/model
            // mismatch either threw into a silent catch or — when the counts
            // happened to agree but the contents didn't — mislabelled every
            // prediction with no warning at all.
            val outClasses = interp.getOutputTensor(0).shape().last()
            if (outClasses != labels.size) {
                Log.e(TAG, "Label/model mismatch: model has $outClasses classes but " +
                    "labels_motion.json has ${labels.size} — refusing to load rather than " +
                    "report wrong words. The labels file does not belong to this model.")
                interp.close()
                motionInterp = null
                return
            }

            // The input shape must be validated too, not just the class count.
            // SEQUENCE_LENGTH/FEATURE_SIZE are compile-time constants here but are
            // env-driven on the training side (sigla-ml preprocessor.py reads
            // FEATURE_SIZE/SEQUENCE_LENGTH from .env, and .env.example shipped 126 for
            // a long time). A model trained at a different width used to pass this
            // init untouched and then fail per-frame inside runMotionInference's bare
            // catch — returning null forever with no diagnostic. Fail loudly at load.
            val inShape = interp.getInputTensor(0).shape()   // expected [1, 30, 147]
            val inSeq   = inShape.getOrNull(inShape.size - 2) ?: -1
            val inFeat  = inShape.lastOrNull() ?: -1
            if (inSeq != SEQUENCE_LENGTH || inFeat != FEATURE_SIZE) {
                Log.e(TAG, "Model input shape mismatch: model expects " +
                    "${inShape.joinToString("x")} but this build feeds " +
                    "1x${SEQUENCE_LENGTH}x$FEATURE_SIZE — refusing to load. Retrain with " +
                    "matching FEATURE_SIZE/SEQUENCE_LENGTH or update the app constants.")
                interp.close()
                motionInterp = null
                return
            }

            motionLabels    = labels
            motionOutputArr = arrayOf(FloatArray(outClasses))
            isReady = true
            Log.i(TAG, "✅ Motion model loaded — $outClasses classes")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load motion model: ${e.message}", e)
        }
    }

    // Load a model buffer from filesDir (downloaded) first, then bundled assets.
    private fun loadModelOrNull(filename: String): MappedByteBuffer? {
        val local = File(context.filesDir, filename)
        if (local.exists()) {
            return try {
                Log.d(TAG, "Loading $filename from filesDir")
                FileInputStream(local).channel
                    .map(FileChannel.MapMode.READ_ONLY, 0, local.length())
            } catch (e: Exception) {
                Log.e(TAG, "Failed to map $filename from filesDir: ${e.message}")
                null
            }
        }
        return try {
            context.assets.openFd(filename).use { fd ->
                FileInputStream(fd.fileDescriptor).channel
                    .map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun loadLabelsOrNull(filename: String): List<String>? {
        val text = try {
            val local = File(context.filesDir, filename)
            if (local.exists()) local.readText()
            else context.assets.open(filename).bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            return null
        }
        return try {
            // labels file is a JSON object: { "0": "LABEL", "1": ... }
            //
            // Keys MUST be the contiguous range 0..size-1. optString() returns "" for a
            // missing key, so a file with a gap (e.g. {"0":..,"2":..}) used to yield the
            // right size, pass the count check in init(), and silently map one class to
            // the empty string. Training always writes a contiguous enumerate(), so a gap
            // means the file is damaged or hand-edited — reject it rather than guess.
            val obj  = org.json.JSONObject(text)
            val size = obj.length()
            val list = ArrayList<String>(size)
            for (i in 0 until size) {
                val key = i.toString()
                if (!obj.has(key)) {
                    Log.e(TAG, "Labels file is missing index $i (has $size entries) — " +
                        "class indices must be contiguous 0..${size - 1}. Refusing to load.")
                    return null
                }
                val label = obj.optString(key, "")
                if (label.isEmpty()) {
                    Log.e(TAG, "Labels file has an empty label at index $i — refusing to load.")
                    return null
                }
                list.add(label)
            }
            list
        } catch (_: Exception) {
            null
        }
    }

    // ── Frame processing ────────────────────────────────────────────────────────

    /**
     * Buffers one frame and runs inference when due.
     *
     * Called on MediaPipe's result-callback thread. All buffer/streak mutation happens
     * under [lock]; the UI callbacks are invoked AFTER releasing it, because they hop
     * to the main thread and the main thread itself calls reset()/close() — holding the
     * lock across them would risk deadlock.
     */
    fun processFrame(features: FloatArray, handsDetected: Int) {
        if (!isReady) return

        var notifyNoHands  = false
        var collectingState: CollectingState? = null
        var pending: PendingFire? = null

        synchronized(lock) {
            // No hands — count towards a timeout, then notify + reset.
            if (handsDetected == 0) {
                noHandFrames++
                if (noHandFrames >= NO_HAND_TIMEOUT && (collecting || frameBuffer.isNotEmpty())) {
                    // Flush: a FAST sign may have ended before the sliding window fired.
                    // If enough frames were collected, run one final forced inference so the
                    // just-completed gesture still gets classified (extractMotionWindow pads
                    // short sequences to SEQUENCE_LENGTH).
                    if (frameBuffer.size >= MIN_MOTION_FRAMES &&
                        System.currentTimeMillis() - lastDetectionTime >= DETECTION_COOLDOWN_MS
                    ) {
                        pending = runAndMaybeFire(System.currentTimeMillis(), force = true)
                    }
                    if (frameBuffer.isNotEmpty() || collecting) {
                        notifyNoHands = true
                        resetBuffers()
                    }
                }
                return@synchronized
            }
            noHandFrames = 0

            // Respect cooldown after a detection.
            val now = System.currentTimeMillis()
            if (now - lastDetectionTime < DETECTION_COOLDOWN_MS) return@synchronized

            // Buffer the frame.
            if (!collecting) {
                collecting = true
                bufStartTime = now
            }
            frameBuffer.addLast(features)
            while (frameBuffer.size > BUFFER_CAPACITY) frameBuffer.removeFirst()

            val meanVel  = computeVelocity(features)
            val progress = (frameBuffer.size.toFloat() / SEQUENCE_LENGTH).coerceAtMost(1f)
            collectingState = CollectingState(
                progress = progress, frames = frameBuffer.size, velocity = meanVel
            )

            // Run inference at most ONCE per frame. The time-based fallback takes priority:
            // once the window has been filling for a while it forces a run, otherwise the
            // sliding window runs every MOTION_SLIDE_INTERVAL frames.
            //
            // These two branches used to be independent `if`s, so past BUFFER_FILL_MS both
            // fired in the same processFrame — two full LSTM passes over the same buffer on
            // MediaPipe's callback thread, and (combined with the double-increment bug in
            // runAndMaybeFire) up to 4 streak increments per camera frame.
            framesSinceMotionRun++
            val forceRun = now - bufStartTime >= BUFFER_FILL_MS && frameBuffer.size >= SEQUENCE_LENGTH
            val slideRun = frameBuffer.size >= MIN_MOTION_FRAMES &&
                           framesSinceMotionRun >= MOTION_SLIDE_INTERVAL
            if (forceRun) {
                framesSinceMotionRun = 0
                pending = runAndMaybeFire(now, force = true)
            } else if (slideRun) {
                framesSinceMotionRun = 0
                pending = runAndMaybeFire(now)
            }
        }

        // Callbacks outside the lock.
        if (notifyNoHands) onNoHands?.invoke()
        collectingState?.let { onCollecting?.invoke(it) }
        pending?.let { onResult?.invoke(it.result) }
    }

    /**
     * Runs inference and decides whether to fire. Caller must hold [lock].
     *
     * Returns the result to deliver, or null if nothing should fire. The caller
     * invokes onResult outside the lock — see processFrame.
     */
    private fun runAndMaybeFire(now: Long, force: Boolean = false): PendingFire? {
        val result = runMotionInference(frameBuffer.toList()) ?: return null
        val (idx, conf) = result
        val label = motionLabels.getOrNull(idx) ?: return null

        // Count the streak EXACTLY ONCE per inference. The two confidence tiers below
        // must stay mutually exclusive: EARLY_EXIT_THRESHOLD (0.95) is above
        // MOTION_EARLY_CONF (0.60), so a frame clearing the high bar also clears the
        // low one. Incrementing in both branches (the pre-2026-07-27 shape) advanced
        // the streak twice per inference for exactly the high-confidence frames the
        // streak exists to slow down, so MOTION_EARLY_STREAK=10 was really reached in
        // 5 — silently undoing most of the 94.3% -> 99.3% early-fire gain documented
        // on MOTION_EARLY_STREAK above.
        if (conf >= MOTION_EARLY_CONF) {
            if (motionEarlyLabel == idx) motionEarlyStreak++ else { motionEarlyLabel = idx; motionEarlyStreak = 1 }
        } else {
            motionEarlyStreak = 0
            motionEarlyLabel  = -1
        }

        // Immediate fire on very high confidence.
        if (conf >= EARLY_EXIT_THRESHOLD) {
            if (motionEarlyStreak >= EARLY_EXIT_STREAK || force) {
                return fire(label, conf, earlyExit = true, now)
            }
        } else if (conf >= MOTION_EARLY_CONF) {
            // Streak-based early exit at normal confidence.
            if (motionEarlyStreak >= MOTION_EARLY_STREAK) {
                return fire(label, conf, earlyExit = false, now)
            }
        }

        // Forced (time-based) run: accept the top prediction if it clears the threshold.
        if (force && conf >= MOTION_THRESHOLD) {
            return fire(label, conf, earlyExit = false, now)
        }
        return null
    }

    /** Records the detection and resets state. Caller must hold [lock]. */
    private fun fire(label: String, conf: Float, earlyExit: Boolean, now: Long): PendingFire {
        lastDetectionTime = now
        resetBuffers()
        return PendingFire(
            PredictionResult(label = label, confidence = conf, isMotion = true, earlyExit = earlyExit)
        )
    }

    // ── Motion inference ──────────────────────────────────────────────────────

    private fun runMotionInference(frames: List<FloatArray>): Pair<Int, Float>? {
        val interp = motionInterp ?: return null
        if (frames.size < MIN_MOTION_FRAMES) return null

        val seq = extractMotionWindow(frames)
        if (seq.any { it.size != FEATURE_SIZE }) {
            Log.w(TAG, "Motion inference skipped — frame with wrong feature size (expected $FEATURE_SIZE)")
            return null
        }
        val input = Array(1) { Array(SEQUENCE_LENGTH) { i -> seq[i] } }
        return try {
            interp.run(input, motionOutputArr)
            val probs = motionOutputArr[0]
            val idx   = probs.indices.maxByOrNull { probs[it] } ?: return null
            Pair(idx, probs[idx])
        } catch (_: Exception) { null }
    }

    // Centre a 30-frame window on the peak-velocity frame — mirrors the training-time
    // center_on_peak_velocity() so inference sees the same temporal alignment.
    private fun extractMotionWindow(frames: List<FloatArray>): List<FloatArray> {
        if (frames.size == SEQUENCE_LENGTH) return frames

        if (frames.size < SEQUENCE_LENGTH) {
            // Pad by repeating the last frame.
            val padded = frames.toMutableList()
            while (padded.size < SEQUENCE_LENGTH) padded.add(padded.last())
            return padded.take(SEQUENCE_LENGTH)
        }

        var peakIdx = frames.size / 2
        var peakVel = 0f
        for (i in 1 until frames.size) {
            var sum = 0f
            for (j in KEY_XY) {
                val d = frames[i][j] - frames[i - 1][j]
                sum += d * d
            }
            val v = sqrt(sum)
            if (v > peakVel) { peakVel = v; peakIdx = i }
        }

        val half  = SEQUENCE_LENGTH / 2
        var start = (peakIdx - half).coerceAtLeast(0)
        var end   = start + SEQUENCE_LENGTH
        if (end > frames.size) { end = frames.size; start = (end - SEQUENCE_LENGTH).coerceAtLeast(0) }

        val window = frames.subList(start, end).toMutableList()
        while (window.size < SEQUENCE_LENGTH) window.add(window.last())
        return window.take(SEQUENCE_LENGTH)
    }

    // ── Velocity (for the collecting UI) ──────────────────────────────────────

    private fun computeVelocity(features: FloatArray): Float {
        val keyXY    = KEY_XY.map { features[it] }.toFloatArray()
        val prev     = lastKeyXY
        lastKeyXY    = keyXY
        val instantV = if (prev != null) euclideanDist(keyXY, prev) else 0f
        velocityHistory.addLast(instantV)
        if (velocityHistory.size > VELOCITY_WINDOW) velocityHistory.removeFirst()
        return velocityHistory.average().toFloat()
    }

    private fun euclideanDist(a: FloatArray, b: FloatArray): Float {
        var sum = 0f
        for (i in a.indices) { val d = a[i] - b[i]; sum += d * d }
        return sqrt(sum)
    }

    // ── Reset / cleanup ───────────────────────────────────────────────────────

    private fun resetBuffers() {
        frameBuffer.clear()
        velocityHistory.clear()
        lastKeyXY            = null
        collecting           = false
        bufStartTime         = 0L
        framesSinceMotionRun = 0
        motionEarlyStreak    = 0
        motionEarlyLabel     = -1
    }

    fun reset() = synchronized(lock) {
        resetBuffers()
        noHandFrames = 0
    }

    /**
     * Releases the interpreter.
     *
     * Safe to call more than once — the activity tears down in onStop() and
     * again defensively in onDestroy(). No scope to cancel: labels now load
     * from a local file inside init()'s own coroutine, which the caller
     * (MainActivity's modelInitJob) already cancels.
     */
    fun close() = synchronized(lock) {
        // Under the lock so we cannot free the interpreter while runMotionInference
        // is mid-run() on MediaPipe's thread — that frees native memory out from
        // under an in-flight call, and the resulting SIGSEGV is not catchable.
        isReady = false
        motionInterp?.close()
        motionInterp = null
        resetBuffers()
    }

    /**
     * Loads the class-index → label map that the model was trained with.
     *
     * `labels_motion.json` is the ONLY valid source: training builds it from
     * `sorted(real.keys())` (sigla-ml preprocessor.prepare_motion_dataset) and it
     * ships alongside the .tflite, so index N here is the word the model means by
     * output N.
     *
     * This used to fall back to the word-bank API and derive labels from
     * `words.map { it.label }`. That is a different population with different
     * ordering rules — it only contains `is_active` words, while a trained class
     * is any word that had usable samples. A word present in one and not the
     * other shifts every subsequent index, so the model would report a real
     * prediction under a neighbouring word's name, at full confidence. Worse, the
     * fallback cached its result to this same path, so one bad fetch poisoned
     * every later launch. There is no safe way to reconstruct this map from
     * another table: no labels file means the model cannot be used.
     */
    private fun loadTrainedLabels(): List<String>? {
        val labels = loadLabelsOrNull("labels_motion.json")
        if (labels.isNullOrEmpty()) {
            Log.e(TAG, "labels_motion.json missing or empty — cannot map model outputs to words. " +
                "It is downloaded with the model by ModelUpdateManager.")
            return null
        }
        Log.d(TAG, "Loaded ${labels.size} trained labels")
        return labels
    }
}
