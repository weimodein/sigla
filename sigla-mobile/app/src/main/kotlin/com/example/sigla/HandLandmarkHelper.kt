package com.example.sigla

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult

private const val TAG = "HandLandmarkHelper"

// Feature layout — MUST match sigla-ml (preprocessor.py / extract.py):
// [0..125]   2 hands × 21 landmarks × (x,y,z), normalized per hand block.
// [126..146] 7 upper-body pose keypoints × (x,y,z), normalized as one block.
// `internal` rather than `private` so FeatureParityTest can assert these against
// their sigla-ml counterparts — a constant edited on one side only is otherwise
// invisible until it corrupts features at runtime.
internal const val FEATURE_SIZE = 147
internal const val POSE_BASE    = 126
// MediaPipe Pose indices kept, in order: nose, Lshoulder, Rshoulder, Lelbow,
// Relbow, Lwrist, Rwrist. MUST equal extract.py _POSE_KEYPOINTS.
internal val POSE_KEYPOINTS = intArrayOf(0, 11, 12, 13, 14, 15, 16)
// Local pose-block indices of the shoulders (for normalization) — match preprocessor.py.
internal const val POSE_LSHOULDER = 1
internal const val POSE_RSHOULDER = 2

// Pose is detected only every Nth camera frame (hands run on every frame) and the
// most recent pose result is merged into each hand frame. This trades ≤N frames
// (~100 ms) of pose staleness for ~1/N of the pose compute — pose anchors
// (shoulders/nose) are near-static, so the normalized block barely changes between
// consecutive frames. Training uses same-frame pose; raise/lower this only with an
// on-device accuracy check.
private const val POSE_DETECT_INTERVAL = 2

data class LandmarkResult(
    val handsDetected: Int,
    val features: FloatArray,
    // Per hand: a flat FloatArray of interleaved x,y (21 landmarks → 42 floats) in raw
    // frame coords, for the on-screen overlay. Flat arrays avoid the ~42 boxed Pair
    // allocations per frame that were feeding the GC. Empty list = no hands.
    val landmarks: List<FloatArray>,
    // Dimensions of the image coordinate system used by MediaPipe after applying
    // ImageProcessingOptions rotation. OverlayView needs this aspect ratio to
    // reproduce PreviewView's FILL_CENTER crop instead of stretching landmarks.
    val sourceWidth: Int = 1,
    val sourceHeight: Int = 1,
    // Per hand-slot MediaPipe handedness ("Left"/"Right"/null) and its score,
    // aligned to the same slot index as `features` (slot 0 = features[0..62]).
    val handedness: List<String?> = emptyList(),
    val handednessScore: List<Float> = emptyList(),
    // Milliseconds from detectAsync() submission to this callback firing — i.e. how
    // long the MediaPipe graph itself took. Only populated when profiling; see
    // PipelineProfiler.
    val graphLatencyMs: Double = 0.0
)

/**
 * Wraps the MediaPipe hand + pose landmarkers.
 *
 * **Construct this off the main thread.** The init block below builds both
 * graphs eagerly, which parses ~14 MB of bundled assets
 * (`hand_landmarker.task` 7.8 MB + `pose_landmarker_lite.task` 5.8 MB) and
 * uploads them to the GPU delegate — and retries on CPU if the GPU delegate
 * throws. On the UI thread that is a visible freeze; MainActivity builds it on
 * Dispatchers.IO for exactly this reason.
 */
class HandLandmarkHelper(
    private val context: Context,
    // Callback invoked on the MediaPipe internal thread — caller must marshal to UI thread if needed
    private val onResult: ((LandmarkResult) -> Unit)? = null
) {
    /**
     * Where live results are actually delivered, swappable after construction.
     *
     * `onResult` has to stay a constructor parameter because its nullness picks
     * the RunningMode, and that is fixed when the native graph is built. But the
     * callback captures the Activity that installed it, so a helper kept alive
     * across screens would pin a destroyed one.
     *
     * The listener forwards through this instead, so [Cache] can hand the same
     * helper to a new Activity: the new one installs its sink, and the old one's
     * is dropped. @Volatile because MediaPipe delivers on its own thread while
     * the UI thread swaps it.
     */
    @Volatile
    var resultSink: ((LandmarkResult) -> Unit)? = onResult

    private var landmarker: HandLandmarker? = null
    private var poseLandmarker: PoseLandmarker? = null

    // nanoTime of the most recent detectAsync submission, for graph-latency
    // profiling only. Volatile: written on the camera thread, read on MediaPipe's.
    @Volatile private var lastSubmitNs = 0L
    @Volatile private var lastSourceWidth = 1
    @Volatile private var lastSourceHeight = 1

    // LIVE_STREAM mode: async, non-blocking — fastest for real-time camera feeds
    val isLiveStream: Boolean get() = onResult != null

    // ── LIVE_STREAM hand↔pose merge ───────────────────────────────────────────
    // The hand callback emits immediately, merged with the newest pose result seen
    // so far (snapshot, not same-timestamp pairing). Waiting for the same-frame
    // pose partner added the pose inference time to every emitted frame and made
    // the overlay stutter; a ≤POSE_DETECT_INTERVAL-frames-stale pose block is the
    // deliberate latency/accuracy trade instead. Zero pose (before the first pose
    // result) is the same absent-pose sentinel training data contains.
    @Volatile private var lastPoseResult: PoseLandmarkerResult? = null
    private var poseFrameCounter = 0

    private fun buildLandmarker(delegate: Delegate): HandLandmarker {
        val mode = if (onResult != null) RunningMode.LIVE_STREAM else RunningMode.IMAGE
        val builder = HandLandmarker.HandLandmarkerOptions.builder()
            .setBaseOptions(
                BaseOptions.builder()
                    .setModelAssetPath("hand_landmarker.task")
                    .setDelegate(delegate)
                    .build()
            )
            .setRunningMode(mode)
            .setNumHands(2)
            // Match the training extraction settings (sigla-ml/app/services/extract.py):
            // detection/presence/tracking all 0.5, so the phone reproduces the same
            // landmarks the model was trained on.
            .setMinHandDetectionConfidence(0.5f)
            .setMinHandPresenceConfidence(0.5f)
            .setMinTrackingConfidence(0.5f)
        if (onResult != null) {
            // Through resultSink, not onResult: the constructor's callback pins
            // the Activity that created this helper, and a cached helper outlives
            // it. A null sink means no screen is currently listening, and the
            // frame is simply dropped.
            builder.setResultListener { result, _ -> resultSink?.invoke(parseResult(result, lastPoseResult)) }
            builder.setErrorListener { e -> Log.e(TAG, "MediaPipe error: ${e.message}") }
        }
        return HandLandmarker.createFromOptions(context, builder.build())
    }

    private fun buildPoseLandmarker(delegate: Delegate): PoseLandmarker {
        val mode = if (onResult != null) RunningMode.LIVE_STREAM else RunningMode.IMAGE
        val builder = PoseLandmarker.PoseLandmarkerOptions.builder()
            .setBaseOptions(
                BaseOptions.builder()
                    .setModelAssetPath("pose_landmarker_lite.task")
                    .setDelegate(delegate)
                    .build()
            )
            .setRunningMode(mode)
            // Match extract.py _make_pose_landmarker: 1 pose, all confidences 0.5.
            .setNumPoses(1)
            .setMinPoseDetectionConfidence(0.5f)
            .setMinPosePresenceConfidence(0.5f)
            .setMinTrackingConfidence(0.5f)
        if (onResult != null) {
            builder.setResultListener { result, _ -> lastPoseResult = result }
            builder.setErrorListener { e -> Log.e(TAG, "MediaPipe pose error: ${e.message}") }
        }
        return PoseLandmarker.createFromOptions(context, builder.build())
    }

    init {
        // "[GPU]" below means the options were ACCEPTED, not that the graph is
        // actually running on the GPU. If the vendor OpenCL driver cannot be
        // dlopen'd, MediaPipe logs `Failed to load OpenCL library` at its own tflite
        // tag, then silently executes on CPU — createFromOptions still succeeds and
        // nothing here throws. That fallback cost ~109 ms/frame on a MediaTek device
        // until AndroidManifest declared <uses-native-library libOpenCL.so>.
        //
        // So: if the pipeline is slow, check logcat for that tflite line before
        // trusting this one. PipelineProfiler reports the real per-stage cost.
        landmarker = try {
            val lm = buildLandmarker(Delegate.GPU)
            Log.i(TAG, "HandLandmarker ready [GPU requested]")
            lm
        } catch (e: Throwable) {
            Log.w(TAG, "GPU delegate failed (${e.message}) — falling back to CPU")
            try {
                val lm = buildLandmarker(Delegate.CPU)
                Log.i(TAG, "HandLandmarker ready [CPU]")
                lm
            } catch (e2: Throwable) {
                Log.e(TAG, "Failed to init HandLandmarker: ${e2.message}")
                null
            }
        }
        // Pose is non-fatal: without it the pose block stays zeros (the trained-in
        // "absent pose" sentinel) and hand-only recognition keeps working.
        poseLandmarker = try {
            val pl = buildPoseLandmarker(Delegate.GPU)
            Log.i(TAG, "PoseLandmarker ready [GPU requested]")
            pl
        } catch (e: Throwable) {
            Log.w(TAG, "Pose GPU delegate failed (${e.message}) — falling back to CPU")
            try {
                val pl = buildPoseLandmarker(Delegate.CPU)
                Log.i(TAG, "PoseLandmarker ready [CPU]")
                pl
            } catch (e2: Throwable) {
                Log.e(TAG, "Failed to init PoseLandmarker (${e2.message}) — pose block will be zeros")
                null
            }
        }
    }

    // Synchronous — use only in IMAGE mode. Unlike detectAsync(), this pairs pose with
    // the SAME frame as the hands, matching sigla-ml extract.py's offline path exactly.
    //
    // NO PRODUCTION CALLER (the on-device collection screen was removed). It is kept
    // as the reference same-frame path for parity work against extract.py, which
    // means it is also unexercised code that can rot silently: nothing here fails if
    // it drifts from parseResult() or from extract.py. Two safeguards, both cheap:
    //   * it shares parseResult() with detectAsync(), so the feature layout and
    //     normalization cannot diverge without breaking the live path too;
    //   * the pose-on-hand-frames-only rule below is asserted from the Python side
    //     by tests/test_mobile_parity_flags.py, which reads THIS file.
    // If you delete this function, delete that assertion too rather than letting it
    // silently match nothing.
    fun detect(bitmap: Bitmap): LandmarkResult {
        val lmk = landmarker ?: return empty()
        return try {
            val mpImage = BitmapImageBuilder(bitmap).build()
            val result  = lmk.detect(mpImage)
            // Like extract.py: pose is only detected on frames that have hands.
            val pose = if (result.landmarks().isNotEmpty()) poseLandmarker?.detect(mpImage) else null
            parseResult(result, pose)
        } catch (e: Exception) {
            Log.e(TAG, "Detection error: ${e.message}")
            empty()
        }
    }

    // Async — use in LIVE_STREAM mode (MainActivity); result delivered via onResult callback
    fun detectAsync(bitmap: Bitmap, frameTimestampMs: Long) {
        val lmk = landmarker ?: return
        try {
            val mpImage: MPImage = BitmapImageBuilder(bitmap).build()
            // MainActivity supplies an already-upright portrait bitmap. Keeping the
            // pixels and returned coordinates in the same orientation is essential:
            // rotation metadata made inference upright but left this device's result
            // coordinates in the original sideways camera-buffer space.
            lastSourceWidth = bitmap.width
            lastSourceHeight = bitmap.height
            lastSubmitNs = System.nanoTime()
            lmk.detectAsync(mpImage, frameTimestampMs)
            // Pose only every Nth frame — hands run every frame.
            poseFrameCounter++
            if (poseFrameCounter >= POSE_DETECT_INTERVAL) {
                poseFrameCounter = 0
                poseLandmarker?.detectAsync(mpImage, frameTimestampMs)
            }
        } catch (e: Exception) {
            Log.e(TAG, "detectAsync error: ${e.message}")
        }
    }

    private fun parseResult(result: HandLandmarkerResult, pose: PoseLandmarkerResult?): LandmarkResult {
        val features = FloatArray(FEATURE_SIZE)
        if (result.landmarks().isEmpty()) return empty()

        val numHands = minOf(result.landmarks().size, 2)
        val drawData    = ArrayList<FloatArray>(numHands)
        val handLabels  = ArrayList<String?>(numHands)
        val handScores  = ArrayList<Float>(numHands)
        for (i in 0 until numHands) {
            val lms  = result.landmarks()[i]
            val base = i * 63
            val pts  = FloatArray(42)  // interleaved x,y for the overlay (raw coords)
            for (j in lms.indices) {
                val lm = lms[j]
                features[base + j * 3    ] = lm.x()
                features[base + j * 3 + 1] = lm.y()
                features[base + j * 3 + 2] = lm.z()
                pts[j * 2]     = lm.x()
                pts[j * 2 + 1] = lm.y()
            }
            drawData.add(pts)

            // Handedness for this slot ("Left"/"Right"), same index as the feature block.
            val cat = result.handednesses().getOrNull(i)?.getOrNull(0)
            handLabels.add(cat?.categoryName())
            handScores.add(cat?.score() ?: 0f)
        }

        // Pose block: raw keypoints at [126..146], then normalized as one block.
        // Absent pose (detection failed / landmarker unavailable) stays 21 zeros —
        // the same sentinel extract.py stores.
        val poseLms = pose?.landmarks()?.firstOrNull()
        if (poseLms != null) {
            for (k in POSE_KEYPOINTS.indices) {
                val kp = POSE_KEYPOINTS[k]
                if (kp < poseLms.size) {
                    val lm = poseLms[kp]
                    features[POSE_BASE + k * 3    ] = lm.x()
                    features[POSE_BASE + k * 3 + 1] = lm.y()
                    features[POSE_BASE + k * 3 + 2] = lm.z()
                }
            }
        }

        // Position/scale-invariant normalization of the WHOLE frame — every present
        // hand block plus the pose block — in one call, so the per-hand presence rule
        // has a single definition shared with FeatureParityTest. MUST match sigla-ml
        // preprocessor.normalize_frame exactly (wrist-center on landmark 0, scale by
        // 2D wrist→landmark-9 distance; pose on shoulder midpoint / shoulder width;
        // epsilon 1e-6). Only the model's `features` are normalized — drawData stays
        // in raw frame coords for drawing.
        normalizeFrame(features)
        return LandmarkResult(
            handsDetected = numHands,
            features = features,
            landmarks = drawData,
            sourceWidth = lastSourceWidth,
            sourceHeight = lastSourceHeight,
            handedness = handLabels,
            handednessScore = handScores,
            graphLatencyMs = graphLatencyMs(),
        )
    }

    private fun empty() =
        LandmarkResult(
            0, FloatArray(FEATURE_SIZE), emptyList(),
            sourceWidth = lastSourceWidth,
            sourceHeight = lastSourceHeight,
            graphLatencyMs = graphLatencyMs(),
        )

    /** Time from the last detectAsync submission to now, in ms. Profiling only. */
    private fun graphLatencyMs(): Double {
        val submitted = lastSubmitNs
        return if (submitted == 0L) 0.0 else (System.nanoTime() - submitted) / 1e6
    }

    /**
     * Releases both MediaPipe graphs. Idempotent — MainActivity closes in
     * onStop() and again defensively in onDestroy(), and double-closing a
     * MediaPipe task would otherwise crash.
     */
    fun close() {
        landmarker?.close()
        landmarker = null
        poseLandmarker?.close()
        poseLandmarker = null
        lastPoseResult = null
    }

    /**
     * Keeps one live-stream helper alive for the whole process.
     *
     * Building one parses ~14 MB of MediaPipe assets and uploads them to the GPU
     * — the "Loading hand tracking..." wait. The camera screen used to do that on
     * every entry, because it released the helper in onStop.
     *
     * Holding it until onDestroy instead is NOT the fix and was tried before:
     * Android runs onDestroy AFTER the next Activity's onCreate, so navigating
     * away left two MediaPipe GPU contexts alive at once and made switching
     * screens stall. A single process-wide instance has the opposite property —
     * there is only ever one context, no matter how the screens overlap.
     *
     * Holds applicationContext, so it cannot retain an Activity; the per-screen
     * callback goes through [resultSink] for the same reason.
     */
    object Cache {
        private var instance: HandLandmarkHelper? = null

        /**
         * The shared helper, built on first use. Must be called off the main
         * thread the first time — that call does the asset parse and GPU upload.
         */
        @Synchronized
        fun acquire(
            context: Context,
            onResult: (LandmarkResult) -> Unit,
        ): HandLandmarkHelper {
            val existing = instance
            if (existing != null) {
                existing.resultSink = onResult
                return existing
            }
            val created = HandLandmarkHelper(context.applicationContext, onResult)
            instance = created
            return created
        }

        /**
         * Stops delivering to this screen's callback, WITHOUT tearing the helper
         * down — the point of the cache.
         *
         * `sink` guards against a late release from a screen that has already
         * been replaced: if the current sink is not the one being released, a
         * newer screen owns it and must keep receiving frames.
         */
        @Synchronized
        fun release(sink: ((LandmarkResult) -> Unit)?) {
            val current = instance ?: return
            if (sink == null || current.resultSink === sink) {
                current.resultSink = null
            }
        }

        /**
         * Actually frees the native resources. Nothing calls this in normal use:
         * the helper is meant to live as long as the process, and Android
         * reclaims it when the process dies. Here for tests and for a deliberate
         * process-wide teardown if one is ever wanted.
         */
        @Synchronized
        fun destroy() {
            instance?.resultSink = null
            instance?.close()
            instance = null
        }
    }
}

/**
 * Normalize a full 147-float frame in place: every PRESENT hand block, then the
 * pose block. Absent (all-zero) blocks are left untouched as the sentinel.
 *
 * MUST match sigla-ml preprocessor.normalize_frame exactly. This is the single
 * definition of the per-hand presence rule — parseResult() and FeatureParityTest
 * both go through it, so the test exercises the real production path rather than
 * a parallel reimplementation that could drift.
 */
internal fun normalizeFrame(features: FloatArray) {
    for (hand in 0..1) {
        val base = hand * 63
        var present = false
        for (k in base until base + 63) {
            if (features[k] != 0f) { present = true; break }
        }
        if (present) normalizeHandBlock(features, base)
    }
    normalizePoseBlock(features)
}

// Largest plausible hand extent, in hand-widths, AFTER normalization.
//
// Normalization divides every landmark by the 2D wrist→MCP9 distance, so a real
// hand spans about 1-2 by construction; measured across the dataset, normal
// frames sit near 1.2. The 1e-6 clamp in normalizeHandBlock catches an exactly
// degenerate hand but not a merely small one: when MediaPipe returns a collapsed
// detection, d lands near 0.01 and the whole hand is scaled ~100x. The output is
// still perfectly normalized — wrist at the origin, |wrist→MCP9| exactly 1.000 —
// so no existing gate sees it. hasSufficientPoseCoverage and hasSufficientMotion
// both pass it straight into the LSTM.
//
// MUST equal MAX_HAND_EXTENT in sigla-ml preprocessor.py.
internal const val MAX_HAND_EXTENT = 5.0f

/**
 * True when every PRESENT hand in an already-normalized frame is a plausible size.
 *
 * Takes a normalized frame: on raw image coordinates the scale is the frame
 * rather than the hand, and the check would mean nothing.
 *
 * MUST stay identical to hand_extent_ok in sigla-ml preprocessor.py.
 */
internal fun handExtentOk(features: FloatArray): Boolean {
    for (hand in 0..1) {
        val base = hand * 63
        var present = false
        for (k in base until base + 63) {
            if (features[k] != 0f) { present = true; break }
        }
        if (!present) continue  // absent hand — nothing to judge

        var minX = Float.MAX_VALUE; var maxX = -Float.MAX_VALUE
        var minY = Float.MAX_VALUE; var maxY = -Float.MAX_VALUE
        for (j in 0..20) {
            val x = features[base + j * 3]
            val y = features[base + j * 3 + 1]
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
        if (maxX - minX > MAX_HAND_EXTENT || maxY - minY > MAX_HAND_EXTENT) return false
    }
    return true
}

// Normalize one hand's 63-float block in place: wrist-center (landmark 0) + scale
// by the 2D wrist→landmark-9 distance. Must match sigla-ml normalize_frame exactly.
// File-level (not class) so plain JUnit parity tests can call it without a Context.
internal fun normalizeHandBlock(features: FloatArray, base: Int) {
    val wx = features[base]
    val wy = features[base + 1]
    val wz = features[base + 2]
    val mx = features[base + 9 * 3]
    val my = features[base + 9 * 3 + 1]
    var d = kotlin.math.sqrt((mx - wx) * (mx - wx) + (my - wy) * (my - wy))
    if (d < 1e-6f) d = 1e-6f
    for (j in 0..20) {
        features[base + j * 3]     = (features[base + j * 3]     - wx) / d
        features[base + j * 3 + 1] = (features[base + j * 3 + 1] - wy) / d
        features[base + j * 3 + 2] = (features[base + j * 3 + 2] - wz) / d
    }
}

// Normalize the 21-float pose block in place: center on the shoulder midpoint
// (x,y,z), scale by the 2D L↔R shoulder distance, epsilon 1e-6. Must match
// sigla-ml preprocessor.normalize_frame's pose block exactly. All-zero block
// (absent pose) is left untouched as the sentinel.
internal fun normalizePoseBlock(features: FloatArray) {
    var present = false
    for (k in POSE_BASE until FEATURE_SIZE) {
        if (features[k] != 0f) { present = true; break }
    }
    if (!present) return
    val lsx = features[POSE_BASE + POSE_LSHOULDER * 3]
    val lsy = features[POSE_BASE + POSE_LSHOULDER * 3 + 1]
    val lsz = features[POSE_BASE + POSE_LSHOULDER * 3 + 2]
    val rsx = features[POSE_BASE + POSE_RSHOULDER * 3]
    val rsy = features[POSE_BASE + POSE_RSHOULDER * 3 + 1]
    val rsz = features[POSE_BASE + POSE_RSHOULDER * 3 + 2]
    val cx = (lsx + rsx) / 2f
    val cy = (lsy + rsy) / 2f
    val cz = (lsz + rsz) / 2f
    var sw = kotlin.math.sqrt((rsx - lsx) * (rsx - lsx) + (rsy - lsy) * (rsy - lsy))
    if (sw < 1e-6f) sw = 1e-6f
    for (k in 0..6) {
        features[POSE_BASE + k * 3]     = (features[POSE_BASE + k * 3]     - cx) / sw
        features[POSE_BASE + k * 3 + 1] = (features[POSE_BASE + k * 3 + 1] - cy) / sw
        features[POSE_BASE + k * 3 + 2] = (features[POSE_BASE + k * 3 + 2] - cz) / sw
    }
}
