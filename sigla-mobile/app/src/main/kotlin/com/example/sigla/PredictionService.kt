package com.example.sigla

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.tensorflow.lite.Interpreter
import kotlin.math.sqrt

// ── Constants ─────────────────────────────────────────────────────────────────
private const val TAG                    = "PredictionService"
private const val SEQUENCE_LENGTH        = 30    // model input size
private const val MIN_MOTION_FRAMES      = 8     // start running motion inference early
private const val MOTION_SLIDE_INTERVAL  = 2     // re-run motion every N frames
private const val MOTION_EARLY_CONF      = 0.92f // requires very strong J/Z signal before early exit
private const val MOTION_EARLY_STREAK    = 4     // more consecutive hits needed to fire early
private const val MOTION_VELOCITY_STREAK = 10    // more sustained movement required before motion probe runs
private const val STATIC_THRESHOLD       = 0.40f
private const val MOTION_THRESHOLD       = 0.75f // raised — motion must win more decisively in dual-race
private const val VELOCITY_WINDOW        = 8
private const val MOTION_VELOCITY_THRESH = 0.010f // raised — small repositioning movements ignored
private const val EARLY_EXIT_STREAK      = 4
private const val EARLY_EXIT_THRESHOLD   = 0.95f
private const val STATIC_AVG_FRAMES      = 6     // frames to average for static early-exit
private const val STATIC_SMOOTH_FRAMES   = 6     // frames to average in dual-race static result
private const val BUFFER_CAPACITY        = 90    // supports time-based buffering
private const val NO_HAND_TIMEOUT        = 6
private const val BUFFER_FILL_MS         = 1500L // fire dual-race after 1.5s (time-based)
private const val DETECTION_COOLDOWN_MS  = 3500L  // wait before accepting next gesture
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

    // Motion early-exit (sliding window)
    private var motionEarlyStreak    = 0
    private var motionEarlyLabel     = -1
    private var framesSinceMotionRun = 0

    // Cooldown — prevents next gesture bleeding into previous detection window
    private var lastDetectionTime        = 0L
    private var lastMotionDetectionTime  = 0L  // tracks when last motion gesture fired — gates re-arm
    private var sustainedMotionFrames    = 0   // consecutive frames above velocity threshold

    // ── Init ──────────────────────────────────────────────────────────────────

    fun init() {
        val options = Interpreter.Options().apply { numThreads = 4 }

        // Static model is required — model and labels must be loaded as a matched pair
        val (sInterp, sLabels) = loadModelPair(
            "sign_model_static.tflite", "labels_static.json", options
        )
        if (sInterp == null || sLabels == null) {
            Log.e(TAG, "Failed to load static model")
            return
        }
        staticInterp = sInterp
        staticLabels = sLabels

        // Motion model is optional
        val (mInterp, mLabels) = loadModelPair(
            "sign_model_motion.tflite", "labels_motion.json", options
        )
        if (mInterp != null && mLabels != null) {
            motionInterp = mInterp
            motionLabels = mLabels
        } else {
            Log.w(TAG, "Motion model not available, running static-only")
            motionInterp = null
            motionLabels = emptyList()
        }

        isReady = true
        Log.i(TAG, "Models loaded — static: ${staticLabels.size} classes, " +
                "motion: ${motionLabels.size} classes")
    }

    /**
     * Loads a model + its labels as a matched pair from internal storage only.
     * Bundled assets are never used — only models deployed by the admin are loaded.
     * If the local files are missing or corrupt, returns null.
     */
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
            // Use File constructor — avoids MappedByteBuffer GC issues
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
        while (json.has(i.toString())) {
            result.add(json.getString(i.toString()))
            i++
        }
        return result
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

        noHandFrames = 0
        collecting   = true

        // Start timer on first frame of a new gesture
        if (bufStartTime == 0L) bufStartTime = now

        frameBuffer.addLast(features.copyOf())
        if (frameBuffer.size > BUFFER_CAPACITY) frameBuffer.removeFirst()

        val velocity = computeVelocity(features)
        val isMotion = velocity > MOTION_VELOCITY_THRESH
        framesSinceMotionRun++

        // Track consecutive frames of sustained movement
        if (velocity >= MOTION_VELOCITY_THRESH) {
            sustainedMotionFrames++
        } else {
            sustainedMotionFrames = 0
        }

        // Motion probe only re-arms after MOTION_SETTLE_MS has passed since the
        // last motion detection. This is time-based so it works correctly even
        // during cooldown when processFrame returns early — no frame counting needed.
        val motionProbeArmed = (now - lastMotionDetectionTime) >= MOTION_SETTLE_MS

        // ── Static early-exit (averaged over recent frames) ───────────────────
        val staticResult = runAveragedStaticInference()
        if (staticResult != null) {
            staticVoteBuffer.addLast(staticResult)
            if (staticVoteBuffer.size > STATIC_SMOOTH_FRAMES) staticVoteBuffer.removeFirst()

            val (idx, conf)         = staticResult
            val label               = staticLabels.getOrNull(idx) ?: ""
            val isMotionGesture     = motionLabels.contains(label)
            val conflictsWithMotion = MOTION_CONFLICTS.containsKey(label)

            if (!isMotionGesture && conf >= EARLY_EXIT_THRESHOLD) {
                // Suppress only conflict labels when hand is moving — all others fire normally
                if (conflictsWithMotion && velocity >= MOTION_VELOCITY_THRESH) {
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
            && bufferMeanVelocity() >= MOTION_VELOCITY_THRESH) {

            framesSinceMotionRun = 0
            val motionResult = runMotionInference(frameBuffer.toList())
            if (motionResult != null) {
                val (mIdx, mConf)   = motionResult
                val mLabel          = motionLabels.getOrNull(mIdx) ?: ""
                val isMotionGesture = motionLabels.contains(mLabel)
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
        } else if (velocity < MOTION_VELOCITY_THRESH) {
            // Hand is still — reset motion early-exit streak so it doesn't
            // carry over from a previous frame where hand happened to move
            framesSinceMotionRun++
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
            runDualRace(now)
            resetBuffers()
        }
    }

    // ── Dual-race inference ───────────────────────────────────────────────────

    private fun runDualRace(now: Long) {
        val frames  = frameBuffer.toList()
        val meanVel = bufferMeanVelocity()

        // Motion only allowed in dual-race if settle time has passed since last motion detection
        val motionProbeArmed = (now - lastMotionDetectionTime) >= MOTION_SETTLE_MS

        val staticResult = getSmoothedStaticResult()
        val motionResult = if (motionProbeArmed) runMotionInference(frames) else null

        if (motionResult != null) {
            val (mIdx, mConf)   = motionResult
            val mLabel          = motionLabels.getOrNull(mIdx) ?: return
            val isMotionGesture = motionLabels.contains(mLabel)
            // Motion only wins if buffer mean velocity confirms real movement
            if (isMotionGesture && mConf >= MOTION_THRESHOLD
                && meanVel >= MOTION_VELOCITY_THRESH) {
                lastDetectionTime       = now
                lastMotionDetectionTime = now
                onResult?.invoke(PredictionResult(mLabel, mConf, isMotion = true))
                return
            }
        }

        if (staticResult != null) {
            val (sIdx, sConf)   = staticResult
            val sLabel          = staticLabels.getOrNull(sIdx) ?: return
            val isMotionGesture = motionLabels.contains(sLabel)
            if (!isMotionGesture && sConf >= STATIC_THRESHOLD) {
                lastDetectionTime = now
                onResult?.invoke(PredictionResult(sLabel, sConf, isMotion = false))
            }
        }
    }

    // ── Static inference ──────────────────────────────────────────────────────

    // Average softmax over recent buffer frames — suppresses per-frame noise
    // so early-exit fires more confidently and sooner
    private fun runAveragedStaticInference(): Pair<Int, Float>? {
        val interp = staticInterp ?: return null
        if (staticLabels.isEmpty()) return null
        val recent = frameBuffer.takeLast(STATIC_AVG_FRAMES)
        if (recent.isEmpty()) return null

        val sumProbs = FloatArray(staticLabels.size)
        var count    = 0
        for (frame in recent) {
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
        for (i in sumProbs.indices) sumProbs[i] /= countF
        val idx = sumProbs.indices.maxByOrNull { sumProbs[it] } ?: return null
        return Pair(idx, sumProbs[idx])
    }

    private fun getSmoothedStaticResult(): Pair<Int, Float>? {
        val interp       = staticInterp ?: return null
        val recentFrames = frameBuffer.takeLast(STATIC_SMOOTH_FRAMES)
        if (recentFrames.isEmpty()) return null

        val sumProbs = FloatArray(staticLabels.size)
        var count    = 0
        for (frame in recentFrames) {
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
        for (i in sumProbs.indices) sumProbs[i] /= countF
        val idx = sumProbs.indices.maxByOrNull { sumProbs[it] } ?: return null
        return Pair(idx, sumProbs[idx])
    }

    // ── Motion inference ──────────────────────────────────────────────────────

    // Mean frame-to-frame velocity across the whole buffer.
    // Used in dual-race to confirm the buffer actually contains real movement
    // before letting the motion model win.
    private fun bufferMeanVelocity(): Float {
        val frames = frameBuffer.toList()
        if (frames.size < 2) return 0f
        var total = 0f
        for (i in 1 until frames.size) {
            total += euclideanDist(
                KEY_XY.map { frames[i][it] }.toFloatArray(),
                KEY_XY.map { frames[i - 1][it] }.toFloatArray()
            )
        }
        return total / (frames.size - 1)
    }

    private fun runMotionInference(frames: List<FloatArray>): Pair<Int, Float>? {
        val interp = motionInterp ?: return null
        if (frames.size < MIN_MOTION_FRAMES) return null

        val seq    = extractMotionWindow(frames)
        val input  = Array(1) { Array(SEQUENCE_LENGTH) { i -> seq[i] } }
        val output = Array(1) { FloatArray(motionLabels.size) }
        return try {
            interp.run(input, output)
            val probs = output[0]
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
            val v = euclideanDist(
                KEY_XY.map { frames[i][it] }.toFloatArray(),
                KEY_XY.map { frames[i - 1][it] }.toFloatArray()
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
    }

    fun close() {
        staticInterp?.close()
        motionInterp?.close()
    }
}