package com.example.sigla

import android.content.Context
import android.util.Log
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.FileInputStream
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.sqrt
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers

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
private const val MOTION_EARLY_STREAK    = 5      // consistent frames before firing early
private const val EARLY_EXIT_THRESHOLD   = 0.95f  // very-high confidence fires immediately
private const val EARLY_EXIT_STREAK      = 6
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

    // Model
    private var motionInterp: Interpreter? = null
    private var motionLabels: List<String> = emptyList()

    var isReady = false
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

    fun init() {
        try {
            Log.d(TAG, "=== INIT START ===")
            val options = Interpreter.Options().apply { numThreads = 2 }

            // Load the model from assets or internal storage
            val motionBuf = loadModelOrNull("sign_model_motion.tflite")
            if (motionBuf == null) {
                Log.e(TAG, "Motion model not found")
                return
            }
            motionInterp = Interpreter(motionBuf, options)
            Log.d(TAG, "Interpreter created")

            // Fetch labels from the backend
            fetchLabelsFromBackend { labels ->
                if (labels != null && labels.isNotEmpty()) {
                    motionLabels = labels
                    motionOutputArr = arrayOf(FloatArray(motionLabels.size))
                    isReady = true
                    Log.i(TAG, "✅ Motion model loaded — ${motionLabels.size} classes")
                } else {
                    Log.e(TAG, "Failed to fetch labels from backend")
                    motionInterp?.close()
                    motionInterp = null
                }
            }
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
            val obj = org.json.JSONObject(text)
            val size = obj.length()
            val list = ArrayList<String>(size)
            for (i in 0 until size) list.add(obj.optString(i.toString(), ""))
            list
        } catch (_: Exception) {
            null
        }
    }

    // ── Frame processing ────────────────────────────────────────────────────────

    fun processFrame(features: FloatArray, handsDetected: Int) {
        if (!isReady) return

        // No hands — count towards a timeout, then notify + reset.
        if (handsDetected == 0) {
            noHandFrames++
            if (noHandFrames >= NO_HAND_TIMEOUT && (collecting || frameBuffer.isNotEmpty())) {
                // Flush: a FAST sign may have ended before the sliding window fired.
                // If enough frames were collected, run one final forced inference so the
                // just-completed gesture still gets classified (extractMotionWindow pads
                // short sequences to SEQUENCE_LENGTH). fire() resets the buffer on success.
                if (frameBuffer.size >= MIN_MOTION_FRAMES &&
                    System.currentTimeMillis() - lastDetectionTime >= DETECTION_COOLDOWN_MS
                ) {
                    runAndMaybeFire(System.currentTimeMillis(), force = true)
                }
                if (frameBuffer.isNotEmpty() || collecting) {
                    onNoHands?.invoke()
                    resetBuffers()
                }
            }
            return
        }
        noHandFrames = 0

        // Respect cooldown after a detection.
        val now = System.currentTimeMillis()
        if (now - lastDetectionTime < DETECTION_COOLDOWN_MS) return

        // Buffer the frame.
        if (!collecting) {
            collecting = true
            bufStartTime = now
        }
        frameBuffer.addLast(features)
        while (frameBuffer.size > BUFFER_CAPACITY) frameBuffer.removeFirst()

        val meanVel = computeVelocity(features)

        // Report collecting progress to the UI.
        val progress = (frameBuffer.size.toFloat() / SEQUENCE_LENGTH).coerceAtMost(1f)
        onCollecting?.invoke(
            CollectingState(progress = progress, frames = frameBuffer.size, velocity = meanVel)
        )

        // Run inference on a sliding window every MOTION_SLIDE_INTERVAL frames.
        framesSinceMotionRun++
        if (frameBuffer.size >= MIN_MOTION_FRAMES &&
            framesSinceMotionRun >= MOTION_SLIDE_INTERVAL
        ) {
            framesSinceMotionRun = 0
            runAndMaybeFire(now)
        }

        // Time-based fallback: once the window has been filling for a while, force a run.
        if (now - bufStartTime >= BUFFER_FILL_MS && frameBuffer.size >= SEQUENCE_LENGTH) {
            runAndMaybeFire(now, force = true)
        }
    }

    private fun runAndMaybeFire(now: Long, force: Boolean = false) {
        val result = runMotionInference(frameBuffer.toList()) ?: return
        val (idx, conf) = result
        val label = motionLabels.getOrNull(idx) ?: return

        // Immediate fire on very high confidence.
        if (conf >= EARLY_EXIT_THRESHOLD) {
            if (motionEarlyLabel == idx) motionEarlyStreak++ else { motionEarlyLabel = idx; motionEarlyStreak = 1 }
            if (motionEarlyStreak >= EARLY_EXIT_STREAK || force) {
                fire(label, conf, earlyExit = true, now)
                return
            }
        }

        // Streak-based early exit at normal confidence.
        if (conf >= MOTION_EARLY_CONF) {
            if (motionEarlyLabel == idx) motionEarlyStreak++ else { motionEarlyLabel = idx; motionEarlyStreak = 1 }
            if (motionEarlyStreak >= MOTION_EARLY_STREAK) {
                fire(label, conf, earlyExit = false, now)
                return
            }
        } else {
            motionEarlyStreak = 0
            motionEarlyLabel = -1
        }

        // Forced (time-based) run: accept the top prediction if it clears the threshold.
        if (force && conf >= MOTION_THRESHOLD) {
            fire(label, conf, earlyExit = false, now)
        }
    }

    private fun fire(label: String, conf: Float, earlyExit: Boolean, now: Long) {
        onResult?.invoke(PredictionResult(label = label, confidence = conf, isMotion = true, earlyExit = earlyExit))
        lastDetectionTime = now
        resetBuffers()
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

    fun reset() {
        resetBuffers()
        noHandFrames = 0
    }

    fun close() {
        motionInterp?.close()
    }

    private fun fetchLabelsFromBackend(callback: (List<String>?) -> Unit) {
        // Check if we have cached labels
        val cachedLabels = loadLabelsOrNull("labels_motion.json")
        if (cachedLabels != null && cachedLabels.isNotEmpty()) {
            Log.d(TAG, "Using cached labels from internal storage")
            callback(cachedLabels)
            return
        }

        // Fetch from backend
        try {
            Log.d(TAG, "Fetching labels from backend...")
            val token = SessionManager.getInstance(context).token ?: ""

            // Use coroutines for async call
            kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                try {
                    val response = ApiClient.get(token).getWordBank()
                    if (response.isSuccessful) {
                        val words = response.body()?.words ?: emptyList()
                        if (words.isNotEmpty()) {
                            // Create labels from words
                            val labels = words.map { it.label }
                            Log.d(TAG, "Fetched ${labels.size} labels from backend")

                            // Cache the labels for offline use
                            cacheLabels(labels)

                            kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.Main) {
                                callback(labels)
                            }
                        } else {
                            Log.e(TAG, "No words found in backend")
                            kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.Main) {
                                callback(null)
                            }
                        }
                    } else {
                        Log.e(TAG, "Failed to fetch words: ${response.code()}")
                        kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.Main) {
                            callback(null)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error fetching labels: ${e.message}", e)
                    kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.Main) {
                        callback(null)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error: ${e.message}", e)
            callback(null)
        }
    }
    private fun cacheLabels(labels: List<String>) {
        try {
            val json = org.json.JSONObject()
            labels.forEachIndexed { index, label ->
                json.put(index.toString(), label)
            }
            val file = File(context.filesDir, "labels_motion.json")
            file.writeText(json.toString())
            Log.d(TAG, "Labels cached to internal storage")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to cache labels: ${e.message}", e)
        }
    }
}
