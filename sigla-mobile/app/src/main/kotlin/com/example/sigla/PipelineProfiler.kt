package com.example.sigla

import android.util.Log

/**
 * Temporary stage-level timing for the camera → MediaPipe → LSTM pipeline.
 *
 * PredictionService already reports LSTM latency, but that only covers
 * `interp.run()`. When the preview feels laggy the cost is just as often in the
 * stages around it — the two per-frame bitmap allocations, the MediaPipe graph
 * itself, or the feature canonicalization on the callback thread — and none of
 * those were measured. Guessing between them is what this exists to avoid.
 *
 * Debug-only (see [PIPELINE_PROFILING]); every call site is behind that flag so
 * release builds do not even evaluate the timestamps.
 *
 * Remove once the bottleneck is identified and fixed.
 */
object PipelineProfiler {

    private const val TAG = "PipelineProfiler"
    private const val REPORT_EVERY = 60

    private val lock = Any()

    // Camera-thread stages
    private var frames = 0
    private var toBitmapSum = 0.0
    private var prepareSum  = 0.0
    private var submitSum   = 0.0

    // MediaPipe callback-thread stages
    private var callbacks = 0
    private var parseToCallbackSum = 0.0
    private var canonicalizeSum    = 0.0
    private var processFrameSum    = 0.0

    // Wall-clock gap between consecutive frames arriving at the analyzer, which is
    // what actually determines the perceived frame rate.
    private var lastFrameNs = 0L
    private var interFrameSum = 0.0
    private var interFrameMax = 0.0

    fun recordCamera(toBitmapMs: Double, prepareMs: Double, submitMs: Double) {
        synchronized(lock) {
            val now = System.nanoTime()
            if (lastFrameNs != 0L) {
                val gap = (now - lastFrameNs) / 1e6
                interFrameSum += gap
                if (gap > interFrameMax) interFrameMax = gap
            }
            lastFrameNs = now

            frames++
            toBitmapSum += toBitmapMs
            prepareSum  += prepareMs
            submitSum   += submitMs

            if (frames >= REPORT_EVERY) {
                val n = frames.toDouble()
                Log.d(TAG, "camera thread over $frames frames: " +
                    "toBitmap=%.2fms prepare=%.2fms submit=%.2fms | interFrame avg=%.1fms max=%.1fms (%.1f fps)"
                        .format(
                            toBitmapSum / n, prepareSum / n, submitSum / n,
                            interFrameSum / n, interFrameMax,
                            if (interFrameSum > 0) 1000.0 / (interFrameSum / n) else 0.0
                        ))
                frames = 0
                toBitmapSum = 0.0; prepareSum = 0.0; submitSum = 0.0
                interFrameSum = 0.0; interFrameMax = 0.0
            }
        }
    }

    fun recordCallback(canonicalizeMs: Double, processFrameMs: Double, sinceSubmitMs: Double) {
        synchronized(lock) {
            callbacks++
            canonicalizeSum    += canonicalizeMs
            processFrameSum    += processFrameMs
            parseToCallbackSum += sinceSubmitMs

            if (callbacks >= REPORT_EVERY) {
                val n = callbacks.toDouble()
                Log.d(TAG, "callback thread over $callbacks results: " +
                    "mediapipe=%.1fms canonicalize=%.2fms processFrame=%.2fms"
                        .format(parseToCallbackSum / n, canonicalizeSum / n, processFrameSum / n))
                callbacks = 0
                canonicalizeSum = 0.0; processFrameSum = 0.0; parseToCallbackSum = 0.0
            }
        }
    }
}
