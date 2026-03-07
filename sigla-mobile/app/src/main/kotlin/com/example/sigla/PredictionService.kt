package com.example.sigla

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.abs
import kotlin.math.sqrt

// ── Constants ─────────────────────────────────────────────────────────────────
private const val TAG                    = "PredictionService"
private const val FEATURE_SIZE           = 126
private const val SEQUENCE_LENGTH        = 30   // model input size
private const val MIN_MOTION_FRAMES      = 12   // start running motion inference early
private const val MOTION_SLIDE_INTERVAL  = 3    // re-run motion every N frames
private const val MOTION_EARLY_CONF      = 0.88f // fire motion immediately at this confidence
private const val MOTION_EARLY_STREAK    = 2    // consecutive hits needed to fire early
private const val STATIC_THRESHOLD       = 0.70f
private const val MOTION_THRESHOLD       = 0.75f
private const val VELOCITY_WINDOW        = 8
private const val MOTION_VELOCITY_THRESH = 0.012f
private const val EARLY_EXIT_STREAK      = 4
private const val EARLY_EXIT_THRESHOLD   = 0.95f
private const val STATIC_SMOOTH_FRAMES   = 3
private const val BUFFER_CAPACITY        = 60
private const val NO_HAND_TIMEOUT        = 6

// Key landmark indices for velocity (wrist + fingertips)
private val KEY_LANDMARKS = listOf(0, 4, 8, 12, 16, 20)
private val KEY_XY: List<Int> = KEY_LANDMARKS.flatMap { i ->
    listOf(i * 3, i * 3 + 1)
}

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
    private val frameBuffer = ArrayDeque<FloatArray>()
    private var noHandFrames = 0
    private var collecting   = false

    // Velocity
    private val velocityHistory = ArrayDeque<Float>()
    private var lastKeyXY: FloatArray? = null

    // Static early-exit
    private val staticVoteBuffer = ArrayDeque<Pair<Int, Float>>()
    private var earlyExitStreak  = 0
    private var earlyExitLabel   = -1

    // Motion early-exit (sliding window)
    private var motionEarlyStreak = 0
    private var motionEarlyLabel  = -1
    private var framesSinceMotionRun = 0

    fun init() {
        try {
            staticInterp = Interpreter(loadModel("sign_model_static.tflite"))
            motionInterp = Interpreter(loadModel("sign_model_motion.tflite"))
            staticLabels = loadLabels("labels_static.json")
            motionLabels = loadLabels("labels_motion.json")
            gestureConfig = loadGestureConfig()
            isReady = true
            Log.i(TAG, "Models loaded — static: ${staticLabels.size} classes, " +
                    "motion: ${motionLabels.size} classes")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load models: ${e.message}")
        }
    }

    private fun loadModel(filename: String): MappedByteBuffer {
        val afd = context.assets.openFd(filename)
        val fis = FileInputStream(afd.fileDescriptor)
        val channel = fis.channel
        return channel.map(FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength)
    }

    private fun loadLabels(filename: String): List<String> {
        val json = JSONObject(context.assets.open(filename).bufferedReader().readText())
        val result = mutableListOf<String>()
        var i = 0
        while (json.has(i.toString())) {
            result.add(json.getString(i.toString()))
            i++
        }
        return result
    }

    private fun loadGestureConfig(): Map<String, GestureConfig> {
        if (!context.assets.list("")!!.contains("gesture_config.json")) return emptyMap()
        val json = JSONObject(context.assets.open("gesture_config.json").bufferedReader().readText())
        val result = mutableMapOf<String, GestureConfig>()
        for (key in json.keys()) {
            val obj = json.getJSONObject(key)
            result[key] = GestureConfig(
                oneHanded     = obj.optBoolean("one_handed", true),
                normalizeHand = obj.optBoolean("normalize_hand", true),
                motion        = obj.optBoolean("motion", false)
            )
        }
        return result
    }

    // ── Main entry point ──────────────────────────────────────────────────────

    fun processFrame(features: FloatArray, handsDetected: Int) {
        if (!isReady) return

        if (handsDetected == 0) {
            noHandFrames++
            if (noHandFrames > NO_HAND_TIMEOUT) {
                if (collecting || frameBuffer.isNotEmpty()) {
                    frameBuffer.clear()
                    collecting            = false
                    lastKeyXY             = null
                    velocityHistory.clear()
                    staticVoteBuffer.clear()
                    earlyExitStreak       = 0
                    motionEarlyStreak     = 0
                    motionEarlyLabel      = -1
                    framesSinceMotionRun  = 0
                }
                onNoHands?.invoke()
            }
            return
        }

        noHandFrames = 0
        collecting   = true

        frameBuffer.addLast(features.copyOf())
        if (frameBuffer.size > BUFFER_CAPACITY) frameBuffer.removeFirst()

        val velocity = computeVelocity(features)
        val isMotion = velocity > MOTION_VELOCITY_THRESH
        framesSinceMotionRun++

        // ── Static early-exit ────────────────────────────────────────────────
        val staticResult = runStaticInference(features)
        if (staticResult != null) {
            staticVoteBuffer.addLast(staticResult)
            if (staticVoteBuffer.size > STATIC_SMOOTH_FRAMES) staticVoteBuffer.removeFirst()

            val (idx, conf) = staticResult
            val label = staticLabels.getOrNull(idx) ?: ""
            val isMotionGesture = gestureConfig[label]?.motion == true
            if (!isMotionGesture && conf >= EARLY_EXIT_THRESHOLD) {
                if (idx == earlyExitLabel) earlyExitStreak++ else { earlyExitStreak = 1; earlyExitLabel = idx }
                if (earlyExitStreak >= EARLY_EXIT_STREAK) {
                    earlyExitStreak = 0; motionEarlyStreak = 0; framesSinceMotionRun = 0
                    onResult?.invoke(PredictionResult(label, conf, false, earlyExit = true))
                    frameBuffer.clear(); staticVoteBuffer.clear()
                    return
                }
            } else {
                if (idx != earlyExitLabel) { earlyExitStreak = 0; earlyExitLabel = idx }
            }
        }

        // ── Motion sliding-window early-exit ─────────────────────────────────
        // Start probing from MIN_MOTION_FRAMES, re-probe every MOTION_SLIDE_INTERVAL frames.
        // Pads/trims buffer to SEQUENCE_LENGTH for the model.
        if (frameBuffer.size >= MIN_MOTION_FRAMES && framesSinceMotionRun >= MOTION_SLIDE_INTERVAL) {
            framesSinceMotionRun = 0
            val motionResult = runMotionInference(frameBuffer.toList())
            if (motionResult != null) {
                val (mIdx, mConf) = motionResult
                val mLabel = motionLabels.getOrNull(mIdx) ?: ""
                val isMotionGesture = gestureConfig[mLabel]?.motion == true
                if (isMotionGesture && mConf >= MOTION_EARLY_CONF) {
                    if (mIdx == motionEarlyLabel) motionEarlyStreak++ else { motionEarlyStreak = 1; motionEarlyLabel = mIdx }
                    if (motionEarlyStreak >= MOTION_EARLY_STREAK) {
                        motionEarlyStreak = 0; earlyExitStreak = 0; framesSinceMotionRun = 0
                        onResult?.invoke(PredictionResult(mLabel, mConf, true, earlyExit = true))
                        frameBuffer.clear(); staticVoteBuffer.clear()
                        return
                    }
                } else {
                    if (mIdx != motionEarlyLabel) { motionEarlyStreak = 0; motionEarlyLabel = mIdx }
                }
            }
        }

        onCollecting?.invoke(CollectingState(
            progress = (frameBuffer.size.toFloat() / SEQUENCE_LENGTH).coerceIn(0f, 1f),
            frames   = frameBuffer.size,
            velocity = velocity,
            isMotion = isMotion,
            streak   = earlyExitStreak
        ))

        // ── Full dual-race at 30 frames ───────────────────────────────────────
        if (frameBuffer.size >= SEQUENCE_LENGTH) {
            runDualRace()
            frameBuffer.clear()
            staticVoteBuffer.clear()
            earlyExitStreak      = 0
            motionEarlyStreak    = 0
            framesSinceMotionRun = 0
        }
    }

    // ── Dual-race inference ───────────────────────────────────────────────────

    private fun runDualRace() {
        val frames = frameBuffer.toList()

        // Static result: average softmax over last STATIC_SMOOTH_FRAMES frames
        val staticResult = getSmoothedStaticResult()

        // Motion result: run LSTM on full 30-frame sequence
        val motionResult = runMotionInference(frames)

        // Decision logic
        if (motionResult != null) {
            val (mIdx, mConf) = motionResult
            val mLabel = motionLabels.getOrNull(mIdx) ?: return
            val isMotionGesture = gestureConfig[mLabel]?.motion == true

            if (isMotionGesture && mConf >= MOTION_THRESHOLD) {
                // Motion wins unconditionally for motion-labelled gestures
                onResult?.invoke(PredictionResult(mLabel, mConf, isMotion = true))
                return
            }
        }

        // Static wins
        if (staticResult != null) {
            val (sIdx, sConf) = staticResult
            val sLabel = staticLabels.getOrNull(sIdx) ?: return
            val isMotionGesture = gestureConfig[sLabel]?.motion == true
            if (!isMotionGesture && sConf >= STATIC_THRESHOLD) {
                onResult?.invoke(PredictionResult(sLabel, sConf, isMotion = false))
            }
        }
    }

    // ── Static inference ──────────────────────────────────────────────────────

    private fun runStaticInference(features: FloatArray): Pair<Int, Float>? {
        val interp = staticInterp ?: return null
        val input  = Array(1) { features }
        val output = Array(1) { FloatArray(staticLabels.size) }
        return try {
            interp.run(input, output)
            val probs = output[0]
            val idx   = probs.indices.maxByOrNull { probs[it] } ?: return null
            Pair(idx, probs[idx])
        } catch (e: Exception) { null }
    }

    private fun getSmoothedStaticResult(): Pair<Int, Float>? {
        if (staticVoteBuffer.isEmpty()) return null
        // Re-run on last few frames and average
        val recentFrames = frameBuffer.takeLast(STATIC_SMOOTH_FRAMES)
        if (recentFrames.isEmpty()) return null

        val sumProbs = FloatArray(staticLabels.size)
        var count = 0
        for (frame in recentFrames) {
            val interp = staticInterp ?: continue
            val input  = Array(1) { frame }
            val output = Array(1) { FloatArray(staticLabels.size) }
            try {
                interp.run(input, output)
                for (i in output[0].indices) sumProbs[i] += output[0][i]
                count++
            } catch (_: Exception) {}
        }
        if (count == 0) return null
        val countF = count.toFloat()
        for (i in sumProbs.indices) sumProbs[i] = sumProbs[i] / countF
        val idx = sumProbs.indices.maxByOrNull { sumProbs[it] } ?: return null
        return Pair(idx, sumProbs[idx])
    }

    // ── Motion inference ──────────────────────────────────────────────────────

    private fun runMotionInference(frames: List<FloatArray>): Pair<Int, Float>? {
        val interp = motionInterp ?: return null
        if (frames.size < MIN_MOTION_FRAMES) return null

        // Extract/pad to exactly SEQUENCE_LENGTH
        val seq = extractMotionWindow(frames)

        val input  = Array(1) { Array(SEQUENCE_LENGTH) { i -> seq[i] } }
        val output = Array(1) { FloatArray(motionLabels.size) }
        return try {
            interp.run(input, output)
            val probs = output[0]
            val idx   = probs.indices.maxByOrNull { probs[it] } ?: return null
            Pair(idx, probs[idx])
        } catch (e: Exception) { null }
    }

    private fun extractMotionWindow(frames: List<FloatArray>): List<FloatArray> {
        if (frames.size == SEQUENCE_LENGTH) return frames

        // Find frame with highest velocity as peak
        var peakIdx  = frames.size / 2
        var peakVel  = 0f
        for (i in 1 until frames.size) {
            val v = euclideanDist(
                KEY_XY.map { frames[i][it] }.toFloatArray(),
                KEY_XY.map { frames[i-1][it] }.toFloatArray()
            )
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
        val keyXY = KEY_XY.map { features[it] }.toFloatArray()
        val prev  = lastKeyXY
        lastKeyXY = keyXY

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

    fun reset() {
        frameBuffer.clear()
        velocityHistory.clear()
        staticVoteBuffer.clear()
        lastKeyXY            = null
        noHandFrames         = 0
        collecting           = false
        earlyExitStreak      = 0
        earlyExitLabel       = -1
        motionEarlyStreak    = 0
        motionEarlyLabel     = -1
        framesSinceMotionRun = 0
    }

    fun close() {
        staticInterp?.close()
        motionInterp?.close()
    }
}
