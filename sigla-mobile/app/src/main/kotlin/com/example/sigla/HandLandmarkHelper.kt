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
import kotlin.math.sqrt

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

// Pose is detected only every Nth camera frame (hands run on every frame) and the
// most recent pose result is merged into each hand frame.
private const val POSE_DETECT_INTERVAL = 3

data class LandmarkResult(
    val handsDetected: Int,
    val features: FloatArray,
    val landmarks: List<FloatArray>,
    val handedness: List<String?> = emptyList(),
    val handednessScore: List<Float> = emptyList()
)

class HandLandmarkHelper(
    private val context: Context,
    var onResult: ((LandmarkResult) -> Unit)? = null
) {
    private var landmarker: HandLandmarker? = null
    private var poseLandmarker: PoseLandmarker? = null

    val isLiveStream: Boolean get() = onResult != null

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
            .setMinHandDetectionConfidence(0.5f)
            .setMinHandPresenceConfidence(0.5f)
            .setMinTrackingConfidence(0.5f)
        if (onResult != null) {
            builder.setResultListener { result, _ -> onResult?.invoke(parseResult(result, lastPoseResult)) }
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

    fun detectAsync(bitmap: Bitmap, frameTimestampMs: Long) {
        val lmk = landmarker ?: return
        try {
            val mpImage = BitmapImageBuilder(bitmap).build()
            lmk.detectAsync(mpImage, frameTimestampMs)
            poseFrameCounter++
            if (poseFrameCounter >= POSE_DETECT_INTERVAL) {
                poseFrameCounter = 0
                poseLandmarker?.detectAsync(mpImage, frameTimestampMs)
            }
        } catch (e: Exception) {
            Log.e(TAG, "detectAsync error: ${e.message}")
        }
    }

    fun detect(bitmap: Bitmap): LandmarkResult {
        val lmk = landmarker ?: return empty()
        return try {
            val mpImage = BitmapImageBuilder(bitmap).build()
            val result = lmk.detect(mpImage)
            val pose = if (result.landmarks().isNotEmpty()) poseLandmarker?.detect(mpImage) else null
            parseResult(result, pose)
        } catch (e: Exception) {
            Log.e(TAG, "Detection error: ${e.message}")
            empty()
        }
    }

    private fun parseResult(result: HandLandmarkerResult, pose: PoseLandmarkerResult?): LandmarkResult {
        val features = FloatArray(FEATURE_SIZE)
        if (result.landmarks().isEmpty()) return empty()

        val numHands = minOf(result.landmarks().size, 2)
        val drawData = ArrayList<FloatArray>(numHands)
        val handLabels = ArrayList<String?>(numHands)
        val handScores = ArrayList<Float>(numHands)
        for (i in 0 until numHands) {
            val lms = result.landmarks()[i]
            val base = i * 63
            val pts = FloatArray(42)
            for (j in lms.indices) {
                val lm = lms[j]
                features[base + j * 3] = lm.x()
                features[base + j * 3 + 1] = lm.y()
                features[base + j * 3 + 2] = lm.z()
                pts[j * 2] = lm.x()
                pts[j * 2 + 1] = lm.y()
            }
            normalizeHandBlock(features, base)
            drawData.add(pts)

            val cat = result.handednesses().getOrNull(i)?.getOrNull(0)
            handLabels.add(cat?.categoryName())
            handScores.add(cat?.score() ?: 0f)
        }

        val poseLms = pose?.landmarks()?.firstOrNull()
        if (poseLms != null) {
            for (k in POSE_KEYPOINTS.indices) {
                val kp = POSE_KEYPOINTS[k]
                if (kp < poseLms.size) {
                    val lm = poseLms[kp]
                    features[POSE_BASE + k * 3] = lm.x()
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
        lastPoseResult = null
    }
}

// ─── Normalization functions (top-level) ───
internal fun normalizeHandBlock(features: FloatArray, base: Int) {
    val wx = features[base]
    val wy = features[base + 1]
    val wz = features[base + 2]
    val mx = features[base + 9 * 3]
    val my = features[base + 9 * 3 + 1]
    var d = sqrt((mx - wx) * (mx - wx) + (my - wy) * (my - wy))
    if (d < 1e-6f) d = 1e-6f
    for (j in 0..20) {
        features[base + j * 3] = (features[base + j * 3] - wx) / d
        features[base + j * 3 + 1] = (features[base + j * 3 + 1] - wy) / d
        features[base + j * 3 + 2] = (features[base + j * 3 + 2] - wz) / d
    }
}

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
    var sw = sqrt((rsx - lsx) * (rsx - lsx) + (rsy - lsy) * (rsy - lsy))
    if (sw < 1e-6f) sw = 1e-6f
    for (k in 0..6) {
        features[POSE_BASE + k * 3] = (features[POSE_BASE + k * 3] - cx) / sw
        features[POSE_BASE + k * 3 + 1] = (features[POSE_BASE + k * 3 + 1] - cy) / sw
        features[POSE_BASE + k * 3 + 2] = (features[POSE_BASE + k * 3 + 2] - cz) / sw
    }
}