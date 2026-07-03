package com.example.sigla

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult

private const val TAG = "HandLandmarkHelper"

data class LandmarkResult(
    val handsDetected: Int,
    val features: FloatArray,
    val landmarks: List<List<Pair<Float, Float>>>,
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

    // LIVE_STREAM mode: async, non-blocking — fastest for real-time camera feeds
    val isLiveStream: Boolean get() = onResult != null

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
            builder.setResultListener { result, _ -> onResult.invoke(parseResult(result)) }
            builder.setErrorListener { e -> Log.e(TAG, "MediaPipe error: ${e.message}") }
        }
        return HandLandmarker.createFromOptions(context, builder.build())
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
    }

    // Synchronous — use only in IMAGE mode (CollectionActivity)
    fun detect(bitmap: Bitmap): LandmarkResult {
        val lmk = landmarker ?: return empty()
        return try {
            val mpImage = BitmapImageBuilder(bitmap).build()
            val result  = lmk.detect(mpImage)
            parseResult(result)
        } catch (e: Exception) {
            Log.e(TAG, "Detection error: ${e.message}")
            empty()
        }
    }

    // Async — use in LIVE_STREAM mode (MainActivity); result delivered via onResult callback
    fun detectAsync(bitmap: Bitmap, frameTimestampMs: Long) {
        val lmk = landmarker ?: return
        try {
            val mpImage = BitmapImageBuilder(bitmap).build()
            lmk.detectAsync(mpImage, frameTimestampMs)
        } catch (e: Exception) {
            Log.e(TAG, "detectAsync error: ${e.message}")
        }
    }

    private fun parseResult(result: HandLandmarkerResult): LandmarkResult {
        val features = FloatArray(126)
        val drawData = mutableListOf<List<Pair<Float, Float>>>()
        if (result.landmarks().isEmpty()) return empty()

        val numHands = minOf(result.landmarks().size, 2)
        val handLabels  = mutableListOf<String?>()
        val handScores  = mutableListOf<Float>()
        for (i in 0 until numHands) {
            val lms  = result.landmarks()[i]
            val base = i * 63
            val pts  = mutableListOf<Pair<Float, Float>>()
            for (j in lms.indices) {
                val lm = lms[j]
                features[base + j * 3    ] = lm.x()
                features[base + j * 3 + 1] = lm.y()
                features[base + j * 3 + 2] = lm.z()
                pts.add(Pair(lm.x(), lm.y()))  // raw coords for the on-screen overlay
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
        return LandmarkResult(numHands, features, drawData, handLabels, handScores)
    }

    // Normalize one hand's 63-float block in place: wrist-center (landmark 0) + scale
    // by the 2D wrist→landmark-9 distance. Must match sigla-ml normalize_frame exactly.
    private fun normalizeHandBlock(features: FloatArray, base: Int) {
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

    private fun empty() = LandmarkResult(0, FloatArray(126), emptyList())

    fun close() { landmarker?.close() }
}
