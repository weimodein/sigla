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
// FEATURE_SIZE (147) comes from HandLandmarkHelper.kt — the file that actually
// builds the vector. Declaring a second copy here would let the two drift apart.
// Minimum real frames before inference runs. extractMotionWindow pads a short buffer by
// repeating its last frame, so this directly sets how much of the model's 30-frame input
// may be frozen padding: at 8 real frames, 22 of 30 (73%) were one repeated frame — far
// outside anything the model was trained on, yet still able to fire.
//
// 12 matches the training-side truncated-prefix augmentation floor
// (PREFIX_KEEP_MIN = 0.40 of 30 frames = 12), so the shortest buffer inference accepts is
// the shortest prefix training actually saw. Raising it further would delay fast signs;
// this is the point where the two sides agree.
private const val MIN_MOTION_FRAMES      = 12     // begin inference once this many frames buffered
private const val MOTION_SLIDE_INTERVAL  = 2      // re-run the model every N frames
private const val MOTION_THRESHOLD       = 0.70f  // min confidence to accept a prediction
private const val MOTION_EARLY_CONF      = 0.70f  // confidence for early-exit streak counting
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
private const val EARLY_EXIT_THRESHOLD   = 0.95f  // very-high confidence fires sooner
// Shorter than MOTION_EARLY_STREAK on purpose — this tier only exists to fire FASTER
// when the model is very confident.
//
// It used to equal MOTION_EARLY_STREAK (both 10), which made the tier unreachable: the
// streak resets whenever confidence drops below MOTION_EARLY_CONF, so any run of 10
// consecutive >=0.95 frames necessarily also satisfied the 10-frame low-confidence tier
// that is checked in the same pass. The high-confidence branch therefore never fired on
// its own merit — only via `force`. 4 keeps a real consistency requirement (4 agreeing
// inferences at >=0.95) while actually arriving sooner than the normal path.
private const val EARLY_EXIT_STREAK      = 4
private const val BUFFER_CAPACITY        = 90     // rolling frame buffer size
private const val NO_HAND_TIMEOUT        = 6      // frames with no hands before firing onNoHands
private const val BUFFER_FILL_MS         = 1500L  // run inference on the full window after this long
private const val DETECTION_COOLDOWN_MS  = 2000L  // wait before accepting the next gesture

// Latency instrumentation. Tied to BuildConfig.DEBUG so release builds skip the timing
// calls entirely. (`val`, not `const val` — BuildConfig.DEBUG is a generated field, not
// a compile-time constant.)
private val LATENCY_LOGGING         = BuildConfig.DEBUG
private const val LATENCY_WINDOW    = 100   // rolling samples kept for percentiles
private const val LATENCY_LOG_EVERY = 20    // emit a summary every N inferences

// ── Velocity signal for temporal window selection ────────────────────────────
//
// Measured on the POSE WRIST keypoints, NOT the hand blocks.
//
// HandLandmarkHelper.normalizeHandBlock wrist-centers each hand (landmark 0
// becomes exactly (0,0,0)) and divides by hand size, which removes ALL whole-hand
// translation and leaves only finger articulation — while for most signs the
// discriminative motion IS the hand's trajectory. The old signal also read only
// hand slot 0 and included landmark 0, so it summed an identically-zero term and
// went blind on left-hand-only sequences (data in slot 1).
//
// normalizePoseBlock centers on the SHOULDER MIDPOINT and scales by shoulder
// width, so pose wrists keep full arm translation, scale-invariant, and are
// anatomically left/right rather than detection-slot-ordered.
//
// MUST stay byte-identical to sigla-ml preprocessor._POSE_WRIST_XY / frame_velocity.
// POSE_BASE/FEATURE_SIZE come from HandLandmarkHelper.kt (single source of truth).
private const val POSE_LWRIST = 5   // local pose-block index (mediapipe landmark 15)
private const val POSE_RWRIST = 6   // local pose-block index (mediapipe landmark 16)
private val POSE_WRIST_XY = intArrayOf(
    POSE_BASE + POSE_LWRIST * 3, POSE_BASE + POSE_LWRIST * 3 + 1,
    POSE_BASE + POSE_RWRIST * 3, POSE_BASE + POSE_RWRIST * 3 + 1,
)

// Fallback when either frame has the 21-zero absent-pose sentinel: fingertip x,y
// of BOTH hand slots. Landmark 0 is excluded — post-normalization it is exactly 0.
private val FALLBACK_LANDMARKS = intArrayOf(4, 8, 12, 16, 20)
private val FALLBACK_XY: IntArray = (0..1).flatMap { hand ->
    FALLBACK_LANDMARKS.flatMap { i -> listOf(hand * 63 + i * 3, hand * 63 + i * 3 + 1) }
}.toIntArray()

private fun posePresent(frame: FloatArray): Boolean {
    for (k in POSE_BASE until FEATURE_SIZE) if (frame[k] != 0f) return true
    return false
}

/** L2 velocity between two consecutive NORMALIZED frames.
 *  MUST match sigla-ml preprocessor.frame_velocity byte-for-byte. */
internal fun frameVelocity(prev: FloatArray, cur: FloatArray): Float {
    val idxs = if (posePresent(prev) && posePresent(cur)) POSE_WRIST_XY else FALLBACK_XY
    var total = 0f
    for (j in idxs) {
        val d = cur[j] - prev[j]
        total += d * d
    }
    return sqrt(total)
}

// Temporal window search parameters. MUST match sigla-ml preprocessor.py
// (VELOCITY_SMOOTH_WINDOW / VELOCITY_EDGE_MARGIN).
//
// Training clips are "raise, sign, lower": the ENTRY movement is a bigger velocity
// spike than the sign itself. Measured on a real stored clip, the hand-raise hit
// 0.4844 at frame 2 while the actual gesture peaked at 0.2098 (f16) and 0.1861
// (f22) — ~2.3x smaller. A plain argmax therefore centres on the hand-raise and
// cuts off the sign, which is what made GOOD MORNING / GOOD AFTERNOON / I'M FINE
// mutually confusable: each one just looks like "hands coming up".
//
// Smoothing alone is not enough (the entry spike is broad as well as tall — a
// smoothed argmax still picked frame 3); the edge margin is what moves the pick
// onto the real sign. Margins from 0.15 to 0.30 converge on the same frame.
//
// Verified safe for live inference: the delivered window shifts while the buffer
// is small but stabilises by ~35 frames, and the earliest possible fire is
// MIN_MOTION_FRAMES + MOTION_EARLY_STREAK * MOTION_SLIDE_INTERVAL = 8 + 20 = 28
// frames, with the buffer still growing through the streak. So the margin does
// not delay firing.
private const val VELOCITY_SMOOTH_WINDOW = 5
private const val VELOCITY_EDGE_MARGIN   = 0.20

// Two smoothed velocities within this are treated as tied. Sized well above
// float32-vs-float64 rounding but far below any real difference in movement.
private const val VELOCITY_TIE_EPS = 1e-5f

/** Index of the frame that best represents the gesture's motion.
 *  MUST stay byte-identical to sigla-ml preprocessor.peak_velocity_index. */
internal fun peakVelocityIndex(frames: List<FloatArray>): Int {
    val n = frames.size
    if (n < 2) return 0

    val vel = FloatArray(n - 1) { i -> frameVelocity(frames[i], frames[i + 1]) }

    // Moving average, centred — mirrors numpy convolve(mode="same"). The shorter
    // effective window at the ends is harmless because the ends are excluded below.
    val smoothed: FloatArray
    if (vel.size >= VELOCITY_SMOOTH_WINDOW) {
        smoothed = FloatArray(vel.size)
        val half = VELOCITY_SMOOTH_WINDOW / 2
        for (i in vel.indices) {
            var sum = 0f
            for (k in -half..half) {
                val j = i + k
                if (j in vel.indices) sum += vel[j]
            }
            smoothed[i] = sum / VELOCITY_SMOOTH_WINDOW
        }
    } else {
        smoothed = vel
    }

    var lo = (vel.size * VELOCITY_EDGE_MARGIN).toInt()
    var hi = vel.size - lo
    if (hi <= lo) {
        // Too short to trim — search everything rather than return nothing.
        lo = 0
        hi = vel.size
    }

    // Ties are the normal case, not an edge case: smoothing a single sharp spike
    // over VELOCITY_SMOOTH_WINDOW frames produces a flat plateau where several
    // frames share the maximum. Kotlin accumulates in float32 and Python in
    // float64, so "pick whichever compares greater" resolves those plateaus
    // differently on the two sides and the windows silently diverge — this was
    // caught by FeatureParityTest as a 1-frame disagreement.
    //
    // Break ties on distance from the sequence centre, which is deterministic
    // across languages and the better choice anyway.
    val centre = vel.size / 2.0
    var best = lo
    for (i in lo until hi) {
        if (smoothed[i] > smoothed[best] + VELOCITY_TIE_EPS) {
            best = i
        } else if (kotlin.math.abs(smoothed[i] - smoothed[best]) <= VELOCITY_TIE_EPS) {
            if (kotlin.math.abs(i - centre) < kotlin.math.abs(best - centre)) best = i
        }
    }
    return best + 1
}

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

/**
 * Why a forced inference was requested. The two cases must not behave the same.
 *
 * [NONE]           — normal sliding-window run; all streak requirements apply.
 * [TIMER]          — BUFFER_FILL_MS elapsed while the signer is STILL SIGNING. The
 *                    gesture is incomplete, so this must not bypass the streak: doing so
 *                    lets a single high-confidence frame fire on a shared opening
 *                    movement, which is exactly what raising the streak to 10 fixed.
 * [END_OF_GESTURE] — hands left the frame. The gesture is over and this is the last
 *                    chance to classify it, so bypassing the streak is correct here;
 *                    the alternative is dropping a completed fast sign entirely.
 */
private enum class ForceReason { NONE, TIMER, END_OF_GESTURE }

/**
 * Progress of the in-flight gesture, delivered to the UI once per buffered frame.
 *
 * Previously also carried `velocity`, `isMotion` and `streak`. None had a reader:
 * `velocity` was never consulted, and `isMotion`/`streak` were declared with
 * defaults that the sole construction site never overrode — so the UI re-rendered
 * a constant "● MOTION" label (resolving a colour through Resources each time) and
 * re-took the same `streak == 0` branch on every frame at ~15 Hz. Computing
 * `velocity` also boxed 12 floats per frame through a List<Float>.
 */
data class CollectingState(
    val progress: Float,
    val frames: Int
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

    // Set by reset() from the UI thread without taking the lock; consumed at the top
    // of the next processFrame on MediaPipe's thread. See reset().
    @Volatile private var resetRequested = false

    // Early-exit tracking
    private var motionEarlyStreak = 0
    private var motionEarlyLabel  = -1

    // Cooldown between detections
    private var lastDetectionTime = 0L

    // Pre-allocated output array, sized from the MODEL's class count in init().
    //
    // Written once in init() without holding `lock`, then read/written by
    // runMotionInference under the lock. That is safe only because of publication
    // ordering: it is assigned BEFORE the `isReady = true` volatile write, and
    // processFrame returns early unless it observes isReady == true. A volatile write
    // publishes every preceding write, so any thread that sees isReady also sees the
    // correctly-sized array.
    //
    // Keep the assignment before `isReady = true`. Moving it after would leave the
    // 1-element placeholder visible to an in-flight frame and overflow on interp.run().
    private var motionOutputArr: Array<FloatArray> = arrayOf(FloatArray(1))

    /**
     * Reused input tensor, shape [1, SEQUENCE_LENGTH, FEATURE_SIZE].
     *
     * The inner FloatArrays are references INTO the frame buffer, not copies —
     * exactly as when this was allocated per call. Filled and consumed entirely
     * within a single runMotionInference under [lock], so no in-flight run can
     * observe a half-written tensor.
     *
     * Allocated at declaration rather than in init(), so it is safe to publish
     * before isReady like motionOutputArr above; its shape depends only on
     * compile-time constants, which init() has already validated against the
     * model's input tensor.
     */
    private val motionInputArr: Array<Array<FloatArray>> =
        arrayOf(Array(SEQUENCE_LENGTH) { FloatArray(0) })

    /**
     * Scratch list for the window passed to extractMotionWindow — replaces a
     * frameBuffer.toList() that copied up to BUFFER_CAPACITY references per
     * inference. Only ever touched under [lock].
     */
    private val frameSnapshot = ArrayList<FloatArray>(BUFFER_CAPACITY)

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
            // Honour a reset requested from the UI thread since the last frame.
            // Cleared before the buffers are touched so a request arriving during
            // this block is not swallowed — it will be seen on the next frame.
            if (resetRequested) {
                resetRequested = false
                resetBuffers()
                noHandFrames = 0
            }

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
                        pending = runAndMaybeFire(
                            System.currentTimeMillis(), force = ForceReason.END_OF_GESTURE
                        )
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

            val progress = (frameBuffer.size.toFloat() / SEQUENCE_LENGTH).coerceAtMost(1f)
            collectingState = CollectingState(progress = progress, frames = frameBuffer.size)

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
                pending = runAndMaybeFire(now, force = ForceReason.TIMER)
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
    private fun runAndMaybeFire(now: Long, force: ForceReason = ForceReason.NONE): PendingFire? {
        // Reused snapshot instead of frameBuffer.toList(). Same contents and order;
        // extractMotionWindow only reads it (indexed access and subList).
        frameSnapshot.clear()
        frameSnapshot.addAll(frameBuffer)

        val idx = runMotionInference(frameSnapshot)
        if (idx < 0) return null
        val conf  = motionOutputArr[0][idx]
        val label = motionLabels.getOrNull(idx) ?: return null

        // Count the streak EXACTLY ONCE per inference. The two confidence tiers below
        // must stay mutually exclusive: EARLY_EXIT_THRESHOLD (0.95) is above
        // MOTION_EARLY_CONF (0.70), so a frame clearing the high bar also clears the
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

        // Only the end-of-gesture flush may bypass the streak — see ForceReason. A TIMER
        // force fires mid-gesture, so letting one frame through there re-opens the
        // "fires on a shared opening movement" failure the 10-frame streak fixed.
        val mayBypassStreak = force == ForceReason.END_OF_GESTURE

        // Very high confidence: fires on a SHORTER streak than the normal path.
        if (conf >= EARLY_EXIT_THRESHOLD) {
            if (motionEarlyStreak >= EARLY_EXIT_STREAK || mayBypassStreak) {
                return fire(label, conf, earlyExit = true, now)
            }
        } else if (conf >= MOTION_EARLY_CONF) {
            // Streak-based early exit at normal confidence.
            if (motionEarlyStreak >= MOTION_EARLY_STREAK) {
                return fire(label, conf, earlyExit = false, now)
            }
        }

        // Forced run: accept the top prediction if it clears the acceptance threshold.
        //
        // END_OF_GESTURE accepts immediately (last chance to classify a finished sign).
        // TIMER still requires the streak, so a mid-gesture timer cannot short-circuit
        // the consistency check — it only guarantees an inference happens, not a fire.
        if (conf >= MOTION_THRESHOLD) {
            if (mayBypassStreak) {
                return fire(label, conf, earlyExit = false, now)
            }
            if (force == ForceReason.TIMER && motionEarlyStreak >= MOTION_EARLY_STREAK) {
                return fire(label, conf, earlyExit = false, now)
            }
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

    /**
     * Runs one LSTM pass. Caller must hold [lock].
     *
     * Returns the argmax class index, or -1 if nothing ran. The confidence is left
     * in `motionOutputArr[0][idx]` for the caller to read, which avoids boxing an
     * index and a float into a Pair on every inference.
     */
    private fun runMotionInference(frames: List<FloatArray>): Int {
        val interp = motionInterp ?: return -1
        if (frames.size < MIN_MOTION_FRAMES) return -1

        val seq = extractMotionWindow(frames)
        for (frame in seq) {
            if (frame.size != FEATURE_SIZE) {
                Log.w(TAG, "Motion inference skipped — frame with wrong feature size (expected $FEATURE_SIZE)")
                return -1
            }
        }

        // Reused tensor; the inner references are rebound to this window's frames.
        val row = motionInputArr[0]
        for (i in 0 until SEQUENCE_LENGTH) row[i] = seq[i]

        val startNs = if (LATENCY_LOGGING) System.nanoTime() else 0L
        return try {
            interp.run(motionInputArr, motionOutputArr)
            if (LATENCY_LOGGING) recordLatency((System.nanoTime() - startNs) / 1_000_000.0)

            // Plain loop rather than probs.indices.maxByOrNull, which allocated an
            // IntRange and iterator and boxed the result. Strict `>` keeps
            // maxByOrNull's first-wins behaviour on ties.
            val probs = motionOutputArr[0]
            if (probs.isEmpty()) return -1
            var best = 0
            for (i in 1 until probs.size) {
                if (probs[i] > probs[best]) best = i
            }
            best
        } catch (_: Exception) { -1 }
    }

    // ── Latency instrumentation ───────────────────────────────────────────────
    //
    // The firing constants (MOTION_SLIDE_INTERVAL, the streak lengths) and the
    // camera-side frame skip were all tuned without a single measurement of how long
    // an inference actually takes. Every LSTM pass runs on MediaPipe's callback thread
    // while holding `lock`, so a slow pass delays the next frame AND blocks
    // reset()/close() from the UI thread — but nothing here reported it.
    //
    // Caller must hold [lock] (called from runMotionInference).
    private val latencySamples = ArrayDeque<Double>()
    private var latencyLogged  = 0

    private fun recordLatency(ms: Double) {
        latencySamples.addLast(ms)
        while (latencySamples.size > LATENCY_WINDOW) latencySamples.removeFirst()

        if (++latencyLogged % LATENCY_LOG_EVERY != 0 || latencySamples.size < 10) return
        val sorted = latencySamples.sorted()
        val p50 = sorted[sorted.size / 2]
        val p95 = sorted[(sorted.size * 95) / 100]
        Log.d(TAG, "inference latency over last ${sorted.size}: " +
            "p50=%.1fms p95=%.1fms max=%.1fms".format(p50, p95, sorted.last()))
    }

    // Centre a 30-frame window on the peak-velocity frame — mirrors the training-time
    // center_on_peak_velocity() so inference sees the same temporal alignment.
    //
    // The `size == SEQUENCE_LENGTH` early return below is an identity, not a shortcut:
    // with exactly 30 frames the only possible window IS [0:30]. It is kept because it
    // is free and matches sigla-ml's default path.
    //
    // On the EXTRACTION side the same branch was a real bug — extract.py fed it clips
    // that happened to survive at exactly 30 frames, so they were stored with no window
    // ever selected and the velocity signal never consulted. That path now resamples
    // above SEQUENCE_LENGTH first and passes force=True. Here it is harmless: the live
    // buffer holds MIN_MOTION_FRAMES..BUFFER_CAPACITY (8..90) frames and only lands on
    // exactly 30 transiently. Do NOT "fix" this side to match without re-checking
    // parity — the two must agree on what a 30-frame input yields.
    private fun extractMotionWindow(frames: List<FloatArray>): List<FloatArray> {
        if (frames.size == SEQUENCE_LENGTH) return frames

        if (frames.size < SEQUENCE_LENGTH) {
            // Pad by repeating the last frame.
            val padded = frames.toMutableList()
            while (padded.size < SEQUENCE_LENGTH) padded.add(padded.last())
            return padded.take(SEQUENCE_LENGTH)
        }

        val peakIdx = peakVelocityIndex(frames)

        val half  = SEQUENCE_LENGTH / 2
        var start = (peakIdx - half).coerceAtLeast(0)
        var end   = start + SEQUENCE_LENGTH
        if (end > frames.size) { end = frames.size; start = (end - SEQUENCE_LENGTH).coerceAtLeast(0) }

        val window = frames.subList(start, end).toMutableList()
        while (window.size < SEQUENCE_LENGTH) window.add(window.last())
        return window.take(SEQUENCE_LENGTH)
    }

    // ── Reset / cleanup ───────────────────────────────────────────────────────

    private fun resetBuffers() {
        frameBuffer.clear()
        collecting           = false
        bufStartTime         = 0L
        framesSinceMotionRun = 0
        motionEarlyStreak    = 0
        motionEarlyLabel     = -1
    }

    /**
     * Requests that the frame buffer and streak state be cleared.
     *
     * Deliberately does NOT take [lock]. This is called from the UI thread (the
     * camera-flip button), and an LSTM pass runs on MediaPipe's callback thread
     * while holding that lock — so acquiring it here blocked the tap for the
     * duration of a full inference.
     *
     * Instead the request is flagged and honoured at the top of the next
     * [processFrame]. The reset therefore lands up to one frame later, which is
     * immaterial: the flip already rebinds the camera, and resetHandednessLatch()
     * introduces a multi-frame gap of its own.
     */
    fun reset() {
        resetRequested = true
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
