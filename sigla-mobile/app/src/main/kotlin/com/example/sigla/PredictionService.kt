package com.example.sigla

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.flex.FlexDelegate
import kotlin.math.abs
import kotlin.math.min

// ── Constants — aligned with Python predict_landmarks.py ─────────────────────
private const val TAG = "PredictionService"
private const val SEQUENCE_LENGTH = 30

// Probe interval (frames) — Python: PROBE_INTERVAL = 8
private const val PROBE_INTERVAL = 8
private const val EARLY_EXIT_CONF = 0.92f
private const val EARLY_EXIT_STREAK = 3

// Static averaging
private const val STATIC_AVG_MAX_FRAMES = 10
private const val STATIC_HISTORY_LEN = 12
private const val STATIC_THRESHOLD = 0.40f

// Motion thresholds — match Python exactly
private const val MOTION_CONF_FLOOR = 0.50f
private const val MOTION_CONF_BASE = 0.60f
private const val MOTION_CONF_STATIC_CAP = 0.85f
private const val MOTION_SCORE_HIGH = 0.012f  // Python: 0.012
private const val MOTION_SCORE_LOW = 0.002f   // Python: 0.002
private const val MIN_BUF_FRAMES_MOTION = 8

// Derived from MOTION_SCORE_LOW — match Python
private const val LSTM_SKIP_THRESHOLD = 0.0008f     // Python: MOTION_SCORE_LOW * 0.4
private const val VELOCITY_TRIM_THRESHOLD = 0.0012f  // Python: MOTION_SCORE_LOW * 0.6

// Rolling window for live velocity — Python: 20
private const val VELOCITY_WINDOW = 20

// Timing
private const val BUFFER_CAPACITY = 90
private const val NO_HAND_TIMEOUT = 6
private const val BUFFER_FILL_MS = 1500L
private const val DETECTION_COOLDOWN_MS = 1500L  // Python: RESULT_DISPLAY_SECS = 1.5
private const val MOTION_SETTLE_MS = 2000L

// Key landmarks: wrist + 5 fingertips — x,y only for velocity
private val KEY_LANDMARKS = intArrayOf(0, 4, 8, 12, 16, 20)
private val KEY_XY: IntArray = KEY_LANDMARKS.flatMap { i -> listOf(i * 3, i * 3 + 1) }.toIntArray()

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

// ── PredictionService ─────────────────────────────────────────────────────────

class PredictionService(private val context: Context) {

    var onResult: ((PredictionResult) -> Unit)? = null
    var onCollecting: ((CollectingState) -> Unit)? = null
    var onNoHands: (() -> Unit)? = null

    private var staticInterp: Interpreter? = null
    private var motionInterp: Interpreter? = null
    private var flexDelegate: FlexDelegate? = null
    private var staticLabels: List<String> = emptyList()
    private var motionLabels: List<String> = emptyList()

    var isReady = false
        private set

    // Buffer
    private val frameBuffer = ArrayDeque<FloatArray>()
    private var noHandFrames = 0
    private var collecting = false
    private var bufStartTime = 0L

    // Velocity — rolling window of mean-abs displacement per frame
    private val velWindow = ArrayDeque<Float>()
    private var liveVelScore = 0f
    private var prevKeyXY: FloatArray? = null

    // Early exit probe
    private var probeCounter = 0
    private var probeStreak = 0
    private var probeLabel = ""

    // Static history
    private val staticHistory = ArrayDeque<String>()

    // Cooldown
    private var lastDetectionTime = 0L
    private var lastMotionDetectionTime = 0L

    // ── Init ──────────────────────────────────────────────────────────────────

    fun init() {
        val staticOptions = Interpreter.Options().apply { numThreads = 4 }

        // FlexDelegate is needed for LSTM (SELECT_TF_OPS).
        // If it fails, static model must still load.
        val motionOptions: Interpreter.Options? = try {
            val fd = FlexDelegate()
            flexDelegate = fd
            Interpreter.Options().apply {
                numThreads = 4
                addDelegate(fd)
            }
        } catch (e: Exception) {
            Log.w(TAG, "FlexDelegate unavailable — motion disabled: ${e.message}")
            flexDelegate = null
            null
        }

        // Load static model
        val sInterp = loadInterpreter("sign_model_static.tflite", staticOptions)
        val sLabels = loadLabels("labels_static.json")
        if (sInterp == null || sLabels == null) {
            Log.e(TAG, "Static model failed to load — prediction disabled")
            return
        }
        staticInterp = sInterp
        staticLabels = sLabels
        Log.i(TAG, "Static: ${staticLabels.size} classes (${staticLabels.joinToString()})")

        // Load motion model (optional)
        if (motionOptions != null) {
            val mInterp = loadInterpreter("sign_model_motion.tflite", motionOptions)
            val mLabels = loadLabels("labels_motion.json")
            if (mInterp != null && mLabels != null) {
                motionInterp = mInterp
                motionLabels = mLabels
                Log.i(TAG, "Motion: ${motionLabels.size} classes (${motionLabels.joinToString()})")
            } else {
                Log.w(TAG, "Motion model not available — static-only mode")
            }
        } else {
            Log.w(TAG, "FlexDelegate failed — static-only mode")
        }

        isReady = true
        Log.i(TAG, "PredictionService ready — static: ${staticLabels.size}, motion: ${motionLabels.size}")
    }

    private fun loadInterpreter(fileName: String, options: Interpreter.Options): Interpreter? {
        val file = ModelUpdateManager.getLocalFile(context, fileName) ?: run {
            Log.w(TAG, "$fileName not found on disk")
            return null
        }
        return try {
            Interpreter(file, options).also {
                Log.i(TAG, "Loaded $fileName")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load $fileName: ${e.message}")
            file.delete()
            null
        }
    }

    private fun loadLabels(fileName: String): List<String>? {
        val file = ModelUpdateManager.getLocalFile(context, fileName) ?: run {
            Log.w(TAG, "$fileName not found on disk")
            return null
        }
        return try {
            val json = JSONObject(file.readText())
            val labels = mutableListOf<String>()
            var i = 0
            while (json.has(i.toString())) {
                labels.add(json.getString(i.toString()))
                i++
            }
            labels
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse $fileName: ${e.message}")
            file.delete()
            null
        }
    }

    // ── Hand helpers ──────────────────────────────────────────────────────────

    private fun isSingleHand(features: FloatArray): Boolean {
        for (i in 63 until 126) {
            if (features[i] != 0f) return false
        }
        return true
    }

    private fun mirrorHandX(features: FloatArray): FloatArray {
        val m = features.copyOf()
        for (i in 0 until 21) { m[i * 3] = 1.0f - m[i * 3] }
        return m
    }

    // ── Velocity (mean-abs displacement — matches Python _frame_velocity) ────

    /**
     * Mean absolute x,y displacement of key landmarks between two frames.
     * Matches Python: np.mean(np.abs(db - da))
     */
    private fun meanAbsKeyXY(a: FloatArray, b: FloatArray): Float {
        var sum = 0f
        for (k in KEY_XY) {
            sum += abs(a[k] - b[k])
        }
        return sum / KEY_XY.size
    }

    private fun updateLiveVelocity(features: FloatArray) {
        // Extract key landmark x,y values
        val curKeyXY = FloatArray(KEY_XY.size) { features[KEY_XY[it]] }
        val prev = prevKeyXY
        if (prev != null) {
            // Mean absolute displacement (not Euclidean — matches Python)
            var sum = 0f
            for (i in curKeyXY.indices) {
                sum += abs(curKeyXY[i] - prev[i])
            }
            val v = sum / curKeyXY.size
            velWindow.addLast(v)
            while (velWindow.size > VELOCITY_WINDOW) velWindow.removeFirst()
            liveVelScore = velWindow.average().toFloat()
        }
        prevKeyXY = curKeyXY
    }

    private fun bufferMeanVelocity(buf: List<FloatArray>): Float {
        if (buf.size < 2) return 0f
        var total = 0f
        for (i in 1 until buf.size) {
            total += meanAbsKeyXY(buf[i], buf[i - 1])
        }
        return total / (buf.size - 1)
    }

    private fun adaptiveMotionThreshold(velScore: Float): Float = when {
        velScore >= MOTION_SCORE_HIGH -> MOTION_CONF_BASE
        velScore <= MOTION_SCORE_LOW -> MOTION_CONF_STATIC_CAP
        else -> {
            val t = (velScore - MOTION_SCORE_LOW) / (MOTION_SCORE_HIGH - MOTION_SCORE_LOW)
            MOTION_CONF_STATIC_CAP + t * (MOTION_CONF_BASE - MOTION_CONF_STATIC_CAP)
        }
    }

    // ── Static inference ──────────────────────────────────────────────────────

    /**
     * Multi-frame averaged static inference — matches Python _avg_static_pred.
     * Runs model per-frame (TFLite Interpreter is batch-1) and averages softmax.
     * Also runs mirrored frames for single-hand inputs (matches Python _run_static).
     */
    private fun runStaticOnFrames(frames: List<FloatArray>): Pair<String, Float>? {
        val interp = staticInterp ?: return null
        if (staticLabels.isEmpty() || frames.isEmpty()) return null

        val numClasses = staticLabels.size
        val avgProbs = FloatArray(numClasses)
        val input = Array(1) { FloatArray(126) }
        val output = Array(1) { FloatArray(numClasses) }
        var count = 0

        for (frame in frames) {
            // Original orientation
            input[0] = frame
            try {
                interp.run(input, output)
                for (j in 0 until numClasses) avgProbs[j] += output[0][j]
                count++
            } catch (_: Exception) { }

            // Mirror for single-hand (matches Python left-hand flip)
            if (isSingleHand(frame)) {
                input[0] = mirrorHandX(frame)
                try {
                    interp.run(input, output)
                    for (j in 0 until numClasses) avgProbs[j] += output[0][j]
                    count++
                } catch (_: Exception) { }
            }
        }

        if (count == 0) return null
        for (j in 0 until numClasses) avgProbs[j] /= count.toFloat()

        val idx = avgProbs.indices.maxByOrNull { avgProbs[it] } ?: return null
        val label = staticLabels[idx]
        val conf = avgProbs[idx]
        return Pair(label, conf)
    }

    /**
     * Single-frame static probe for early-exit — runs original + mirrored,
     * keeps the higher confidence. Matches Python _probe_static.
     */
    private fun probeStatic(frame: FloatArray): Pair<String, Float>? {
        val interp = staticInterp ?: return null
        if (staticLabels.isEmpty()) return null

        val numClasses = staticLabels.size
        val input = Array(1) { FloatArray(126) }
        val output = Array(1) { FloatArray(numClasses) }

        // Run original
        input[0] = frame
        var bestIdx: Int
        var bestConf: Float
        try {
            interp.run(input, output)
            bestIdx = output[0].indices.maxByOrNull { output[0][it] } ?: return null
            bestConf = output[0][bestIdx]
        } catch (_: Exception) {
            return null
        }

        // Run mirrored if single hand — keep higher confidence
        if (isSingleHand(frame)) {
            input[0] = mirrorHandX(frame)
            try {
                interp.run(input, output)
                val mIdx = output[0].indices.maxByOrNull { output[0][it] }
                if (mIdx != null && output[0][mIdx] > bestConf) {
                    bestIdx = mIdx
                    bestConf = output[0][mIdx]
                }
            } catch (_: Exception) { }
        }

        val label = staticLabels[bestIdx]
        return Pair(label, bestConf)
    }

    // ── Motion inference ──────────────────────────────────────────────────────

    /**
     * Trim low-velocity leading/trailing frames — matches Python _trim_buf_to_motion.
     */
    private fun trimBufToMotion(buf: List<FloatArray>): List<FloatArray> {
        if (buf.size < MIN_BUF_FRAMES_MOTION * 2) return buf

        val profile = FloatArray(buf.size - 1) { i -> meanAbsKeyXY(buf[i + 1], buf[i]) }

        var start = 0
        for (i in profile.indices) {
            if (profile[i] >= VELOCITY_TRIM_THRESHOLD) { start = i; break }
        }
        var end = buf.size
        for (i in profile.indices.reversed()) {
            if (profile[i] >= VELOCITY_TRIM_THRESHOLD) { end = min(buf.size, i + 2); break }
        }

        val trimmed = buf.subList(start, end)
        return if (trimmed.size >= MIN_BUF_FRAMES_MOTION) trimmed else buf
    }

    /**
     * Peak-centred velocity window — matches Python _peak_centre_window.
     */
    private fun peakCentreWindow(buf: List<FloatArray>): List<FloatArray> {
        if (buf.size <= SEQUENCE_LENGTH) return buf

        val profile = FloatArray(buf.size - 1) { i -> meanAbsKeyXY(buf[i + 1], buf[i]) }
        val winLen = SEQUENCE_LENGTH - 1
        if (winLen > profile.size) return buf

        var bestStart = 0
        var bestSum = 0f
        var curSum = 0f
        for (i in 0 until winLen) curSum += profile[i]
        bestSum = curSum

        for (i in 1..(profile.size - winLen)) {
            curSum += profile[i + winLen - 1] - profile[i - 1]
            if (curSum > bestSum) { bestSum = curSum; bestStart = i }
        }

        return buf.subList(bestStart, min(bestStart + SEQUENCE_LENGTH, buf.size))
    }

    /**
     * Linearly interpolate to exactly SEQUENCE_LENGTH frames — matches Python.
     * Python: np.linspace(0, N-1, SEQUENCE_LENGTH) then linear interp.
     */
    private fun resampleToSeqLen(frames: List<FloatArray>): Array<FloatArray> {
        val n = frames.size
        val featureSize = frames[0].size
        return Array(SEQUENCE_LENGTH) { t ->
            val pos = t.toFloat() * (n - 1) / (SEQUENCE_LENGTH - 1).coerceAtLeast(1)
            val lo = pos.toInt().coerceIn(0, n - 1)
            val hi = (lo + 1).coerceIn(0, n - 1)
            val frac = pos - lo
            FloatArray(featureSize) { j -> frames[lo][j] * (1f - frac) + frames[hi][j] * frac }
        }
    }

    /**
     * LSTM inference — trim, peak-centre, resample, run.
     * Input shape: [1, SEQUENCE_LENGTH, 126]
     * Output shape: [1, num_motion_classes]
     */
    private fun runMotionInference(frames: List<FloatArray>): Pair<String, Float>? {
        val interp = motionInterp ?: return null
        if (frames.size < MIN_BUF_FRAMES_MOTION || motionLabels.isEmpty()) return null

        val trimmed = trimBufToMotion(frames)
        val windowed = peakCentreWindow(trimmed)
        val seq = resampleToSeqLen(windowed)

        // TFLite expects [1][SEQUENCE_LENGTH][features]
        val input = Array(1) { seq }
        val output = Array(1) { FloatArray(motionLabels.size) }

        try {
            interp.run(input, output)
        } catch (e: Exception) {
            Log.e(TAG, "Motion inference failed: ${e.message}")
            return null
        }

        val probs = output[0]
        val idx = probs.indices.maxByOrNull { probs[it] } ?: return null
        val conf = probs[idx]

        if (conf < MOTION_CONF_FLOOR) return null
        return Pair(motionLabels[idx], conf)
    }

    // ── Early exit — matches Python _check_early_exit ─────────────────────────

    private fun historyMajority(): String {
        if (staticHistory.isEmpty()) return ""
        val counts = mutableMapOf<String, Int>()
        for (lbl in staticHistory) {
            if (lbl.isNotEmpty()) counts[lbl] = (counts[lbl] ?: 0) + 1
        }
        val top = counts.maxByOrNull { it.value } ?: return ""
        return if (top.value > staticHistory.size / 2) top.key else ""
    }

    private fun checkEarlyExit(features: FloatArray): PredictionResult? {
        probeCounter++
        if (probeCounter < PROBE_INTERVAL) return null
        probeCounter = 0

        // Gate 1: velocity must be low (matches Python)
        if (liveVelScore >= MOTION_SCORE_LOW) {
            probeStreak = 0
            probeLabel = ""
            return null
        }

        val result = probeStatic(features) ?: run {
            staticHistory.addLast("")
            while (staticHistory.size > STATIC_HISTORY_LEN) staticHistory.removeFirst()
            return null
        }
        val (label, conf) = result

        // Don't early-exit motion gestures
        val isMotionGesture = motionLabels.contains(label)

        // Update history
        staticHistory.addLast(if (!isMotionGesture && conf >= EARLY_EXIT_CONF) label else "")
        while (staticHistory.size > STATIC_HISTORY_LEN) staticHistory.removeFirst()

        if (isMotionGesture || conf < EARLY_EXIT_CONF) {
            probeStreak = 0
            probeLabel = ""
            return null
        }

        // Gate 2: streak
        if (label == probeLabel) {
            probeStreak++
        } else {
            probeStreak = 1
            probeLabel = label
        }

        if (probeStreak >= EARLY_EXIT_STREAK) {
            // Gate 3: history majority must agree
            val majority = historyMajority()
            if (majority == label) {
                probeStreak = 0
                probeLabel = ""
                Log.i(TAG, "Early exit: $label (${"%.3f".format(conf)})")
                return PredictionResult(label, conf, isMotion = false, earlyExit = true)
            }
            probeStreak = 0
        }

        return null
    }

    // ── Main entry point ──────────────────────────────────────────────────────

    fun processFrame(features: FloatArray, handsDetected: Int) {
        if (!isReady) return

        val now = System.currentTimeMillis()

        if (handsDetected == 0) {
            noHandFrames++
            if (noHandFrames > NO_HAND_TIMEOUT) {
                if (collecting || frameBuffer.isNotEmpty()) resetBuffers()
                onNoHands?.invoke()
            }
            return
        }

        // During cooldown, track hands but don't run prediction
        if (now - lastDetectionTime < DETECTION_COOLDOWN_MS) return

        noHandFrames = 0
        updateLiveVelocity(features)

        if (!collecting) {
            collecting = true
            bufStartTime = now
        }

        frameBuffer.addLast(features.copyOf())
        while (frameBuffer.size > BUFFER_CAPACITY) frameBuffer.removeFirst()

        // Early exit check
        val earlyResult = checkEarlyExit(features)
        if (earlyResult != null) {
            lastDetectionTime = now
            onResult?.invoke(earlyResult)
            resetBuffers()
            return
        }

        // Progress callback
        val elapsed = now - bufStartTime
        val progress = (elapsed.toFloat() / BUFFER_FILL_MS).coerceIn(0f, 1f)
        onCollecting?.invoke(CollectingState(
            progress = progress,
            frames = frameBuffer.size,
            velocity = liveVelScore,
            isMotion = liveVelScore >= MOTION_SCORE_LOW,
            streak = probeStreak
        ))

        // Buffer full — run dual-race
        if (elapsed >= BUFFER_FILL_MS && frameBuffer.size >= MIN_BUF_FRAMES_MOTION) {
            runDualRace(now, frameBuffer.toList())
            resetBuffers()
        }
    }

    // ── Dual-race — matches Python _race() ────────────────────────────────────

    private fun runDualRace(now: Long, frames: List<FloatArray>) {
        val meanVel = bufferMeanVelocity(frames)
        val adaptiveThresh = adaptiveMotionThreshold(meanVel)
        val skipLstm = meanVel < LSTM_SKIP_THRESHOLD
        val motionProbeArmed = (now - lastMotionDetectionTime) >= MOTION_SETTLE_MS

        // Run static (multi-frame averaged on last STATIC_AVG_MAX_FRAMES)
        val staticResult = runStaticOnFrames(frames.takeLast(STATIC_AVG_MAX_FRAMES))

        // Run motion (if velocity warrants it)
        val motionResult = if (!skipLstm && motionProbeArmed && motionInterp != null)
            runMotionInference(frames) else null

        val skipNote = if (skipLstm) " [LSTM skipped]" else ""
        Log.d(TAG, "RACE vel=${"%.4f".format(meanVel)} thresh=${"%.2f".format(adaptiveThresh)} " +
                "static=${staticResult?.let { "${it.first}(${"%.2f".format(it.second)})" } ?: "none"} " +
                "motion=${motionResult?.let { "${it.first}(${"%.2f".format(it.second)})" } ?: "none"}$skipNote")

        // Motion wins if confident enough and velocity confirms movement
        if (motionResult != null) {
            val (mLabel, mConf) = motionResult
            if (mConf >= adaptiveThresh && meanVel >= MOTION_SCORE_LOW) {
                Log.i(TAG, "MOTION wins: $mLabel (${"%.3f".format(mConf)})")
                lastDetectionTime = now
                lastMotionDetectionTime = now
                onResult?.invoke(PredictionResult(mLabel, mConf, isMotion = true))
                return
            }
        }

        // Static fallback — skip labels that belong to motion model
        if (staticResult != null) {
            val (sLabel, sConf) = staticResult
            if (!motionLabels.contains(sLabel) && sConf >= STATIC_THRESHOLD) {
                Log.i(TAG, "STATIC wins: $sLabel (${"%.3f".format(sConf)})")
                lastDetectionTime = now
                onResult?.invoke(PredictionResult(sLabel, sConf, isMotion = false))
                return
            }
        }

        Log.d(TAG, "RACE: no confident result")
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    private fun resetBuffers() {
        frameBuffer.clear()
        velWindow.clear()
        prevKeyXY = null
        liveVelScore = 0f
        probeCounter = 0
        probeStreak = 0
        probeLabel = ""
        collecting = false
        bufStartTime = 0L
    }

    fun reset() {
        resetBuffers()
        staticHistory.clear()
        noHandFrames = 0
    }

    fun close() {
        staticInterp?.close()
        motionInterp?.close()
        flexDelegate?.close()
    }
}
