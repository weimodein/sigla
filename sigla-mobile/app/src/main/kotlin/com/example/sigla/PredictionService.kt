package com.example.sigla

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.tensorflow.lite.Interpreter
import kotlin.math.sqrt

private const val TAG = "PredictionService"

// ---------- Constants -------------------------------------------------
private const val SEQUENCE_LENGTH        = 30
private const val MIN_MOTION_FRAMES      = 8
private const val MOTION_SLIDE_INTERVAL  = 2
private const val MOTION_EARLY_CONF      = 0.85f     // lowered from 0.92
private const val MOTION_EARLY_STREAK    = 4
private const val MOTION_VELOCITY_STREAK = 10
private const val STATIC_THRESHOLD       = 0.40f     // increased for better accuracy
private const val VELOCITY_WINDOW        = 8

// --- Strong motion gating (raised significantly) ---
private const val MOTION_VELOCITY_THRESH = 0.025f     // was 0.018f – only clear movement
private const val LSTM_SKIP_THRESHOLD    = 0.018f     // was 0.014f

private const val EARLY_EXIT_STREAK      = 3
private const val EARLY_EXIT_THRESHOLD   = 0.90f      // increased for better accuracy
private const val STATIC_AVG_FRAMES      = 5          // reduced for performance
private const val STATIC_HISTORY_LEN     = 12
private const val BUFFER_CAPACITY        = 90
private const val NO_HAND_TIMEOUT        = 6
private const val BUFFER_FILL_MS         = 1000L      // reduced for faster detection
private const val DETECTION_COOLDOWN_MS  = 4000L      // increased to prevent spam
private const val MOTION_SETTLE_MS       = 2000L

// Adaptive motion threshold
private const val VELOCITY_SCORE_HIGH    = 0.025f
private const val VELOCITY_SCORE_LOW     = 0.010f
private const val MOTION_CONF_BASE       = 0.65f      // lowered, because velocity is already high
private const val MOTION_CONF_STATIC_CAP = 0.85f

// Static override: if static model is very confident, motion must be even more confident
private const val STATIC_HIGH_CONF_THRESH = 0.70f
private const val MOTION_CONF_MARGIN      = 0.15f

private const val VELOCITY_TRIM_THRESHOLD = 0.004f

// Landmark indices (wrist + fingertips)
private val KEY_LANDMARK_INDICES = intArrayOf(0, 4, 8, 12, 16, 20)
private val KEY_XY: IntArray = KEY_LANDMARK_INDICES.flatMap { i -> listOf(i * 3, i * 3 + 1) }.toIntArray()

// ---------- Data classes ----------------------------------------------
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

// ---------- PredictionService -----------------------------------------
class PredictionService(private val context: Context) {

    var onResult: ((PredictionResult) -> Unit)? = null
    var onCollecting: ((CollectingState) -> Unit)? = null
    var onNoHands: (() -> Unit)? = null

    private var staticInterp: Interpreter? = null
    private var motionInterp: Interpreter? = null
    private var staticLabels: List<String> = emptyList()
    private var motionLabels: List<String> = emptyList()

    var isReady = false
        private set

    private val frameBuffer = ArrayDeque<FloatArray>()
    private var noHandFrames = 0
    private var collecting = false
    private var bufStartTime = 0L

    private val velocityHistory = ArrayDeque<Float>()
    private var lastKeyXY: FloatArray? = null
    private val keyXYScratch = FloatArray(KEY_XY.size)

    private val staticHistory = ArrayDeque<String>()

    private var earlyExitStreak = 0
    private var earlyExitLabel = -1
    private var motionEarlyStreak = 0
    private var motionEarlyLabel = -1
    private var framesSinceMotionRun = 0
    private var lastDetectionTime = 0L
    private var lastMotionDetectionTime = 0L
    private var sustainedMotionFrames = 0

    // ---------- Initialisation -----------------------------------------
    fun init() {
        val options = Interpreter.Options().apply { numThreads = 4 }
        val (sInterp, sLabels) = loadModelPair("sign_model_static.tflite", "labels_static.json", options)
        if (sInterp == null || sLabels == null) {
            Log.e(TAG, "Failed to load static model")
            return
        }
        staticInterp = sInterp
        staticLabels = sLabels

        val (mInterp, mLabels) = loadModelPair("sign_model_motion.tflite", "labels_motion.json", options)
        if (mInterp != null && mLabels != null) {
            motionInterp = mInterp
            motionLabels = mLabels
        } else {
            Log.w(TAG, "Motion model not available, running static-only")
        }
        isReady = true
        Log.i(TAG, "Models loaded — static: ${staticLabels.size}, motion: ${motionLabels.size}")
        Log.i(TAG, "Static labels: ${staticLabels.joinToString()}")
        Log.i(TAG, "Motion labels: ${motionLabels.joinToString()}")
    }

    private fun loadModelPair(modelFile: String, labelsFile: String, options: Interpreter.Options): Pair<Interpreter?, List<String>?> {
        val localModel = ModelUpdateManager.getLocalFile(context, modelFile)
        val localLabels = ModelUpdateManager.getLocalFile(context, labelsFile)
        if (localModel == null || localLabels == null) return Pair(null, null)
        return try {
            val interp = Interpreter(localModel, options)
            val labels = parseLabels(localLabels.readText())
            Pair(interp, labels)
        } catch (e: Exception) {
            localModel.delete(); localLabels.delete()
            Pair(null, null)
        }
    }

    private fun parseLabels(text: String): List<String> {
        val json = JSONObject(text)
        val result = mutableListOf<String>()
        var i = 0
        while (json.has(i.toString())) { result.add(json.getString(i.toString())); i++ }
        return result
    }

    // ---------- Helpers ------------------------------------------------
    private fun isSingleHand(features: FloatArray): Boolean {
        for (i in 63 until 126) if (features[i] != 0f) return false
        return true
    }

    private fun mirrorHandX(features: FloatArray): FloatArray {
        val m = features.copyOf()
        for (i in 0 until 21) m[i * 3] = 1.0f - m[i * 3]
        return m
    }

    private fun adaptiveMotionThreshold(velScore: Float): Float = when {
        velScore >= VELOCITY_SCORE_HIGH -> MOTION_CONF_BASE
        velScore <= VELOCITY_SCORE_LOW -> MOTION_CONF_STATIC_CAP
        else -> {
            val t = (velScore - VELOCITY_SCORE_LOW) / (VELOCITY_SCORE_HIGH - VELOCITY_SCORE_LOW)
            MOTION_CONF_STATIC_CAP + t * (MOTION_CONF_BASE - MOTION_CONF_STATIC_CAP)
        }
    }

    private fun historyMajority(): String {
        if (staticHistory.isEmpty()) return ""
        val counts = mutableMapOf<String, Int>()
        for (lbl in staticHistory) if (lbl.isNotEmpty()) counts[lbl] = (counts[lbl] ?: 0) + 1
        val entry = counts.maxByOrNull { it.value } ?: return ""
        return if (entry.value > staticHistory.size / 2) entry.key else ""
    }

    // ---------- Main processing ----------------------------------------
    fun processFrame(features: FloatArray, handsDetected: Int) {
        if (!isReady) return

        val now = System.currentTimeMillis()
        if (now - lastDetectionTime < DETECTION_COOLDOWN_MS) return

        if (handsDetected == 0) {
            noHandFrames++
            if (noHandFrames > NO_HAND_TIMEOUT) {
                if (collecting || frameBuffer.isNotEmpty()) resetBuffers()
                onNoHands?.invoke()
            }
            return
        }

        noHandFrames = 0
        collecting = true
        if (bufStartTime == 0L) bufStartTime = now

        frameBuffer.addLast(features.copyOf())
        if (frameBuffer.size > BUFFER_CAPACITY) frameBuffer.removeFirst()

        val velocity = computeVelocity(features)
        val isMotion = velocity > MOTION_VELOCITY_THRESH
        framesSinceMotionRun++

        if (velocity >= MOTION_VELOCITY_THRESH) sustainedMotionFrames++
        else sustainedMotionFrames = 0

        val motionProbeArmed = (now - lastMotionDetectionTime) >= MOTION_SETTLE_MS

        // ---- Static early‑exit ----
        val staticResult = runStaticOnFrames(frameBuffer.takeLast(STATIC_AVG_FRAMES))
        if (staticResult != null) {
            val (idx, conf) = staticResult
            val label = staticLabels.getOrNull(idx) ?: ""
            val isMotionGesture = motionLabels.contains(label)

            staticHistory.addLast(if (!isMotionGesture && conf >= EARLY_EXIT_THRESHOLD) label else "")
            if (staticHistory.size > STATIC_HISTORY_LEN) staticHistory.removeFirst()

            if (!isMotionGesture && conf >= EARLY_EXIT_THRESHOLD) {
                if (idx == earlyExitLabel) earlyExitStreak++
                else { earlyExitStreak = 1; earlyExitLabel = idx }
                if (earlyExitStreak >= EARLY_EXIT_STREAK && historyMajority() == label) {
                    lastDetectionTime = now
                    onResult?.invoke(PredictionResult(label, conf, false, earlyExit = true))
                    resetBuffers()
                    return
                }
            } else {
                if (idx != earlyExitLabel) { earlyExitStreak = 0; earlyExitLabel = idx }
            }
        }

        // ---- Motion early‑exit (only if velocity is high) ----
        if (frameBuffer.size >= MIN_MOTION_FRAMES
            && framesSinceMotionRun >= MOTION_SLIDE_INTERVAL
            && sustainedMotionFrames >= MOTION_VELOCITY_STREAK
            && motionProbeArmed
            && bufferMeanVelocity() >= MOTION_VELOCITY_THRESH
        ) {
            framesSinceMotionRun = 0
            val motionResult = runMotionInference(frameBuffer.toList())
            if (motionResult != null) {
                val (mIdx, mConf) = motionResult
                val mLabel = motionLabels.getOrNull(mIdx) ?: ""
                // No high‑risk override – rely on velocity gating instead
                if (motionLabels.contains(mLabel) && mConf >= MOTION_EARLY_CONF) {
                    if (mIdx == motionEarlyLabel) motionEarlyStreak++
                    else { motionEarlyStreak = 1; motionEarlyLabel = mIdx }
                    if (motionEarlyStreak >= MOTION_EARLY_STREAK) {
                        Log.i(TAG, "Motion early‑exit: $mLabel (conf=$mConf, vel=${bufferMeanVelocity()})")
                        lastDetectionTime = now
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

        // ---- Collecting UI update ----
        val elapsed = now - bufStartTime
        val progress = (elapsed.toFloat() / BUFFER_FILL_MS).coerceIn(0f, 1f)
        onCollecting?.invoke(CollectingState(progress, frameBuffer.size, velocity, isMotion, earlyExitStreak))

        // ---- Full buffer dual‑race ----
        if (elapsed >= BUFFER_FILL_MS && frameBuffer.size >= MIN_MOTION_FRAMES) {
            runDualRace(now, frameBuffer.toList())
            resetBuffers()
        }
    }

    // ---------- Dual‑race (motion only if velocity is high) ----------
    private fun runDualRace(now: Long, frames: List<FloatArray>) {
        val meanVel = bufferMeanVelocityOf(frames)
        val adaptiveThreshold = adaptiveMotionThreshold(meanVel)
        val skipLstm = meanVel < LSTM_SKIP_THRESHOLD
        val motionProbeArmed = (now - lastMotionDetectionTime) >= MOTION_SETTLE_MS

        val staticResult = runStaticOnFrames(frames.takeLast(STATIC_AVG_FRAMES))
        val motionResult = if (!skipLstm && motionProbeArmed) runMotionInference(frames) else null

        // Static high confidence detection
        var staticHighConf = false
        var staticConf = 0f
        var staticLabel = ""
        if (staticResult != null) {
            staticConf = staticResult.second
            staticLabel = staticLabels.getOrNull(staticResult.first) ?: ""
            staticHighConf = staticConf >= STATIC_HIGH_CONF_THRESH
        }

        // Motion result evaluation – only if velocity is high enough
        if (motionResult != null && meanVel >= MOTION_VELOCITY_THRESH) {
            val (mIdx, mConf) = motionResult
            val mLabel = motionLabels.getOrNull(mIdx) ?: return

            // Discount confidence slightly for borderline velocity (optional)
            val velocityFactor = (meanVel / MOTION_VELOCITY_THRESH).coerceIn(0.7f, 1.0f)
            val adjustedConf = mConf * velocityFactor

            // Override by static: if static is very confident, motion must beat it by a margin
            val overrideByStatic = staticHighConf && (adjustedConf < staticConf + MOTION_CONF_MARGIN)

            if (adjustedConf >= adaptiveThreshold && !overrideByStatic) {
                Log.i(TAG, "Motion detected: $mLabel (rawConf=$mConf, adjConf=$adjustedConf, vel=$meanVel)")
                lastDetectionTime = now
                lastMotionDetectionTime = now
                onResult?.invoke(PredictionResult(mLabel, mConf, true))
                return
            } else {
                Log.d(TAG, "Motion rejected: $mLabel (adjConf=$adjustedConf, thresh=$adaptiveThreshold, override=$overrideByStatic)")
            }
        }

        // Static result fallback
        if (staticResult != null) {
            val (sIdx, sConf) = staticResult
            val sLabel = staticLabels.getOrNull(sIdx) ?: return
            if (!motionLabels.contains(sLabel) && sConf >= STATIC_THRESHOLD) {
                Log.i(TAG, "Static detected: $sLabel (conf=$sConf)")
                lastDetectionTime = now
                onResult?.invoke(PredictionResult(sLabel, sConf, false))
            }
        }
    }

    // ---------- Inference helpers (unchanged) -------------------------
    private fun runStaticOnFrames(frames: List<FloatArray>): Pair<Int, Float>? {
        val interp = staticInterp ?: return null
        if (staticLabels.isEmpty() || frames.isEmpty()) return null
        val sumProbs = FloatArray(staticLabels.size)
        val input = Array(1) { FloatArray(126) }
        val output = Array(1) { FloatArray(staticLabels.size) }
        var count = 0
        for (frame in frames) {
            if (accumulateStatic(interp, frame, input, output, sumProbs)) count++
            if (isSingleHand(frame) && accumulateStatic(interp, mirrorHandX(frame), input, output, sumProbs)) count++
        }
        if (count == 0) return null
        val countF = count.toFloat()
        for (i in sumProbs.indices) sumProbs[i] /= countF
        val idx = sumProbs.indices.filter { staticLabels.getOrNull(it) != "J" }.maxByOrNull { sumProbs[it] } ?: return null
        return Pair(idx, sumProbs[idx])
    }

    private fun accumulateStatic(interp: Interpreter, frame: FloatArray, input: Array<FloatArray>, output: Array<FloatArray>, sumProbs: FloatArray): Boolean {
        input[0] = frame
        return try {
            interp.run(input, output)
            for (i in output[0].indices) sumProbs[i] += output[0][i]
            true
        } catch (_: Exception) { false }
    }

    private fun runMotionInference(frames: List<FloatArray>): Pair<Int, Float>? {
        val interp = motionInterp ?: return null
        if (frames.size < MIN_MOTION_FRAMES) return null
        val trimmed = trimBufToMotion(frames)
        val seq = extractMotionWindow(trimmed)
        val result1 = runMotionOnSequence(interp, seq)
        val singleHandCount = seq.count { isSingleHand(it) }
        if (singleHandCount > seq.size / 2) {
            val mirroredSeq = seq.map { if (isSingleHand(it)) mirrorHandX(it) else it }
            val result2 = runMotionOnSequence(interp, mirroredSeq)
            if (result2 != null && (result1 == null || result2.second > result1.second)) return result2
        }
        return result1
    }

    private fun runMotionOnSequence(interp: Interpreter, seq: List<FloatArray>): Pair<Int, Float>? {
        val input = Array(1) { Array(SEQUENCE_LENGTH) { i -> seq[i] } }
        val output = Array(1) { FloatArray(motionLabels.size) }
        return try {
            interp.run(input, output)
            val probs = output[0]
            val idx = probs.indices.filter { motionLabels.getOrNull(it) != "J" }.maxByOrNull { probs[it] } ?: return null
            Pair(idx, probs[idx])
        } catch (_: Exception) { null }
    }

    private fun trimBufToMotion(frames: List<FloatArray>): List<FloatArray> {
        if (frames.size < MIN_MOTION_FRAMES * 2) return frames
        val profile = FloatArray(frames.size - 1) { i -> keyXYDist(frames[i + 1], frames[i]) }
        var start = 0
        var end = frames.size
        for (i in profile.indices) { if (profile[i] >= VELOCITY_TRIM_THRESHOLD) { start = i; break } }
        for (i in profile.indices.reversed()) { if (profile[i] >= VELOCITY_TRIM_THRESHOLD) { end = minOf(frames.size, i + 2); break } }
        val trimmed = frames.subList(start, end)
        return if (trimmed.size >= MIN_MOTION_FRAMES) trimmed else frames
    }

    private fun extractMotionWindow(frames: List<FloatArray>): List<FloatArray> {
        if (frames.size <= SEQUENCE_LENGTH) {
            val w = frames.toMutableList()
            while (w.size < SEQUENCE_LENGTH) w.add(w.last())
            return w
        }
        val profile = FloatArray(frames.size - 1) { i -> keyXYDist(frames[i + 1], frames[i]) }
        val winLen = SEQUENCE_LENGTH - 1
        var bestStart = 0
        var bestSum = 0f
        var curSum = 0f
        for (i in 0 until minOf(winLen, profile.size)) curSum += profile[i]
        bestSum = curSum
        for (i in 1..(profile.size - winLen)) {
            curSum += profile[i + winLen - 1] - profile[i - 1]
            if (curSum > bestSum) { bestSum = curSum; bestStart = i }
        }
        val end = minOf(bestStart + SEQUENCE_LENGTH, frames.size)
        val window = frames.subList(bestStart, end).toMutableList()
        while (window.size < SEQUENCE_LENGTH) window.add(window.last())
        return window
    }

    // ---------- Velocity utilities -------------------------------------
    private fun computeVelocity(features: FloatArray): Float {
        for (i in KEY_XY.indices) keyXYScratch[i] = features[KEY_XY[i]]
        val prev = lastKeyXY
        lastKeyXY = keyXYScratch.copyOf()
        val instantV = if (prev != null) euclideanDist(keyXYScratch, prev) else 0f
        velocityHistory.addLast(instantV)
        if (velocityHistory.size > VELOCITY_WINDOW) velocityHistory.removeFirst()
        return velocityHistory.average().toFloat()
    }

    private fun keyXYDist(a: FloatArray, b: FloatArray): Float {
        var sum = 0f
        for (k in KEY_XY) { val d = a[k] - b[k]; sum += d * d }
        return sqrt(sum)
    }

    private fun bufferMeanVelocity(): Float = bufferMeanVelocityOf(frameBuffer.toList())
    private fun bufferMeanVelocityOf(frames: List<FloatArray>): Float {
        if (frames.size < 2) return 0f
        var total = 0f
        for (i in 1 until frames.size) total += keyXYDist(frames[i], frames[i - 1])
        return total / (frames.size - 1)
    }

    private fun euclideanDist(a: FloatArray, b: FloatArray): Float {
        var sum = 0f
        for (i in a.indices) { val d = a[i] - b[i]; sum += d * d }
        return sqrt(sum)
    }

    // ---------- Reset -------------------------------------------------
    private fun resetBuffers() {
        frameBuffer.clear()
        velocityHistory.clear()
        lastKeyXY = null
        collecting = false
        bufStartTime = 0L
        earlyExitStreak = 0
        earlyExitLabel = -1
        motionEarlyStreak = 0
        motionEarlyLabel = -1
        framesSinceMotionRun = 0
        sustainedMotionFrames = 0
    }

    fun reset() {
        resetBuffers()
        noHandFrames = 0
        staticHistory.clear()
    }

    fun close() {
        staticInterp?.close()
        motionInterp?.close()
    }
}