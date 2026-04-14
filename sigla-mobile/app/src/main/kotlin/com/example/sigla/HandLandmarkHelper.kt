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
    val landmarks: List<List<Pair<Float, Float>>>
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
            .setMinHandDetectionConfidence(0.6f)
            .setMinHandPresenceConfidence(0.6f)
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
        for (i in 0 until numHands) {
            val lms  = result.landmarks()[i]
            val base = i * 63
            val pts  = mutableListOf<Pair<Float, Float>>()
            for (j in lms.indices) {
                val lm = lms[j]
                features[base + j * 3    ] = lm.x()
                features[base + j * 3 + 1] = lm.y()
                features[base + j * 3 + 2] = lm.z()
                pts.add(Pair(lm.x(), lm.y()))
            }
            drawData.add(pts)
        }
        return LandmarkResult(numHands, features, drawData)
    }

    private fun empty() = LandmarkResult(0, FloatArray(126), emptyList())

    fun close() { landmarker?.close() }
}
