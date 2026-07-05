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
import java.util.TreeMap

private const val TAG = "HandLandmarkHelper"

// Feature layout — MUST match sigla-ml (preprocessor.py / extract.py):
// [0..125]   2 hands × 21 landmarks × (x,y,z), normalized per hand block.
// [126..146] 7 upper-body pose keypoints × (x,y,z), normalized as one block.
private const val FEATURE_SIZE = 147
private const val POSE_BASE    = 126
// MediaPipe Pose indices kept, in order: nose, Lshoulder, Rshoulder, Lelbow,
// Relbow, Lwrist, Rwrist. MUST equal extract.py _POSE_KEYPOINTS.
private val POSE_KEYPOINTS = intArrayOf(0, 11, 12, 13, 14, 15, 16)
// Local pose-block indices of the shoulders (for normalization) — match preprocessor.py.
private const val POSE_LSHOULDER = 1
private const val POSE_RSHOULDER = 2

// A hand result whose pose partner never arrives (MediaPipe dropped the pose frame
// under load) is emitted with a zero pose block after this long. Zero pose is a
// legitimate training-time state too (extract.py stores zeros when pose detection
// fails), so this degrades gracefully instead of starving the frame buffer.
private const val PAIR_STALE_MS = 300L

data class LandmarkResult(
    val handsDetected: Int,
    val features: FloatArray,
    // Per hand: a flat FloatArray of interleaved x,y (21 landmarks → 42 floats) in raw
    // frame coords, for the on-screen overlay. Flat arrays avoid the ~42 boxed Pair
    // allocations per frame that were feeding the GC. Empty list = no hands.
    val landmarks: List<FloatArray>,
    // Per hand-slot MediaPipe handedness ("Left"/"Right"/null) and its score,
    // aligned to the same slot index as `features` (slot 0 = features[0..62]).
    val handedness: List<String?> = emptyList(),
    val handednessScore: List<Float> = emptyList()
)

class HandLandmarkHelper(
    private val context: Context,
    // Callback invoked on the MediaPipe internal thread — caller must marshal to UI thread if needed
    private val onResult: ((LandmarkResult) -> Unit)? = null
) {
    private var landmarker: HandLandmarker? = null
    private var poseLandmarker: PoseLandmarker? = null

    // LIVE_STREAM mode: async, non-blocking — fastest for real-time camera feeds
    val isLiveStream: Boolean get() = onResult != null

    // ── LIVE_STREAM hand↔pose pairing ─────────────────────────────────────────
    // Hand and pose landmarkers each run async on the same frame/timestamp; their
    // callbacks land on MediaPipe internal threads in either order (and either one
    // may drop a frame under load). Results are paired by timestamp here so one
    // merged 147-float vector per frame reaches onResult — same-frame pairing,
    // matching extract.py, which detects pose on the exact frame the hands came from.
    private class Pending {
        var hand: HandLandmarkerResult? = null
        var pose: PoseLandmarkerResult? = null
    }
    private val pendingLock = Any()
    private val pending = TreeMap<Long, Pending>()
    private var lastEmittedTs = -1L

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
            builder.setResultListener { result, _ -> submitHand(result.timestampMs(), result) }
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
            builder.setResultListener { result, _ -> submitPose(result.timestampMs(), result) }
            builder.setErrorListener { e -> Log.e(TAG, "MediaPipe pose error: ${e.message}") }
        }
        return PoseLandmarker.createFromOptions(context, builder.build())
    }

    init {
        landmarker = try {
            val lm = buildLandmarker(Delegate.GPU)
            Log.i(TAG, "HandLandmarker ready [GPU]")
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
            Log.i(TAG, "PoseLandmarker ready [GPU]")
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

    // Synchronous — use only in IMAGE mode (CollectionActivity)
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
            lmk.detectAsync(mpImage, frameTimestampMs)
            poseLandmarker?.detectAsync(mpImage, frameTimestampMs)
        } catch (e: Exception) {
            Log.e(TAG, "detectAsync error: ${e.message}")
        }
    }

    // ── Pairing (LIVE_STREAM only) ────────────────────────────────────────────

    private fun submitHand(ts: Long, result: HandLandmarkerResult) {
        val toEmit = ArrayList<LandmarkResult>(2)
        synchronized(pendingLock) {
            if (ts <= lastEmittedTs) return
            val p = pending.getOrPut(ts) { Pending() }
            p.hand = result
            collectReady(ts, toEmit)
        }
        toEmit.forEach { onResult?.invoke(it) }
    }

    private fun submitPose(ts: Long, result: PoseLandmarkerResult) {
        val toEmit = ArrayList<LandmarkResult>(2)
        synchronized(pendingLock) {
            if (ts <= lastEmittedTs) return
            val p = pending.getOrPut(ts) { Pending() }
            p.pose = result
            collectReady(ts, toEmit)
        }
        toEmit.forEach { onResult?.invoke(it) }
    }

    // Must be called with pendingLock held. Flushes, in timestamp order:
    //  - every entry up to a completed (hand+pose) pair, emitting hand-only
    //    entries with a zero pose block (their pose frame was dropped);
    //  - entries older than PAIR_STALE_MS whose partner never arrived.
    // Pose-only entries (hand frame dropped) are discarded silently.
    private fun collectReady(ts: Long, toEmit: MutableList<LandmarkResult>) {
        val current = pending[ts]
        val complete = current != null && current.hand != null &&
            (current.pose != null || poseLandmarker == null)
        val flushUpTo = if (complete) ts else ts - PAIR_STALE_MS
        val it = pending.headMap(flushUpTo, complete).entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            val h = e.value.hand
            if (h != null) {
                toEmit.add(parseResult(h, e.value.pose))
                lastEmittedTs = e.key
            }
            it.remove()
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
            // Position/scale-invariant normalization of this hand's block — MUST match
            // sigla-ml preprocessor.normalize_frame exactly (wrist-center on landmark 0,
            // scale by 2D wrist→landmark-9 distance, epsilon 1e-6). Only the model's
            // `features` are normalized; drawData stays in raw frame coords for drawing.
            normalizeHandBlock(features, base)
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
            normalizePoseBlock(features)
        }
        return LandmarkResult(numHands, features, drawData, handLabels, handScores)
    }

    private fun empty() = LandmarkResult(0, FloatArray(FEATURE_SIZE), emptyList())

    fun close() {
        landmarker?.close()
        poseLandmarker?.close()
        synchronized(pendingLock) { pending.clear() }
    }
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
