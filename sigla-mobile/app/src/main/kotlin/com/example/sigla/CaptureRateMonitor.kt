package com.example.sigla

import android.os.SystemClock
import android.util.Log

private const val TAG = "CaptureRateMonitor"

/**
 * Watches the rate at which camera frames actually reach the analyzer.
 *
 * WHY THIS IS NOT PipelineProfiler
 *
 * PipelineProfiler measures where per-frame time goes, is debug-only, and is
 * meant to be deleted once a bottleneck is found. This is a permanent health
 * check on one number that changes what the model sees, and it has to run in
 * release builds because that is where it matters.
 *
 * WHY THE RATE MATTERS
 *
 * There is no frame skip: capture rate IS the rate at which landmarks enter the
 * buffer, so it sets the real duration of the stored 30-frame window. Training
 * samples every clip at TARGET_SAMPLE_FPS (24) precisely so one frame covers the
 * same wall-clock span offline as it does live. At 12 fps a window spans 2.5 s
 * instead of 1.25 s, and every gesture reaches the model at half the speed the
 * signer made — a distortion no offline metric can see, because the stored data
 * is all correctly sampled.
 *
 * bindCamera pins the auto-exposure floor to MIN_ACCEPTABLE_FPS, but that is a
 * request: a device with no AE range meeting the floor logs a warning and runs
 * at whatever the HAL defaults to (measured as low as ~5 fps on MediaTek in dim
 * light). Nothing downstream noticed. This turns that silence into a log line
 * and a one-shot callback the UI can surface.
 */
object CaptureRateMonitor {

    /**
     * Frames averaged before judging the rate.
     *
     * Long enough that a few slow frames — an autofocus hunt, a GC pause — do
     * not trip it, short enough to react within a couple of seconds at the
     * rates worth reporting.
     */
    private const val WINDOW_FRAMES = 48

    /**
     * Fraction of MIN_ACCEPTABLE_FPS below which the rate is reported.
     *
     * Not the floor itself. A device sitting at 23.4 fps is fine and would
     * otherwise warn constantly; one at 18 is genuinely feeding the model
     * stretched gestures. 0.75 of 24 is 18.
     */
    private const val WARN_RATIO = 0.75

    private val lock = Any()
    private var lastFrameNs = 0L
    private var frames = 0
    private var gapSumNs = 0L

    /** Set once per session so a struggling device reports, and then stays quiet. */
    private var reported = false

    /**
     * Invoked once per session when the sustained rate is below the threshold,
     * with the measured fps. Assigned by the screen that wants to surface it;
     * cleared when that screen goes away.
     */
    @Volatile
    var onLowCaptureRate: ((Double) -> Unit)? = null

    /**
     * Call once per frame delivered to the analyzer, before any work.
     *
     * Deliberately cheap: one nanoTime, an add, and a comparison. It runs on the
     * camera thread for every frame in a release build, so it must not allocate.
     */
    fun onFrame() {
        var lowFps = -1.0
        synchronized(lock) {
            val now = System.nanoTime()
            if (lastFrameNs != 0L) {
                gapSumNs += now - lastFrameNs
                frames++
            }
            lastFrameNs = now

            if (frames >= WINDOW_FRAMES) {
                val avgGapMs = gapSumNs / frames / 1e6
                val fps = if (avgGapMs > 0) 1000.0 / avgGapMs else 0.0
                frames = 0
                gapSumNs = 0L

                if (fps < MIN_ACCEPTABLE_FPS * WARN_RATIO) {
                    // Logged on EVERY window, because a rate that stays low is
                    // worth seeing in a bug report more than once — but the
                    // callback fires only the first time, since a toast per
                    // second would be its own problem.
                    Log.w(TAG, "Camera is delivering %.1f fps; the model expects $MIN_ACCEPTABLE_FPS. "
                        .format(fps) +
                        "Gestures reach it stretched, which degrades recognition. " +
                        "Usually low light forcing a longer exposure.")
                    if (!reported) {
                        reported = true
                        lowFps = fps
                    }
                } else {
                    Log.d(TAG, "Capture rate %.1f fps".format(fps))
                }
            }
        }
        // Outside the lock: the callback hops to the UI thread, and the camera
        // thread must not be held while it does.
        if (lowFps > 0) onLowCaptureRate?.invoke(lowFps)
    }

    /**
     * Forgets the current window and re-arms the one-shot report.
     *
     * Called when the camera is rebound — a lens flip, or returning to the
     * screen — since the gap across that pause is not a real inter-frame time
     * and conditions may have changed.
     */
    fun reset() = synchronized(lock) {
        lastFrameNs = 0L
        frames = 0
        gapSumNs = 0L
        reported = false
    }
}
