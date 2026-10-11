package com.example.sigla

import android.content.Context
import android.graphics.Bitmap
import android.os.Process
import android.os.SystemClock
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
import java.io.File

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

// Under context.cacheDir. See HandLandmarkHelper.baseOptions.
private const val GPU_CACHE_ROOT = "mediapipe_gpu"

data class LandmarkResult(
    val handsDetected: Int,
    val features: FloatArray,
    // Per hand: a flat FloatArray of interleaved x,y (21 landmarks → 42 floats) in raw
    // frame coords, for the on-screen overlay. Flat arrays avoid the ~42 boxed Pair
    // allocations per frame that were feeding the GC. Empty list = no hands.
    val landmarks: List<FloatArray>,
    // Per detected hand: 63 raw floats (x, y, z per landmark, MediaPipe image
    // coordinates, detection order). Input to LetterHand.select for letters mode;
    // the normalised `features` stay the words model's input.
    val rawHands: List<FloatArray> = emptyList(),
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
 * **Construct this off the main thread.** The init block below builds the
 * hand graph eagerly, which parses the 7.8 MB `hand_landmarker.task` asset and
 * uploads it to the GPU delegate — and retries on CPU if the GPU delegate
 * throws. On the UI thread that is a visible freeze; MainActivity builds it on
 * Dispatchers.IO for exactly this reason. In live mode the 5.8 MB
 * `pose_landmarker_lite.task` graph is then built on its own thread, so the
 * constructor does not wait for it.
 *
 * Live screens get it through [Cache], which HomeActivity pre-warms at launch.
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

    // In LIVE_STREAM mode this is built on a background thread AFTER the hand
    // graph (see init), so it is null for the first moments of tracking — the
    // same zero-pose sentinel as a failed pose build. Volatile: published by the
    // init thread, read by the camera thread.
    @Volatile private var poseLandmarker: PoseLandmarker? = null

    // Guards publishing the background-built pose graph against close(): a pose
    // build that finishes after close() must close itself instead of leaking.
    private val poseLock = Any()
    private var closed = false

    // nanoTime of the most recent detectAsync submission, for graph-latency
    // profiling only. Volatile: written on the camera thread, read on MediaPipe's.
    @Volatile private var lastSubmitNs = 0L
    @Volatile private var lastSourceWidth = 1
    @Volatile private var lastSourceHeight = 1

    // ── LIVE_STREAM hand↔pose merge ───────────────────────────────────────────
    // The hand callback emits immediately, merged with the newest pose result seen
    // so far (snapshot, not same-timestamp pairing). Waiting for the same-frame
    // pose partner added the pose inference time to every emitted frame and made
    // the overlay stutter; a ≤POSE_DETECT_INTERVAL-frames-stale pose block is the
    // deliberate latency/accuracy trade instead. Zero pose (before the first pose
    // result) is the same absent-pose sentinel training data contains.
    @Volatile private var lastPoseResult: PoseLandmarkerResult? = null

    /**
     * Off in letters mode: the letter models read one hand only, so pose
     * detection is pure cost there. Turning it off drops the last pose so a
     * later switch back to words starts from the absent-pose sentinel.
     */
    @Volatile var poseEnabled: Boolean = true
        set(value) {
            field = value
            if (!value) lastPoseResult = null
        }
    private var poseFrameCounter = 0

    /**
     * BaseOptions for one bundled .task asset. On GPU it also points MediaPipe
     * at an on-disk cache so launches after the first skip part of the GPU setup.
     *
     * Building a GPU graph compiles its OpenCL kernels from scratch, and nothing
     * is kept between launches by default. Measured on a Xiaomi (MediaTek/Mali,
     * Android 15), cold launches 2026-10-05:
     *
     *                 no cache   kernels only   kernels + serialized model
     *   hand          6.4-7.5 s  5.0 s          9.7 s (worse)
     *   pose          7.8-8.3 s  6.8 s          4.9 s
     *
     * Why hand and pose differ: each .task bundles TWO models (detector +
     * landmarker), but MediaPipe names the cache files after the model token
     * alone (inference_on_disk_cache_helper.cc), so both sub-models share one
     * file and each overwrites the other's. For hand that means a mismatched
     * serialized model is loaded and thrown away on every launch, which costs
     * more than it saves, so hand caches kernels only. For pose the second
     * sub-model's serialized model does stick and loads in ~60 ms, a net win.
     * Re-measure both (logcat "ready ... in N ms") before changing this or
     * upgrading MediaPipe.
     *
     * Each task gets its own directory for the same naming reason. The directory
     * name carries the versionCode so an app update, which may ship new .task
     * assets, never reads a cache built for the old ones. A missing, stale or
     * corrupt cache is not an error: MediaPipe compiles from scratch. It lives in
     * cacheDir, so the OS may clear it under storage pressure, costing one slow
     * launch.
     */
    private fun baseOptions(
        asset: String,
        cacheName: String,
        delegate: Delegate,
        serializeModel: Boolean,
    ): BaseOptions {
        val builder = BaseOptions.builder()
            .setModelAssetPath(asset)
            .setDelegate(delegate)
        if (delegate == Delegate.GPU) {
            val dir = File(context.cacheDir, "$GPU_CACHE_ROOT/$cacheName-v${BuildConfig.VERSION_CODE}")
            if (dir.isDirectory || dir.mkdirs()) {
                val gpu = BaseOptions.DelegateOptions.GpuOptions.builder()
                    // A directory PREFIX: MediaPipe writes "<token>.ker" under it.
                    .setCachedKernelPath(dir.absolutePath + File.separator)
                    .setModelToken(cacheName)
                if (serializeModel) gpu.setSerializedModelDir(dir.absolutePath)
                builder.setDelegateOptions(gpu.build())
            }
        }
        return builder.build()
    }

    private fun buildLandmarker(delegate: Delegate): HandLandmarker {
        val mode = if (onResult != null) RunningMode.LIVE_STREAM else RunningMode.IMAGE
        val builder = HandLandmarker.HandLandmarkerOptions.builder()
            .setBaseOptions(baseOptions("hand_landmarker.task", "hand", delegate, serializeModel = false))
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
            .setBaseOptions(baseOptions("pose_landmarker_lite.task", "pose", delegate, serializeModel = true))
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
        val handStart = SystemClock.elapsedRealtime()
        landmarker = try {
            val lm = buildLandmarker(Delegate.GPU)
            Log.i(TAG, "HandLandmarker ready [GPU requested] in ${SystemClock.elapsedRealtime() - handStart} ms")
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
        // "absent pose" sentinel) and hand-only recognition keeps working. That is
        // what lets live mode return as soon as the HAND graph is up and build pose
        // behind it — pose was ~40% of the "Loading hand tracking…" wait, and the
        // frames before it lands carry the same zero block a failed build would.
        //
        // IMAGE mode (the detect() parity path) stays synchronous so its first
        // call pairs pose with the same frame, exactly like extract.py.
        if (onResult != null) {
            Thread({
                // Pose is never on the critical path (tracking starts without
                // it), so it yields the CPU to the UI and the camera pipeline.
                Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
                val pl = buildPoseWithFallback()
                synchronized(poseLock) {
                    if (closed) pl?.close() else poseLandmarker = pl
                }
            }, "pose-landmarker-init").start()
        } else {
            poseLandmarker = buildPoseWithFallback()
        }
    }

    private fun buildPoseWithFallback(): PoseLandmarker? {
        val poseStart = SystemClock.elapsedRealtime()
        return try {
            val pl = buildPoseLandmarker(Delegate.GPU)
            Log.i(TAG, "PoseLandmarker ready [GPU requested] in ${SystemClock.elapsedRealtime() - poseStart} ms")
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
            if (poseFrameCounter >= POSE_DETECT_INTERVAL && poseEnabled) {
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
        val rawHands    = ArrayList<FloatArray>(numHands)
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
            val raw = FloatArray(63)
            for (j in lms.indices) {
                raw[j * 3] = lms[j].x(); raw[j * 3 + 1] = lms[j].y(); raw[j * 3 + 2] = lms[j].z()
            }
            rawHands.add(raw)
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
            rawHands = rawHands,
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
        synchronized(poseLock) {
            closed = true
            poseLandmarker?.close()
            poseLandmarker = null
        }
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
        // Written only under buildLock; read without it by release().
        @Volatile
        private var instance: HandLandmarkHelper? = null

        // Serializes the slow first build ONLY. It must not be the Cache monitor:
        // release() takes that monitor from onStop() on the main thread, and when
        // the build held it, leaving the screen during "Loading hand tracking…"
        // blocked the UI thread for the whole asset parse + GPU upload — an ANR.
        private val buildLock = Any()

        private val prewarmStarted = java.util.concurrent.atomic.AtomicBoolean(false)

        /**
         * Starts building the shared helper in the background, so the translator
         * screen finds it ready instead of showing "Loading hand tracking…".
         * Called from HomeActivity; safe to call from the main thread and more
         * than once.
         *
         * A screen that acquires while this is still building simply waits on
         * buildLock for the rest of it, which is never longer than building
         * from scratch. The helper is built in live mode with no sink installed,
         * so frames are dropped until a screen installs one through acquire().
         */
        fun prewarm(context: Context) {
            if (instance != null || !prewarmStarted.compareAndSet(false, true)) return
            val app = context.applicationContext
            Thread({
                // Background priority: the GPU build is mostly CPU work inside the
                // graphics driver (kernel compilation), and at normal priority it
                // stretched the app's launch stutters by ~150-200 ms each. Lowered
                // BEFORE publishing the tid and re-checked AFTER, so a boost from
                // acquire() can never be overwritten whichever runs first.
                Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
                prewarmTid = Process.myTid()
                if (boostRequested) boost(prewarmTid)
                try {
                    synchronized(buildLock) {
                        if (instance == null) {
                            // A non-null onResult is what selects LIVE_STREAM mode;
                            // the sink is cleared BEFORE publishing so a screen that
                            // acquires afterwards always owns it.
                            val created = HandLandmarkHelper(app) {}
                            created.resultSink = null
                            instance = created
                        }
                    }
                } finally {
                    prewarmTid = 0
                }
            }, "hand-landmarker-prewarm").start()
        }

        // Thread id of a prewarm build still running, or 0.
        @Volatile private var prewarmTid = 0
        // Set once a screen is waiting for the helper; see prewarm().
        @Volatile private var boostRequested = false

        /**
         * A screen now needs the helper, so a background-priority prewarm must
         * stop yielding: without this, opening the translator mid-prewarm would
         * wait LONGER than building from scratch.
         */
        private fun boostPrewarm() {
            boostRequested = true
            val tid = prewarmTid
            if (tid != 0) boost(tid)
        }

        private fun boost(tid: Int) {
            try {
                Process.setThreadPriority(tid, Process.THREAD_PRIORITY_DEFAULT)
            } catch (e: Exception) {
                // The thread finished between the read and this call — nothing to boost.
            }
        }

        /**
         * The shared helper, built on first use. Must be called off the main
         * thread the first time — that call does the asset parse and GPU upload.
         */
        fun acquire(
            context: Context,
            onResult: (LandmarkResult) -> Unit,
        ): HandLandmarkHelper {
            instance?.let { return install(it, onResult) }
            boostPrewarm()
            synchronized(buildLock) {
                instance?.let { return install(it, onResult) }
                // The constructor installs onResult as the sink BEFORE the helper
                // is published, so a screen that acquires after us (waiting on
                // buildLock) always overwrites it rather than being overwritten.
                val created = HandLandmarkHelper(context.applicationContext, onResult)
                instance = created
                return created
            }
        }

        @Synchronized
        private fun install(
            helper: HandLandmarkHelper,
            onResult: (LandmarkResult) -> Unit,
        ): HandLandmarkHelper {
            helper.resultSink = onResult
            return helper
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
