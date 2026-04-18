package com.example.sigla

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.FileInputStream
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.sqrt

// ── Constants ─────────────────────────────────────────────────────────────────
private const val TAG                    = "PredictionService"
private const val SEQUENCE_LENGTH        = 30    // model input size
private const val MIN_MOTION_FRAMES      = 8     // start running motion inference early
private const val MOTION_SLIDE_INTERVAL  = 2     // re-run motion every N frames
private const val MOTION_EARLY_CONF      = 0.80f // motion must be confident before early exit fires
private const val MOTION_EARLY_STREAK    = 7     // more consecutive hits needed to fire early
private const val MOTION_VELOCITY_STREAK = 17    // more sustained frames of movement required before probing motion
private const val STATIC_THRESHOLD          = 0.55f
private const val MOTION_THRESHOLD          = 0.70f // raised — motion must win decisively in dual-race
private const val MOTION_DOMINANCE_MARGIN   = 0.15f // motion must exceed static confidence by this margin
private const val STATIC_SUPPRESS_STREAK    = 8     // sustained high-velocity frames needed before suppressing static early-exit
private const val VELOCITY_WINDOW           = 8
private const val MOTION_VELOCITY_THRESH    = 0.030f // higher — filters out small hand repositioning
private const val EARLY_EXIT_STREAK         = 4
private const val EARLY_EXIT_THRESHOLD      = 0.95f
private const val STATIC_AVG_FRAMES      = 7     // matches STATIC_FRAMES_PER_SAMPLE in CollectionActivity
private const val STATIC_INFERENCE_INTERVAL = 2  // run static model every N frames to halve CPU cost
private const val BUFFER_CAPACITY        = 90    // supports time-based buffering
private const val NO_HAND_TIMEOUT        = 6
private const val BUFFER_FILL_MS         = 1500L // fire dual-race after 1.5s (time-based)
private const val DETECTION_COOLDOWN_MS  = 2000L  // wait before accepting next gesture
private const val MOTION_SETTLE_MS       = 2000L  // time after a motion detection before motion probe re-arms

// Key landmark indices for velocity (wrist + fingertips)
private val KEY_LANDMARKS = listOf(0, 4, 8, 12, 16, 20)
private val KEY_XY: List<Int> = KEY_LANDMARKS.flatMap { i ->
    listOf(i * 3, i * 3 + 1)
}

// Static labels that share a starting pose with a known motion gesture.
// Only these labels get suppressed when velocity is rising — all others fire normally.
private val MOTION_CONFLICTS = mapOf(
    "is" to "J",
    "I"  to "J",
    "z"  to "Z",
    "s"  to "Z"
)

// ── Data classes ──────────────────────────────────────────────────────────────

data class PredictionResult(
    val label: String,
    val confidence: Float,
    val isMotion: Boolean,
    val earlyExit: Boolean = false
)

data class CollectingState(
    val progress: Float,
    val frames: Int,
    val velocity: Float,
    val isMotion: Boolean,
    val streak: Int
)

data class GestureConfig(
    val oneHanded: Boolean,
    val normalizeHand: Boolean,
    val motion: Boolean
)

// ── PredictionService ─────────────────────────────────────────────────────────

class PredictionService(private val context: Context) {

    // Callbacks
    var onResult: ((PredictionResult) -> Unit)? = null
    var onCollecting: ((CollectingState) -> Unit)? = null
    var onNoHands: (() -> Unit)? = null

    // Models
    private var staticInterp: Interpreter? = null
    private var motionInterp: Interpreter? = null
    private var staticLabels: List<String> = emptyList()
    private var motionLabels: List<String> = emptyList()
    private var gestureConfig: Map<String, GestureConfig> = emptyMap()

    var isReady = false
        private set

    // Buffer
    private val frameBuffer  = ArrayDeque<FloatArray>()
    private var noHandFrames = 0
    private var collecting   = false
    private var bufStartTime = 0L

    // Velocity
    private val velocityHistory = ArrayDeque<Float>()
    private var lastKeyXY: FloatArray? = null

    // Static early-exit
    private val staticVoteBuffer = ArrayDeque<Pair<Int, Float>>()
    private var earlyExitStreak  = 0
    private var earlyExitLabel   = -1

    // Cached static result — reused in dual-race to avoid running the model twice
    private var lastStaticResult: Pair<Int, Float>? = null
    private var framesSinceStaticRun = 0

    // Motion early-exit (sliding window)
    private var motionEarlyStreak    = 0
    private var motionEarlyLabel     = -1
    private var framesSinceMotionRun = 0

    // Cooldown — prevents next gesture bleeding into previous detection window
    private var lastDetectionTime        = 0L
    private var lastMotionDetectionTime  = 0L  // tracks when last motion gesture fired — gates re-arm
    private var sustainedMotionFrames    = 0   // consecutive frames above velocity threshold
    private var maxSustainedMotionFrames = 0   // peak streak seen in the current buffer window

    // Pre-allocated inference arrays — reused every call to reduce GC pressure
    private var staticAvgInput:  FloatArray          = FloatArray(126)
    private var staticInputArr:  Array<FloatArray>   = arrayOf(staticAvgInput)
    private var staticOutputArr: Array<FloatArray>   = arrayOf(FloatArray(1))
    private var motionOutputArr: Array<FloatArray>   = arrayOf(FloatArray(1))

    // ── Init ──────────────────────────────────────────────────────────────────

    fun init() {
        try {
            val options = Interpreter.Options().apply { numThreads = 4 }

            // Static model + labels are required — if missing, init fails and isReady stays false
            val staticBuf = loadModelOrNull("sign_model_static.tflite")
            if (staticBuf == null) {
                Log.e(TAG, "Static model not found in filesDir or assets — download from backend first")
                return
            }
            staticInterp = Interpreter(staticBuf, options)

            val staticLbls = loadLabelsOrNull("labels_static.json")
            if (staticLbls == null) {
                Log.e(TAG, "Static labels not found in filesDir or assets — download from backend first")
                return
            }
            staticLabels = staticLbls

            // Motion model + labels are optional
            motionInterp = tryLoadModel("sign_model_motion.tflite", options)
            motionLabels = if (motionInterp != null) {
                loadLabelsOrNull("labels_motion.json") ?: emptyList<String>().also {
                    Log.w(TAG, "Motion model loaded but labels_motion.json missing — disabling motion")
                    motionInterp?.close()
                    motionInterp = null
                }
            } else {
                emptyList()
            }

            // Initialize pre-allocated inference arrays now that label counts are known
            staticAvgInput  = FloatArray(126)
            staticInputArr  = arrayOf(staticAvgInput)
            staticOutputArr = arrayOf(FloatArray(staticLabels.size))
            if (motionLabels.isNotEmpty()) {
                motionOutputArr = arrayOf(FloatArray(motionLabels.size))
            }

            gestureConfig = loadGestureConfig()
            isReady       = true
            Log.i(TAG, "Models loaded — static: ${staticLabels.size} classes, " +
                    "motion: ${motionLabels.size} classes" +
                    if (motionInterp == null) " (motion model not available)" else "")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load models: ${e.message}", e)
        }
    }

    // Load a model buffer from filesDir (downloaded) first, then fall back to bundled assets.
    // Returns null if the file doesn't exist in either location.
    private fun loadModelOrNull(filename: String): MappedByteBuffer? {
        val local = File(context.filesDir, filename)
        if (local.exists()) {
            return try {
                Log.d(TAG, "Loading $filename from filesDir")
                FileInputStream(local).channel
                    .map(FileChannel.MapMode.READ_ONLY, 0, local.length())
            } catch (e: Exception) {
                Log.w(TAG, "Failed to read $filename from filesDir: ${e.message}")
                null
            }
        }
        return try {
            Log.d(TAG, "Loading $filename from assets")
            val afd = context.assets.openFd(filename)
            FileInputStream(afd.fileDescriptor).channel
                .map(FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength)
        } catch (e: Exception) {
            null  // File not in assets either
        }
    }

    // Load an interpreter, returning null if the file doesn't exist anywhere.
    private fun tryLoadModel(filename: String, options: Interpreter.Options): Interpreter? {
        val buf = loadModelOrNull(filename) ?: return null
        return try {
            Interpreter(buf, options)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to create interpreter for $filename: ${e.message}")
            null
        }
    }

    // Load labels JSON from filesDir first, then assets. Returns null if not found anywhere.
    private fun loadLabelsOrNull(filename: String): List<String>? {
        val text = try {
            val local = File(context.filesDir, filename)
            if (local.exists()) local.readText()
            else context.assets.open(filename).bufferedReader().readText()
        } catch (e: Exception) {
            return null
        }
        return try {
            val json   = JSONObject(text)
            val result = mutableListOf<String>()
            var i = 0
            while (json.has(i.toString())) {
                result.add(json.getString(i.toString()))
                i++
            }
            result
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse $filename: ${e.message}")
            null
        }
    }

    private fun loadGestureConfig(): Map<String, GestureConfig> {
        val text = try {
            val local = File(context.filesDir, "gesture_config.json")
            if (local.exists()) {
                Log.d(TAG, "Loading gesture_config.json from filesDir")
                local.readText()
            } else if (context.assets.list("")?.contains("gesture_config.json") == true) {
                Log.d(TAG, "Loading gesture_config.json from assets")
                context.assets.open("gesture_config.json").bufferedReader().readText()
            } else {
                Log.w(TAG, "gesture_config.json not found — motion gesture detection disabled")
                return emptyMap()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load gesture_config.json: ${e.message}")
            return emptyMap()
        }
        return try {
            val json   = JSONObject(text)
            val result = mutableMapOf<String, GestureConfig>()
            for (key in json.keys()) {
                val obj = json.getJSONObject(key)
                result[key] = GestureConfig(
                    oneHanded     = obj.optBoolean("one_handed", true),
                    normalizeHand = obj.optBoolean("normalize_hand", true),
                    motion        = obj.optBoolean("motion", false)
                )
            }
            Log.i(TAG, "Gesture config loaded: ${result.size} labels")
            result
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse gesture_config.json: ${e.message}")
            emptyMap()
        }
    }

    // ── Main entry point ──────────────────────────────────────────────────────

    fun processFrame(features: FloatArray, handsDetected: Int) {
        if (!isReady) return

        // Ignore frames during cooldown after a detection fires
        val now = System.currentTimeMillis()
        if (now - lastDetectionTime < DETECTION_COOLDOWN_MS) return

        if (handsDetected == 0) {
            noHandFrames++
            if (noHandFrames > NO_HAND_TIMEOUT) {
                if (collecting || frameBuffer.isNotEmpty()) {
                    resetBuffers()
                }
                onNoHands?.invoke()
            }
            return
        }

        // Guard against corrupt MediaPipe frames (NaN/Inf landmarks)
        if (features.any { !it.isFinite() }) return

        noHandFrames = 0
        collecting   = true

        // Start timer on first frame of a new gesture
        if (bufStartTime == 0L) bufStartTime = now

        frameBuffer.addLast(features.copyOf())
        if (frameBuffer.size > BUFFER_CAPACITY) frameBuffer.removeFirst()

        val velocity = computeVelocity(features)
        val isMotion = velocity > MOTION_VELOCITY_THRESH
        framesSinceMotionRun++
        framesSinceStaticRun++

        // Track consecutive frames of sustained movement
        if (velocity >= MOTION_VELOCITY_THRESH) {
            sustainedMotionFrames++
            if (sustainedMotionFrames > maxSustainedMotionFrames)
                maxSustainedMotionFrames = sustainedMotionFrames
        } else {
            sustainedMotionFrames = 0
        }

        // Compute buffer mean velocity once per frame — reused in motion probe and dual-race
        val meanVel = bufferMeanVelocity()

        // Motion probe only re-arms after MOTION_SETTLE_MS has passed since the
        // last motion detection. This is time-based so it works correctly even
        // during cooldown when processFrame returns early — no frame counting needed.
        val motionProbeArmed = (now - lastMotionDetectionTime) >= MOTION_SETTLE_MS

        // ── Static early-exit (throttled: run every STATIC_INFERENCE_INTERVAL frames) ─
        // Matches training distribution: CollectionActivity saves a 5-frame average
        // as a single sample, so the model expects averaged/smoothed input.
        if (framesSinceStaticRun >= STATIC_INFERENCE_INTERVAL) {
            framesSinceStaticRun = 0
            lastStaticResult = runAveragedStaticInference()
        }

        val staticResult = lastStaticResult
        if (staticResult != null) {
            staticVoteBuffer.addLast(staticResult)
            if (staticVoteBuffer.size > STATIC_AVG_FRAMES) staticVoteBuffer.removeFirst()

            val (idx, conf)         = staticResult
            val label               = staticLabels.getOrNull(idx) ?: ""
            val isMotionGesture     = gestureConfig[label]?.motion == true

            if (!isMotionGesture && conf >= EARLY_EXIT_THRESHOLD) {
                // Only suppress static early-exit when movement is genuinely sustained —
                // a single jittery frame above threshold shouldn't reset a confident static streak.
                if (velocity >= MOTION_VELOCITY_THRESH && sustainedMotionFrames >= STATIC_SUPPRESS_STREAK) {
                    earlyExitStreak = 0
                    earlyExitLabel  = -1
                } else {
                    if (idx == earlyExitLabel) {
                        earlyExitStreak++
                    } else {
                        earlyExitStreak = 1
                        earlyExitLabel  = idx
                    }
                    if (earlyExitStreak >= EARLY_EXIT_STREAK) {
                        lastDetectionTime = now
                        onResult?.invoke(PredictionResult(label, conf, false, earlyExit = true))
                        resetBuffers()
                        return
                    }
                }
            } else {
                if (idx != earlyExitLabel) { earlyExitStreak = 0; earlyExitLabel = idx }
            }
        }

        // ── Motion sliding-window early-exit (sustained velocity gated) ──────
        // Only probe motion model after hand has been moving for N consecutive
        // frames AND has fully settled after the previous detection AND the
        // overall buffer mean velocity confirms real sustained movement —
        // not just brief repositioning between gestures.
        if (frameBuffer.size >= MIN_MOTION_FRAMES
            && framesSinceMotionRun >= MOTION_SLIDE_INTERVAL
            && sustainedMotionFrames >= MOTION_VELOCITY_STREAK
            && motionProbeArmed
            && meanVel >= MOTION_VELOCITY_THRESH) {

            framesSinceMotionRun = 0
            val motionResult = runMotionInference(frameBuffer.toList())
            if (motionResult != null) {
                val (mIdx, mConf)   = motionResult
                val mLabel          = motionLabels.getOrNull(mIdx) ?: ""
                val isMotionGesture = gestureConfig[mLabel]?.motion == true
                if (isMotionGesture && mConf >= MOTION_EARLY_CONF) {
                    if (mIdx == motionEarlyLabel) motionEarlyStreak++
                    else { motionEarlyStreak = 1; motionEarlyLabel = mIdx }
                    if (motionEarlyStreak >= MOTION_EARLY_STREAK) {
                        lastDetectionTime       = now
                        lastMotionDetectionTime = now
                        onResult?.invoke(PredictionResult(mLabel, mConf, true, earlyExit = true))
                        resetBuffers()
                        return
                    }
                } else {
                    if (mIdx != motionEarlyLabel) { motionEarlyStreak = 0; motionEarlyLabel = mIdx }
                }
            }
        }

        // ── Time-based dual-race trigger ──────────────────────────────────────
        val elapsed  = now - bufStartTime
        val progress = (elapsed.toFloat() / BUFFER_FILL_MS).coerceIn(0f, 1f)

        onCollecting?.invoke(CollectingState(
            progress = progress,
            frames   = frameBuffer.size,
            velocity = velocity,
            isMotion = isMotion,
            streak   = earlyExitStreak
        ))

        if (elapsed >= BUFFER_FILL_MS && frameBuffer.size >= MIN_MOTION_FRAMES) {
            runDualRace(now, meanVel)
            resetBuffers()
        }
    }

    // ── Dual-race inference ───────────────────────────────────────────────────

    private fun runDualRace(now: Long, meanVel: Float) {
        val frames = frameBuffer.toList()

        // Motion only allowed in dual-race if settle time has passed since last motion detection
        val motionProbeArmed = (now - lastMotionDetectionTime) >= MOTION_SETTLE_MS

        // Reuse the last cached static result — avoids running the model a second time
        val staticResult = lastStaticResult
        val motionResult = if (motionProbeArmed) runMotionInference(frames) else null

        if (motionResult != null) {
            val (mIdx, mConf)   = motionResult
            val mLabel          = motionLabels.getOrNull(mIdx) ?: return
            val isMotionGesture = gestureConfig[mLabel]?.motion == true
            // Motion only wins if the hand was moving continuously for long enough —
            // brief shakes (e.g. repositioning during a static gesture) are filtered out
            // by requiring the peak sustained streak to reach MIN_MOTION_FRAMES.
            val sConfForMargin = staticResult?.second ?: 0f
            if (isMotionGesture && mConf >= MOTION_THRESHOLD
                && mConf >= sConfForMargin + MOTION_DOMINANCE_MARGIN
                && meanVel >= MOTION_VELOCITY_THRESH
                && maxSustainedMotionFrames >= MIN_MOTION_FRAMES) {
                lastDetectionTime       = now
                lastMotionDetectionTime = now
                onResult?.invoke(PredictionResult(mLabel, mConf, isMotion = true))
                return
            }
        }

        if (staticResult != null) {
            val (sIdx, sConf)   = staticResult
            val sLabel          = staticLabels.getOrNull(sIdx) ?: return
            val isMotionGesture = gestureConfig[sLabel]?.motion == true
            if (!isMotionGesture && sConf >= STATIC_THRESHOLD) {
                lastDetectionTime = now
                onResult?.invoke(PredictionResult(sLabel, sConf, isMotion = false))
            }
        }
    }

    // ── Static inference ──────────────────────────────────────────────────────

    // Average input frames first, then run inference once using pre-allocated arrays.
    // Matches training distribution: CollectionActivity saves a 5-frame average
    // as a single sample, so the model expects averaged/smoothed input — not raw frames.
    private fun runAveragedStaticInference(): Pair<Int, Float>? {
        val interp = staticInterp ?: return null
        if (staticLabels.isEmpty()) return null
        val recent = frameBuffer.takeLast(STATIC_AVG_FRAMES)
        if (recent.isEmpty()) return null

        // Zero and accumulate into pre-allocated buffer
        staticAvgInput.fill(0f)
        for (frame in recent) {
            for (i in frame.indices) staticAvgInput[i] += frame[i]
        }
        val n = recent.size.toFloat()
        for (i in staticAvgInput.indices) staticAvgInput[i] /= n

        // staticInputArr[0] is already staticAvgInput — no new allocation needed
        return try {
            interp.run(staticInputArr, staticOutputArr)
            val probs = staticOutputArr[0]
            val idx   = probs.indices.maxByOrNull { probs[it] } ?: return null
            Pair(idx, probs[idx])
        } catch (_: Exception) { null }
    }

    // ── Motion inference ──────────────────────────────────────────────────────

    // Mean frame-to-frame velocity across the whole buffer.
    // Uses direct index access to avoid list/array allocations in the inner loop.
    private fun bufferMeanVelocity(): Float {
        val frames = frameBuffer.toList()
        if (frames.size < 2) return 0f
        var total = 0f
        for (i in 1 until frames.size) {
            var sum = 0f
            for (j in KEY_XY) {
                val d = frames[i][j] - frames[i - 1][j]
                sum += d * d
            }
            total += sqrt(sum)
        }
        return total / (frames.size - 1)
    }

    private fun runMotionInference(frames: List<FloatArray>): Pair<Int, Float>? {
        val interp = motionInterp ?: return null
        if (frames.size < MIN_MOTION_FRAMES) return null

        val seq = extractMotionWindow(frames)
        if (seq.any { it.size != 126 }) {
            Log.w(TAG, "Motion inference skipped — frame with wrong feature size detected (expected 126)")
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

    private fun extractMotionWindow(frames: List<FloatArray>): List<FloatArray> {
        if (frames.size == SEQUENCE_LENGTH) return frames

        // Find peak-velocity frame and centre window around it
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

    // ── Velocity ──────────────────────────────────────────────────────────────

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

    // ── Buffer reset ──────────────────────────────────────────────────────────

    // Full reset after every detection — frame counter, velocity, all streaks.
    // NOTE: lastMotionDetectionTime is intentionally NOT reset here.
    // The settle timer must survive the buffer reset so it keeps blocking
    // the motion probe for the full MOTION_SETTLE_MS after a motion detection.
    private fun resetBuffers() {
        frameBuffer.clear()
        staticVoteBuffer.clear()
        velocityHistory.clear()
        lastKeyXY                = null
        collecting               = false
        bufStartTime             = 0L
        earlyExitStreak          = 0
        earlyExitLabel           = -1
        motionEarlyStreak        = 0
        motionEarlyLabel         = -1
        framesSinceMotionRun     = 0
        framesSinceStaticRun     = 0
        lastStaticResult         = null
        sustainedMotionFrames    = 0
        maxSustainedMotionFrames = 0
    }

    fun reset() {
        resetBuffers()
        noHandFrames = 0
    }

    fun close() {
        staticInterp?.close()
        motionInterp?.close()
    }
}
