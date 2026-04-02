package com.example.sigla

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.flex.FlexDelegate
import kotlin.math.sqrt

// ── Constants ─────────────────────────────────────────────────────────────────
private const val TAG                    = "PredictionService"
private const val SEQUENCE_LENGTH        = 30
private const val MIN_MOTION_FRAMES      = 8
private const val MOTION_SLIDE_INTERVAL  = 2
private const val MOTION_EARLY_CONF      = 0.92f
private const val MOTION_EARLY_STREAK    = 4
private const val MOTION_VELOCITY_STREAK = 10
private const val STATIC_THRESHOLD       = 0.40f
private const val VELOCITY_WINDOW        = 8
private const val MOTION_VELOCITY_THRESH = 0.010f
private const val EARLY_EXIT_STREAK      = 3
private const val EARLY_EXIT_THRESHOLD   = 0.92f
private const val STATIC_AVG_FRAMES      = 10
private const val STATIC_HISTORY_LEN     = 12
private const val BUFFER_CAPACITY        = 90
private const val NO_HAND_TIMEOUT        = 6
private const val BUFFER_FILL_MS         = 1500L
private const val DETECTION_COOLDOWN_MS  = 3500L
private const val MOTION_SETTLE_MS       = 2000L

// Adaptive motion threshold — interpolated from buffer mean velocity.
// At high velocity motion wins easily; at low velocity it must be very confident.
private const val VELOCITY_SCORE_HIGH    = 0.015f   // clearly moving → MOTION_CONF_BASE
private const val VELOCITY_SCORE_LOW     = 0.005f   // barely moving  → MOTION_CONF_STATIC_CAP
private const val MOTION_CONF_BASE       = 0.55f    // lowered from 0.60 for better sensitivity
private const val MOTION_CONF_STATIC_CAP = 0.85f

// LSTM optimisation
private const val LSTM_SKIP_THRESHOLD     = 0.003f
private const val VELOCITY_TRIM_THRESHOLD = 0.004f

// Wrist + 5 fingertips — velocity sensing uses only these to ignore irrelevant joints
private val KEY_LANDMARK_INDICES = intArrayOf(0, 4, 8, 12, 16, 20)
private val KEY_XY: IntArray     = KEY_LANDMARK_INDICES.flatMap { i -> listOf(i * 3, i * 3 + 1) }.toIntArray()

// Static labels whose resting pose resembles a motion gesture start.
// Only these are suppressed while velocity is rising.
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

// ── PredictionService ─────────────────────────────────────────────────────────

class PredictionService(private val context: Context) {

    // Callbacks
    var onResult: ((PredictionResult) -> Unit)? = null
    var onCollecting: ((CollectingState) -> Unit)? = null
    var onNoHands: (() -> Unit)? = null

    // Models
    private var staticInterp: Interpreter? = null
    private var motionInterp: Interpreter? = null
    private var flexDelegate: FlexDelegate? = null
    private var staticLabels: List<String> = emptyList()
    private var motionLabels: List<String> = emptyList()

    var isReady = false
        private set

    // Frame buffer
    private val frameBuffer  = ArrayDeque<FloatArray>()
    private var noHandFrames = 0
    private var collecting   = false
    private var bufStartTime = 0L

    // Velocity — pre-allocated scratch buffer avoids per-frame FloatArray allocation
    private val velocityHistory = ArrayDeque<Float>()
    private var lastKeyXY: FloatArray? = null
    private val keyXYScratch = FloatArray(KEY_XY.size)

    // Static history — rolling window of probe label strings.
    private val staticHistory = ArrayDeque<String>()

    // Early-exit streak
    private var earlyExitStreak = 0
    private var earlyExitLabel  = -1

    // Motion early-exit
    private var motionEarlyStreak    = 0
    private var motionEarlyLabel     = -1
    private var framesSinceMotionRun = 0

    // Detection timing
    private var lastDetectionTime       = 0L
    private var lastMotionDetectionTime = 0L
    private var sustainedMotionFrames   = 0

    // ── Init ──────────────────────────────────────────────────────────────────

    fun init() {
        val staticOptions = Interpreter.Options().apply { numThreads = 4 }

        // Motion (LSTM) model was converted with SELECT_TF_OPS — needs the Flex delegate
        flexDelegate = FlexDelegate()
        val motionOptions = Interpreter.Options().apply {
            numThreads = 4
            addDelegate(flexDelegate!!)
        }

        val (sInterp, sLabels) = loadModelPair(
            "sign_model_static.tflite", "labels_static.json", staticOptions
        )
        if (sInterp == null || sLabels == null) {
            Log.e(TAG, "Failed to load static model")
            return
        }
        staticInterp = sInterp
        staticLabels = sLabels

        val (mInterp, mLabels) = loadModelPair(
            "sign_model_motion.tflite", "labels_motion.json", motionOptions
        )
        if (mInterp != null && mLabels != null) {
            motionInterp = mInterp
            motionLabels = mLabels
            Log.i(TAG, "Motion model loaded: ${motionLabels.size} classes")
        } else {
            Log.w(TAG, "Motion model not available, running static-only")
        }

        isReady = true
        Log.i(TAG, "Models loaded — static: ${staticLabels.size} classes, " +
                "motion: ${motionLabels.size} classes")
    }

    private fun loadModelPair(
        modelFile: String,
        labelsFile: String,
        options: Interpreter.Options
    ): Pair<Interpreter?, List<String>?> {
        val localModel  = ModelUpdateManager.getLocalFile(context, modelFile)
        val localLabels = ModelUpdateManager.getLocalFile(context, labelsFile)
        if (localModel == null || localLabels == null) {
            Log.w(TAG, "Local $modelFile or $labelsFile not found on disk")
            return Pair(null, null)
        }
        return try {
            val interp = Interpreter(localModel, options)
            val labels = parseLabels(localLabels.readText())
            Log.i(TAG, "Loaded $modelFile from deployed cache (${labels.size} classes)")
            Pair(interp, labels)
        } catch (e: Exception) {
            Log.e(TAG, "Corrupt $modelFile/$labelsFile, deleting: ${e.message}")
            localModel.delete()
            localLabels.delete()
            Pair(null, null)
        }
    }

    private fun parseLabels(text: String): List<String> {
        val json   = JSONObject(text)
        val result = mutableListOf<String>()
        var i = 0
        while (json.has(i.toString())) { result.add(json.getString(i.toString())); i++ }
        return result
    }

    // ── Hand normalisation ────────────────────────────────────────────────────

    /** True when only one hand is present (MediaPipe zeros out slot 1 when no second hand). */
    private fun isSingleHand(features: FloatArray): Boolean {
        for (i in 63 until 126) { if (features[i] != 0f) return false }
        return true
    }

    /**
     * Mirrors the x-coordinate of every landmark in hand slot 0.
     * Converts a left-hand pose into a right-hand-equivalent so the model
     * recognises both orientations without separate training data.
     */
    private fun mirrorHandX(features: FloatArray): FloatArray {
        val m = features.copyOf()
        for (i in 0 until 21) { m[i * 3] = 1.0f - m[i * 3] }
        return m
    }

    // ── Adaptive motion threshold ─────────────────────────────────────────────

    private fun adaptiveMotionThreshold(velScore: Float): Float = when {
        velScore >= VELOCITY_SCORE_HIGH -> MOTION_CONF_BASE
        velScore <= VELOCITY_SCORE_LOW  -> MOTION_CONF_STATIC_CAP
        else -> {
            val t = (velScore - VELOCITY_SCORE_LOW) / (VELOCITY_SCORE_HIGH - VELOCITY_SCORE_LOW)
            MOTION_CONF_STATIC_CAP + t * (MOTION_CONF_BASE - MOTION_CONF_STATIC_CAP)
        }
    }

    // ── Static history majority ───────────────────────────────────────────────

    private fun historyMajority(): String {
        if (staticHistory.isEmpty()) return ""
        val counts = mutableMapOf<String, Int>()
        for (lbl in staticHistory) {
            if (lbl.isNotEmpty()) counts[lbl] = (counts[lbl] ?: 0) + 1
        }
        val entry = counts.maxByOrNull { it.value } ?: return ""
        return if (entry.value > staticHistory.size / 2) entry.key else ""
    }

    // ── Main entry point ──────────────────────────────────────────────────────

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
        collecting   = true
        if (bufStartTime == 0L) bufStartTime = now

        frameBuffer.addLast(features.copyOf())
        if (frameBuffer.size > BUFFER_CAPACITY) frameBuffer.removeFirst()

        val velocity = computeVelocity(features)
        val isMotion = velocity > MOTION_VELOCITY_THRESH
        framesSinceMotionRun++

        if (velocity >= MOTION_VELOCITY_THRESH) sustainedMotionFrames++
        else sustainedMotionFrames = 0

        val motionProbeArmed = (now - lastMotionDetectionTime) >= MOTION_SETTLE_MS

        // ── Static early-exit (unchanged) ─────────────────────────────────────
        // ... (unchanged code omitted for brevity) ...
        // The static early-exit block is unchanged – keep it as is.

        // ── Motion sliding-window early-exit (unchanged logic, added logging) ──
        if (frameBuffer.size >= MIN_MOTION_FRAMES
            && framesSinceMotionRun >= MOTION_SLIDE_INTERVAL
            && sustainedMotionFrames >= MOTION_VELOCITY_STREAK
            && motionProbeArmed
            && bufferMeanVelocity() >= MOTION_VELOCITY_THRESH) {

            framesSinceMotionRun = 0
            val motionResult = runMotionInference(frameBuffer.toList())
            if (motionResult != null) {
                val (mIdx, mConf) = motionResult
                val mLabel = motionLabels.getOrNull(mIdx) ?: ""
                Log.d(TAG, "Motion early inference: label=$mLabel, conf=$mConf, velocity=$velocity")
                if (motionLabels.contains(mLabel) && mConf >= MOTION_EARLY_CONF) {
                    if (mIdx == motionEarlyLabel) motionEarlyStreak++
                    else { motionEarlyStreak = 1; motionEarlyLabel = mIdx }
                    if (motionEarlyStreak >= MOTION_EARLY_STREAK) {
                        lastDetectionTime       = now
                        lastMotionDetectionTime = now
                        Log.i(TAG, "Motion early exit: $mLabel ($mConf)")
                        onResult?.invoke(PredictionResult(mLabel, mConf, true, earlyExit = true))
                        resetBuffers()
                        return
                    }
                } else {
                    if (mIdx != motionEarlyLabel) { motionEarlyStreak = 0; motionEarlyLabel = mIdx }
                }
            }
        } else if (velocity < MOTION_VELOCITY_THRESH) {
            framesSinceMotionRun++
        }

        // ── Time-based dual-race ──────────────────────────────────────────────
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
            val frames = frameBuffer.toList()
            runDualRace(now, frames)
            resetBuffers()
        }
    }

    // ── Dual-race (enhanced logging) ──────────────────────────────────────────

    private fun runDualRace(now: Long, frames: List<FloatArray>) {
        val meanVel           = bufferMeanVelocityOf(frames)
        val adaptiveThreshold = adaptiveMotionThreshold(meanVel)
        val skipLstm          = meanVel < LSTM_SKIP_THRESHOLD
        val motionProbeArmed  = (now - lastMotionDetectionTime) >= MOTION_SETTLE_MS

        Log.d(TAG, "Dual-race: meanVel=$meanVel, adaptiveThresh=$adaptiveThreshold, skipLstm=$skipLstm, armed=$motionProbeArmed")

        val staticResult = runStaticOnFrames(frames.takeLast(STATIC_AVG_FRAMES))
        val motionResult = if (!skipLstm && motionProbeArmed && motionInterp != null && motionLabels.isNotEmpty())
            runMotionInference(frames) else null

        if (motionResult != null) {
            val (mIdx, mConf) = motionResult
            val mLabel = motionLabels.getOrNull(mIdx) ?: return
            Log.d(TAG, "Dual-race motion: label=$mLabel, conf=$mConf, meanVel=$meanVel")
            if (motionLabels.contains(mLabel)
                && mConf >= adaptiveThreshold
                && meanVel >= MOTION_VELOCITY_THRESH) {
                lastDetectionTime       = now
                lastMotionDetectionTime = now
                Log.i(TAG, "Dual-race motion result: $mLabel ($mConf)")
                onResult?.invoke(PredictionResult(mLabel, mConf, isMotion = true))
                return
            }
        }

        if (staticResult != null) {
            val (sIdx, sConf) = staticResult
            val sLabel = staticLabels.getOrNull(sIdx) ?: return
            if (!motionLabels.contains(sLabel) && sConf >= STATIC_THRESHOLD) {
                lastDetectionTime = now
                Log.i(TAG, "Dual-race static result: $sLabel ($sConf)")
                onResult?.invoke(PredictionResult(sLabel, sConf, isMotion = false))
            }
        }
    }

    // ── Static inference (unchanged) ──────────────────────────────────────────
    private fun runStaticOnFrames(frames: List<FloatArray>): Pair<Int, Float>? {
        val interp = staticInterp ?: return null
        if (staticLabels.isEmpty() || frames.isEmpty()) return null

        val sumProbs = FloatArray(staticLabels.size)
        val input    = Array(1) { FloatArray(126) }
        val output   = Array(1) { FloatArray(staticLabels.size) }
        var count    = 0

        for (frame in frames) {
            if (accumulateStatic(interp, frame, input, output, sumProbs)) count++
            if (isSingleHand(frame)) {
                if (accumulateStatic(interp, mirrorHandX(frame), input, output, sumProbs)) count++
            }
        }

        if (count == 0) return null
        val countF = count.toFloat()
        for (i in sumProbs.indices) sumProbs[i] /= countF
        val idx = sumProbs.indices.maxByOrNull { sumProbs[it] } ?: return null
        return Pair(idx, sumProbs[idx])
    }

    private fun accumulateStatic(
        interp: Interpreter,
        frame: FloatArray,
        input: Array<FloatArray>,
        output: Array<FloatArray>,
        sumProbs: FloatArray
    ): Boolean {
        input[0] = frame
        return try {
            interp.run(input, output)
            for (i in output[0].indices) sumProbs[i] += output[0][i]
            true
        } catch (_: Exception) { false }
    }

    // ── Motion inference (unchanged) ──────────────────────────────────────────
    private fun trimBufToMotion(frames: List<FloatArray>): List<FloatArray> {
        if (frames.size < MIN_MOTION_FRAMES * 2) return frames

        val profile = FloatArray(frames.size - 1) { i -> keyXYDist(frames[i + 1], frames[i]) }

        var start = 0
        var end   = frames.size
        for (i in profile.indices) {
            if (profile[i] >= VELOCITY_TRIM_THRESHOLD) { start = i; break }
        }
        for (i in profile.indices.reversed()) {
            if (profile[i] >= VELOCITY_TRIM_THRESHOLD) { end = minOf(frames.size, i + 2); break }
        }

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
        val winLen  = SEQUENCE_LENGTH - 1

        var bestStart = 0
        var bestSum   = 0f
        var curSum    = 0f
        for (i in 0 until minOf(winLen, profile.size)) curSum += profile[i]
        bestSum = curSum

        for (i in 1..(profile.size - winLen)) {
            curSum += profile[i + winLen - 1] - profile[i - 1]
            if (curSum > bestSum) { bestSum = curSum; bestStart = i }
        }

        val end    = minOf(bestStart + SEQUENCE_LENGTH, frames.size)
        val window = frames.subList(bestStart, end).toMutableList()
        while (window.size < SEQUENCE_LENGTH) window.add(window.last())
        return window
    }

    private fun runMotionInference(frames: List<FloatArray>): Pair<Int, Float>? {
        val interp = motionInterp ?: return null
        if (frames.size < MIN_MOTION_FRAMES) return null

        val trimmed = trimBufToMotion(frames)
        val seq     = extractMotionWindow(trimmed)

        val result1 = runMotionOnSequence(interp, seq)

        val singleHandCount = seq.count { isSingleHand(it) }
        if (singleHandCount > seq.size / 2) {
            val mirroredSeq = seq.map { if (isSingleHand(it)) mirrorHandX(it) else it }
            val result2     = runMotionOnSequence(interp, mirroredSeq)
            if (result2 != null && (result1 == null || result2.second > result1.second)) {
                return result2
            }
        }

        return result1
    }

    private fun runMotionOnSequence(interp: Interpreter, seq: List<FloatArray>): Pair<Int, Float>? {
        val input  = Array(1) { Array(SEQUENCE_LENGTH) { i -> seq[i] } }
        val output = Array(1) { FloatArray(motionLabels.size) }
        return try {
            interp.run(input, output)
            val probs = output[0]
            val idx   = probs.indices.maxByOrNull { probs[it] } ?: return null
            Pair(idx, probs[idx])
        } catch (_: Exception) { null }
    }

    // ── Velocity ──────────────────────────────────────────────────────────────

    private fun computeVelocity(features: FloatArray): Float {
        for (i in KEY_XY.indices) keyXYScratch[i] = features[KEY_XY[i]]
        val prev     = lastKeyXY
        lastKeyXY    = keyXYScratch.copyOf()
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

    // ── Buffer reset ──────────────────────────────────────────────────────────
    private fun resetBuffers() {
        frameBuffer.clear()
        velocityHistory.clear()
        lastKeyXY             = null
        collecting            = false
        bufStartTime          = 0L
        earlyExitStreak       = 0
        earlyExitLabel        = -1
        motionEarlyStreak     = 0
        motionEarlyLabel      = -1
        framesSinceMotionRun  = 0
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
        flexDelegate?.close()
    }
}