package com.example.sigla

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Bundle
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.util.Range
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.GravityCompat
import androidx.lifecycle.lifecycleScope
import com.example.sigla.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import java.util.concurrent.Executors
import kotlinx.coroutines.delay

private const val TAG               = "MainActivity"
private const val CAMERA_PERMISSION = 100

// Steady-state text for the gesture indicator. CollectingState.isMotion was always
// true, so the "○ static" branch it used to select between was unreachable.
private const val MOTION_INDICATOR_TEXT = "● MOTION"

// Minimum gap between onResume-triggered word-bank refreshes.
private const val WORD_BANK_REFRESH_INTERVAL_MS = 5 * 60 * 1000L

// Temporary stage-level pipeline timing — see PipelineProfiler. Debug-only.
private val PIPELINE_PROFILING = BuildConfig.DEBUG

// Lowest sustained capture rate the recognition pipeline is willing to run at.
// The frame skip halves this again before MediaPipe sees it, so 24 fps yields
// ~12 Hz of inference — close to what the firing constants were tuned against.
private const val MIN_ACCEPTABLE_FPS = 24

/**
 * Runs the blocking close() calls in stopVision() off the main thread.
 *
 * Process-scoped on purpose. The per-Activity camera executor is shut down at the
 * top of onDestroy(), before stopVision() runs, so a teardown handed to it there
 * would be silently discarded and the interpreter and GPU context would leak.
 * Single-threaded, so a predictor and landmarker released together are closed in
 * order, and a later screen's teardown cannot overlap an earlier one.
 */
private val teardownExecutor = Executors.newSingleThreadExecutor { r ->
    Thread(r, "sigla-teardown").apply { isDaemon = true }
}

// ── Left-handed support (inference-time handedness canonicalization) ──────────
// When enabled, a hand MediaPipe reports as "Left" is mirrored (x → -x on the
// normalized, wrist-relative coords) so the model always sees a right-handed sign.
// The rule is camera-independent (the front-camera bitmap flip is already encoded
// in the reported label). When disabled, behavior is byte-identical to before.
private const val LEFT_HANDED_SUPPORT_ENABLED = true
// On-device calibration (HANDEDNESS_TEST log, both cameras, both hands, 0.95-0.97
// confidence, 2026-07-13) confirmed MediaPipe's Left/Right label matches the true
// anatomical hand identically on front AND back camera — no inversion. If a future
// MediaPipe/device combo inverts it, re-run the same calibration log and flip this.
private const val MEDIAPIPE_LABELS_INVERTED   = false
// Ignore low-confidence handedness (treat as no-decision → don't mirror).
private const val HANDEDNESS_MIN_SCORE        = 0.8f
// Frames with no hands before a gesture is considered ended (resets the latch).
private const val LATCH_NO_HAND_RESET         = 6

// ── Canonical hand-slot ordering (fixes two-handed sign accuracy) ─────────────
// Two-handed signs are packed by MediaPipe in arbitrary slot order; we reorder so
// the RIGHT hand is always slot 0 and LEFT slot 1, using a pure-geometry chirality
// test (byte-identical to sigla-ml preprocessor.canonicalize_slots). When disabled,
// behavior is byte-identical to before. MUST retrain the model for this to take effect.
// Reverted again 2026-07: re-enabled with a matching sigla-ml preprocessor.py
// canonicalize_slots (fixing the mismatch that sank the first attempt) and it DID fix
// BREAD, but regressed one-handed signs like HELLO — a stray false-positive second-hand
// detection during an otherwise one-handed gesture now triggers a slot swap, corrupting
// frames that used to be fine. The deployed model was reverted to the pre-canonicalization
// version, so this flag and preprocessor.py's canonicalize_slots call MUST both stay off
// to match it. Two-handed signs remain a known unsolved gap — a real fix likely needs to
// gate the swap on genuine two-hand confidence, not just presence, before retrying.
private const val SLOT_CANONICALIZATION_ENABLED = false
// Sign convention: cross_z < 0 ⇒ RIGHT. Verify on-device against MediaPipe's label;
// flip if reversed. MUST equal Python _CHIRALITY_RIGHT_IS_NEGATIVE_CROSS.
private const val CHIRALITY_RIGHT_IS_NEGATIVE_CROSS = true

class MainActivity : AppCompatActivity() {

    private lateinit var binding   : ActivityMainBinding
    // Nullable rather than lateinit: both are now built on a background thread,
    // so there is a window where the camera is live but they don't exist yet.
    // The camera analyzer dereferences landmarker from its own thread, which
    // would be an UninitializedPropertyAccessException with lateinit.
    private var predictor : PredictionService? = null
    private var landmarker: HandLandmarkHelper? = null

    // Backend-related managers
    private lateinit var session: SessionManager
    private lateinit var historyManager: TranslationHistoryManager
    private lateinit var appSettings: AppSettings
    private var tts: TextToSpeech? = null
    private var isTtsReady = false

    private val executor      = Executors.newSingleThreadExecutor()
    private var isFrontCamera = false
    private var cameraProvider: ProcessCameraProvider? = null

    // Guards startVision()/stopVision() so a cold onCreate → onStart doesn't
    // initialize the pipeline twice, and a double teardown is a no-op.
    private var visionActive = false
    // False when onCreate bailed out early (onboarding), so onStart knows not to
    // bring up a camera for a screen that is on its way out.
    private var setupComplete = false
    // Held so teardown can cancel an in-flight model load rather than letting it
    // complete against a predictor that has already been closed.
    private var modelInitJob: Job? = null
    // Reused per frame instead of allocating a Matrix for every camera frame.
    private val frameMatrix = Matrix()

    // Add this variable at the top of MainActivity
    private var frameCounter = 0

    // ── Per-frame UI coalescing ───────────────────────────────────────────────
    // The landmarker callback used to post TWO separate runOnUiThread messages per
    // processed frame — one for the overlay, one from onCollecting — each costing a
    // Handler.post plus a Choreographer wake at ~15 Hz. onCollecting now only stores
    // its numbers here; the overlay post (the one that must stay near frame rate)
    // reads them and applies both updates in a single pass.
    @Volatile private var pendingCollectPct    = -1
    @Volatile private var pendingCollectFrames = -1

    // Last values actually written to the status views. progress is frames/30 capped,
    // so it repeats constantly — and every redundant setText costs a measure/layout
    // pass on the card. -1 forces the first write through.
    private var lastShownPct    = -1
    private var lastShownFrames = -1

    // Resolved once. ContextCompat.getColor is a full Resources lookup, and this
    // used to run on every collecting frame.
    private val motionIndicatorColor: Int by lazy {
        ContextCompat.getColor(this, android.R.color.holo_orange_light)
    }

    // ── Handedness latch (stabilizes left-handed mirroring across a gesture) ────
    // MediaPipe's Left/Right label flickers mid-gesture; we vote over the first few
    // frames after hands appear, latch the decision, and hold it until hands leave.
    private var latchedMirrorSlot0: Boolean? = null   // null = not yet decided
    private var latchedMirrorSlot1: Boolean? = null
    private var handVoteMirror0 = 0                    // votes: +1 mirror, -1 don't
    private var handVoteMirror1 = 0
    private var latchNoHandFrames = 0                  // frames with no hands → ends gesture

    // Slot-order latch: decide once per gesture whether the two hands are swapped,
    // using the single most hands-apart frame seen so far (largest |cz0|+|cz1|).
    // This mirrors Python canonicalize_slots, which decides from the best frame of
    // the whole sequence. Tracking the best-separation frame (not a vote count)
    // stops ambiguous hands-together frames from flipping the decision.
    private var latchedSwapSlots: Boolean? = null      // decision from best frame so far
    private var bestSlotSep = -1f                      // largest |cz0|+|cz1| seen this gesture

    // ── UI state ──────────────────────────────────────────────────────────────
    private var showFilipino       = true
    private var emergencyHoldStart = 0L

    // Filipino translations cache
    private var filipinoMap = mutableMapOf<String, String>()

    // elapsedRealtime of the last word-bank refresh, throttling onResume. 0 = never.
    private var lastWordBankRefresh = 0L

    // Last recognized label, so the Filipino toggle can re-show its translation
    // immediately instead of waiting for the next recognition.
    private var lastLabel: String? = null

    // ── Auth state ────────────────────────────────────────────────────────────
    private var isSignedIn      = false
    private var currentUsername = ""
    private var currentEmail    = ""

    // ─────────────────────────────────────────────────────────────────────────
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Initialize managers
        session = SessionManager.getInstance(this)
        historyManager = TranslationHistoryManager.getInstance(this)
        appSettings = AppSettings.getInstance(this)
        showFilipino = appSettings.showFilipino
        isFrontCamera = appSettings.isFrontCamera

        // Check first launch / onboarding
        if (session.isFirstLaunch) {
            session.isFirstLaunch = false
            if (!session.isOnboardingDone) {
                startActivity(Intent(this, OnboardingActivity::class.java))
                return  // Exit onCreate, onboarding will start MainActivity when done
            }
        }

        // Everything below ran; onStart() may now bring the camera up. Without
        // this the onboarding early-return above would still fall through to
        // onStart and load the models for a screen the user never sees.
        setupComplete = true

        // Initialize TTS
        initTts()

        startVision()

        // Load Filipino translations from backend/cache
        loadFilipinoTranslations()

        // setupCallbacks() is wired inside startVision(), which rebinds them to
        // each newly created predictor.
        setupButtons()
        setupSidebar()
        updateFilipinoToggleLabel()

        // Check if user is already signed in
        checkAuthState()
    }

    /**
     * Acquires the vision pipeline: MediaPipe landmarkers, the TFLite predictor,
     * and the camera.
     *
     * Split out of onCreate so onStop() can release these and onStart() can take
     * them again. Previously they were held until onDestroy(), which Android runs
     * *after* the next activity's onCreate — so navigating away left two MediaPipe
     * GPU contexts and two TFLite interpreters alive simultaneously, which is what
     * made switching screens stall.
     */
    private fun startVision() {
        if (visionActive || !setupComplete) return
        visionActive = true

        // The camera is bound immediately; the landmarker and predictor are built
        // on the IO dispatcher below. Building HandLandmarkHelper parses ~14 MB of
        // MediaPipe assets (7.8 MB hand + 5.8 MB pose) and uploads them to the GPU
        // — doing that on the main thread is what made entering this screen hang.
        if (hasCameraPermission()) startCamera()
        else requestCameraPermission()

        modelInitJob = lifecycleScope.launch(Dispatchers.IO) {
            withContext(Dispatchers.Main) {
                binding.tvStatus.text = "Starting camera..."
                binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_orange_light))
            }

            try {
                withContext(Dispatchers.Main) {
                    binding.tvStatus.text = "Loading hand tracking..."
                }

                // Built first, before any network work. MediaPipe comes from
                // bundled assets and owes nothing to the backend, so making it
                // wait on checkAndUpdate() would leave the user staring at a
                // preview with no hand tracking whenever the network is slow.
                //
                // The expensive part: parses both MediaPipe .task assets and
                // uploads them to the GPU delegate. applicationContext, not the
                // Activity — a late-finishing build must not retain a destroyed
                // Activity.
                val helper = HandLandmarkHelper(applicationContext) { result ->
                    val c0 = if (PIPELINE_PROFILING) System.nanoTime() else 0L
                    // Canonical slot order FIRST (RIGHT→slot0, LEFT→slot1)
                    val ordered = canonicalizeSlots(result.features, result.handedness, result.handsDetected)
                    val features = canonicalizeHandedness(
                        ordered, result.handedness, result.handednessScore, result.handsDetected
                    )
                    val c1 = if (PIPELINE_PROFILING) System.nanoTime() else 0L
                    predictor?.processFrame(features, result.handsDetected)
                    if (PIPELINE_PROFILING) {
                        val c2 = System.nanoTime()
                        PipelineProfiler.recordCallback(
                            canonicalizeMs = (c1 - c0) / 1e6,
                            processFrameMs = (c2 - c1) / 1e6,
                            sinceSubmitMs  = result.graphLatencyMs
                        )
                    }

                    // Single main-thread post per frame. processFrame above runs
                    // synchronously on this same callback thread, so anything it
                    // handed to onCollecting is already staged in the pending*
                    // fields by the time this block runs.
                    runOnUiThread {
                        val width = binding.cameraPreview.width.toFloat()
                        val height = binding.cameraPreview.height.toFloat()

                        // result.landmarks is already List<FloatArray> - no conversion needed!
                        binding.overlayView.setLandmarks(
                            result.landmarks,  // This is already the right format
                            width,
                            height,
                            isFrontCamera  // ← Just pass the mirror flag
                        )

                        flushCollectingState()
                    }
                }

                val service = PredictionService(applicationContext)

                // Publish both only if the screen is still active. Navigating away
                // mid-load cancels this job, and an orphaned helper would leak its
                // GPU context if we just dropped the reference.
                val published = withContext(Dispatchers.Main) {
                    if (!visionActive) {
                        helper.close()
                        service.close()
                        false
                    } else {
                        landmarker = helper
                        predictor  = service
                        setupCallbacks()   // binds onResult/onCollecting/onNoHands
                        true
                    }
                }
                if (!published) return@launch

                // Check for a newer deployed model on every launch — not just when no
                // local model exists. checkAndUpdate() compares version_number/tflite_url
                // against what's cached, only downloads+verifies when different, and keeps
                // the existing model in place if the check or download fails. Without this,
                // a retrained+redeployed model (e.g. after adding a new word) would never
                // reach a device that already has some model installed.
                withContext(Dispatchers.Main) {
                    binding.tvStatus.text = "Checking for model updates..."
                }
                val hasModel = ModelUpdateManager.checkAndUpdate(this@MainActivity, session.token)
                if (!hasModel) {
                    withContext(Dispatchers.Main) {
                        binding.tvStatus.text = "⚠ Failed to download model"
                        binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_dark))
                    }
                    return@launch
                }

                // The server derives the word bank from the deployed model, so a
                // version change — including a revert to an older version — means
                // the word list changed too. Refetch BEFORE the model reports
                // ready, otherwise the first recognitions of the session resolve
                // against words belonging to the version just replaced.
                if (ModelUpdateManager.lastCheckChangedVersion) {
                    withContext(Dispatchers.Main) {
                        binding.tvStatus.text = "Updating word bank..."
                    }
                    refreshWordBank()
                }

                // Initialize predictor (it will fetch labels from backend).
                // init() now suspends until labels actually arrive, so the old
                // blanket delay(2000) — which stalled every entry to this screen
                // whether or not it was needed — is gone.
                withContext(Dispatchers.Main) {
                    binding.tvStatus.text = "Fetching words from database..."
                }
                service.init()

                withContext(Dispatchers.Main) {
                    if (service.isReady) {
                        binding.tvStatus.text = "Models loaded"
                        binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_green_dark))
                        Log.d(TAG, "Model ready with ${service.getLabelCount()} classes")
                    } else {
                        binding.tvStatus.text = "Failed to load words from database"
                        binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_dark))
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.tvStatus.text = "⚠ Error: ${e.message}"
                    binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_dark))
                    Log.e(TAG, "Model error: ${e.message}", e)
                }
            }
        }
    }

    /**
     * Releases everything startVision() acquired. Called from onStop() so the
     * models are gone before the next screen builds, and defensively again from
     * onDestroy(). Both close() implementations are idempotent.
     */
    private fun stopVision() {
        if (!visionActive) return
        visionActive = false

        modelInitJob?.cancel()
        modelInitJob = null
        cameraProvider?.unbindAll()
        cameraProvider = null

        // Both close() calls block: PredictionService.close() waits on the lock an
        // in-flight LSTM pass holds, and HandLandmarkHelper.close() tears down a GPU
        // context. Running them on the main thread janked every exit from this screen.
        //
        // The fields are nulled FIRST, and unbindAll() above has already stopped new
        // frames, so nothing can reach either object once it is handed to the executor.
        // Both close() implementations are idempotent and hold applicationContext, so a
        // late-finishing close cannot retain this Activity.
        val doomedPredictor  = predictor
        val doomedLandmarker = landmarker
        predictor  = null
        landmarker = null
        if (doomedPredictor != null || doomedLandmarker != null) {
            teardownExecutor.execute {
                doomedPredictor?.close()
                doomedLandmarker?.close()
            }
        }
    }

    // ── Backend Initialization ────────────────────────────────────────────────

    private fun initTts() {
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.ENGLISH
                // This callback lands on the main thread, and resolving the
                // voice blocks on a binder call into the TTS engine process.
                // Do it off-thread; TtsVoiceHelper caches the result so it
                // only ever costs this once per preference.
                lifecycleScope.launch(Dispatchers.IO) {
                    TtsVoiceHelper.applyPreferredVoice(tts, appSettings)
                }
                isTtsReady = true
            }
        }
    }

    private fun speak(text: String) {
        if (!isTtsReady) return
        // The voice is already set on the engine at init and whenever the
        // preference changes — re-resolving it here cost a blocking engine
        // query on every single recognition.
        val volumeMultiplier = (appSettings.volume / 100f).coerceIn(0f, 1f)
        val params = Bundle().apply {
            putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volumeMultiplier)
        }
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, null)
    }

    /**
     * Refreshes translations in the background, at most once per
     * [WORD_BANK_REFRESH_INTERVAL_MS].
     *
     * Called from onResume, which fires on every return to this screen — including
     * a quick trip to the sidebar and back. Unthrottled that meant a full word-bank
     * fetch plus a disk cache write each time. The interval still picks up admin
     * edits without a restart, which is why the refresh exists.
     *
     * Startup does NOT come through here: it awaits refreshWordBank() directly,
     * because after a model-version change the word list has to land before
     * recognition starts.
     */
    private fun loadFilipinoTranslations() {
        val now = SystemClock.elapsedRealtime()
        if (lastWordBankRefresh != 0L && now - lastWordBankRefresh < WORD_BANK_REFRESH_INTERVAL_MS) return
        lastWordBankRefresh = now

        lifecycleScope.launch(Dispatchers.IO) {
            refreshWordBank()
        }
    }

    /**
     * Fetches the word bank and rebuilds the Filipino translation map.
     *
     * Suspending rather than fire-and-forget so the startup path can AWAIT it
     * after a model-version change — the word list belongs to the deployed
     * model, so it has to land before recognition starts.
     */
    private suspend fun refreshWordBank() {
        // Network first, cache as the offline fallback. The reverse order meant a
        // translation edited in the admin panel never reached this screen: once
        // word_bank_cache.json existed the elvis chain short-circuited and the API
        // was never called again.
        val words: List<WordBankWord> = try {
            val fresh = ApiClient.get(session.token).getWordBank().body()?.words
            if (!fresh.isNullOrEmpty()) {
                ModelUpdateManager.cacheWordBank(this@MainActivity, fresh)
                fresh
            } else {
                ModelUpdateManager.loadCachedWordBank(this@MainActivity) ?: emptyList()
            }
        } catch (e: Exception) {
            // Offline or server down — whatever was cached is still better than nothing.
            Log.w(TAG, "Word bank fetch failed, using cache: ${e.message}")
            ModelUpdateManager.loadCachedWordBank(this@MainActivity) ?: emptyList()
        }

        val map = mutableMapOf<String, String>()
        for (word in words) {
            val translation = word.filipino_translation
            if (!translation.isNullOrBlank()) {
                map[word.label.lowercase()] = translation
            }
        }
        // Never trade a populated map for an empty one: this now runs on every
        // onResume, and a failed fetch with no cache would otherwise wipe working
        // translations until the next successful load.
        if (map.isEmpty() && filipinoMap.isNotEmpty()) {
            Log.w(TAG, "Word bank returned no translations; keeping ${filipinoMap.size} existing")
            return
        }

        // Persisted here, still on the IO dispatcher. This loop used to sit inside the
        // withContext(Main) block below, so it ran one SharedPreferences write per word
        // on the UI thread — on every resume.
        words.forEach { word ->
            if (!word.filipino_translation.isNullOrBlank()) {
                historyManager.setTranslation(word.label.lowercase(), word.filipino_translation)
            }
        }

        withContext(Dispatchers.Main) {
            filipinoMap = map
            Log.i(TAG, "Loaded ${map.size} Filipino translation(s)")
        }
    }

    private fun checkAuthState() {
        // The token read is an AES decrypt (SessionManager is backed by
        // EncryptedSharedPreferences), so it happens inside the coroutine
        // rather than on the main thread during onCreate.
        lifecycleScope.launch(Dispatchers.IO) {
            // First touch of the encrypted store, and so where Keystore init lands.
            // Carries the onboarding flags over for users upgrading from a build that
            // kept them there.
            session.migrateOnboardingFlags()

            val token = session.token
            if (token.isNullOrEmpty()) return@launch
            try {
                val response = ApiClient.get(token).getMe()
                if (response.isSuccessful) {
                    val user = response.body()?.user
                    if (user != null) {
                        isSignedIn = true
                        currentUsername = user.username
                        currentEmail = user.email
                    }
                }
            } catch (e: Exception) {
                // Token might be expired
                session.clearSession()
            }
        }
    }

    // ── Predictor callbacks ───────────────────────────────────────────────────

    private fun setupCallbacks() {
        // Called right after predictor is assigned in startVision(); bind once to
        // a local so the three registrations can't race a concurrent teardown.
        val predictor = this.predictor ?: return

        predictor.onResult = { result ->
            runOnUiThread {
                // Confidence is no longer shown to the user, but it is still recorded
                // with each history entry (see historyManager.add below).
                val pct = (result.confidence * 100).toInt()

                lastLabel = result.label
                binding.tvResult.text         = result.label.uppercase()
                binding.cardResult.visibility = View.VISIBLE
                binding.progressBuffer.progress = 0
                binding.tvBufferPercent.text = "0%"

                // Text-to-speech
                speak(result.label)

                // Save to history off the main thread: add() serializes the whole
                // list and writes prefs, and this fires at the exact moment the
                // result card animates in.
                val gestureType = if (result.isMotion) "motion" else "static"
                val label = result.label
                lifecycleScope.launch(Dispatchers.IO) {
                    historyManager.add(label, pct, gestureType)
                }

                // Filipino translation
                val filipino = getFilipinoTranslation(result.label)
                if (filipino != null && showFilipino) {
                    binding.tvFilipinoResult.text = filipino
                    binding.tvFilipinoResult.visibility = View.VISIBLE
                } else {
                    binding.tvFilipinoResult.visibility = View.GONE
                    // Distinguishes "no translation for this label" from "toggle is off" —
                    // the missing-entry case used to fail silently.
                    if (filipino == null) {
                        Log.d(TAG, "No Filipino translation for '${result.label}' " +
                            "(${filipinoMap.size} translation(s) loaded)")
                    }
                }

                binding.cardResult.postDelayed(
                    { binding.cardResult.visibility = View.INVISIBLE }, 2000)
            }
        }

        // Stage only — no runOnUiThread here. This fires on MediaPipe's callback
        // thread once per buffered frame, and the landmarker callback that invoked
        // it posts to the UI thread immediately afterwards; flushCollectingState()
        // applies these values there. See the pending* fields.
        predictor.onCollecting = { state ->
            pendingCollectPct    = (state.progress * 100).toInt()
            pendingCollectFrames = state.frames
        }

        predictor.onNoHands = {
            runOnUiThread {
                // Drop any staged collecting update: the gesture is over, so applying
                // it after this reset would put a stale frame count back on screen.
                pendingCollectPct    = -1
                pendingCollectFrames = -1
                lastShownPct         = -1
                lastShownFrames      = -1

                binding.tvFrames.text             = "No hands"
                binding.tvVelocity.text           = "—"
                binding.tvStreak.visibility       = View.GONE
                binding.progressBuffer.progress   = 0
                binding.tvBufferPercent.text = "0%"
                binding.overlayView.clear()
                binding.tvHandsWarning.visibility = View.GONE
            }
        }
    }

    /**
     * Applies the collecting-progress values staged by [PredictionService.onCollecting],
     * from the single per-frame UI post in the landmarker callback.
     *
     * Each update is guarded against the previous one. `progress` is frames/30 capped,
     * so consecutive frames very often produce an identical percentage, and a redundant
     * setText still costs a full measure/layout pass on the status card.
     */
    private fun flushCollectingState() {
        val pct = pendingCollectPct
        if (pct >= 0 && pct != lastShownPct) {
            lastShownPct = pct
            binding.progressBuffer.progress = pct
            binding.tvBufferPercent.text    = "$pct%"
        }

        val frames = pendingCollectFrames
        if (frames >= 0 && frames != lastShownFrames) {
            lastShownFrames = frames
            binding.tvFrames.text = "$frames"

            // tvVelocity/tvStreak are NOT updated per frame any more. CollectingState's
            // isMotion and streak were always true/0 (the producer never overrode their
            // defaults), so this re-rendered a constant label — and resolved a colour
            // through Resources — on every frame. The steady-state values are set here,
            // only when a gesture actually starts, and reset by onNoHands.
            if (binding.tvStreak.visibility != View.GONE) binding.tvStreak.visibility = View.GONE
            binding.tvVelocity.text = MOTION_INDICATOR_TEXT
            binding.tvVelocity.setTextColor(motionIndicatorColor)
        }
    }

    // ── Buttons ───────────────────────────────────────────────────────────────

    private fun setupButtons() {
        // Flip camera
        binding.btnFlipCamera.setOnClickListener {
            isFrontCamera = !isFrontCamera
            appSettings.isFrontCamera = isFrontCamera
            // No-op if the models are still loading — flipping is still valid.
            predictor?.reset()
            resetHandednessLatch()
            bindCamera()
        }

        // Filipino translation toggle
        binding.btnToggleFilipino.setOnClickListener {
            showFilipino = !showFilipino
            appSettings.showFilipino = showFilipino
            updateFilipinoToggleLabel()
            // Re-show the current word's translation right away; waiting for the next
            // recognition made the toggle look broken.
            val translation = if (showFilipino) lastLabel?.let { getFilipinoTranslation(it) } else null
            if (translation != null) {
                binding.tvFilipinoResult.text = translation
                binding.tvFilipinoResult.visibility = View.VISIBLE
            } else {
                binding.tvFilipinoResult.visibility = View.GONE
            }
        }

        // Emergency — hold 2 seconds
        binding.btnEmergency.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    emergencyHoldStart = SystemClock.elapsedRealtime()
                    binding.btnEmergency.postDelayed(emergencyRunnable, 2000)
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    binding.btnEmergency.removeCallbacks(emergencyRunnable)
                    true
                }
                else -> false
            }
        }
    }

    private val emergencyRunnable = Runnable {
        speak("Help me")
        Toast.makeText(this, "Emergency alert played", Toast.LENGTH_LONG).show()
    }

    private fun updateFilipinoToggleLabel() {
        binding.btnToggleFilipino.text =
            if (showFilipino) "Hide Filipino" else "Show Filipino"
    }

    // Updated to use cached translations from backend
    private fun getFilipinoTranslation(label: String): String? {
        return filipinoMap[label.lowercase()]
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────

private fun setupSidebar() {
    val drawer = binding.drawerLayout

    setActiveNavItem(R.id.navMainInterface)

    binding.btnSidebar.setOnClickListener {
        drawer.openDrawer(GravityCompat.START)
    }

    findViewById<View>(R.id.navMainInterface)?.setOnClickListener {
        drawer.closeDrawer(GravityCompat.START)
    }

    findViewById<View>(R.id.navWordBank)?.setOnClickListener {
        drawer.closeDrawer(GravityCompat.START)
        startActivity(Intent(this, WordBankActivity::class.java))
        finish()
    }

    findViewById<View>(R.id.navTranslationHistory)?.setOnClickListener {
        drawer.closeDrawer(GravityCompat.START)
        startActivity(Intent(this, TranslationHistoryActivity::class.java))
        finish()
    }

    findViewById<View>(R.id.navSettings)?.setOnClickListener {
        drawer.closeDrawer(GravityCompat.START)
        startActivity(Intent(this, SettingsActivity::class.java))
        finish()
    }

    // navProfile / navNotifications / btnSidebarSignIn are deliberately absent:
    // those ids exist only in the orphaned drawer_sidebar.xml, which nothing
    // inflates, so the lookups always missed — and a *failed* findViewById walks
    // the entire ~85-view hierarchy before returning null. Profile and
    // Notifications are unreachable from this screen either way; restoring them
    // means adding the rows to nav_sidebar.xml.
}

private fun setActiveNavItem(activeId: Int) {
    // Only the ids nav_sidebar.xml actually defines — navNotifications and
    // navProfile were full-hierarchy misses on every call.
    val navIds = listOf(
        R.id.navMainInterface, R.id.navWordBank, R.id.navTranslationHistory,
        R.id.navSettings
    )
    navIds.forEach { id ->
        val view = findViewById<LinearLayout>(id)
        if (id == activeId) {
            view?.setBackgroundResource(R.drawable.bg_nav_item_selected)
            (view?.getChildAt(0) as? ImageView)?.imageTintList =
                android.content.res.ColorStateList.valueOf(0xFF4A90E2.toInt())
            (view?.getChildAt(1) as? TextView)?.apply {
                setTextColor(0xFF4A90E2.toInt())
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
        } else {
            view?.setBackgroundResource(R.drawable.bg_nav_item_default)
            (view?.getChildAt(0) as? ImageView)?.imageTintList =
                android.content.res.ColorStateList.valueOf(0xFF6C757D.toInt())
            (view?.getChildAt(1) as? TextView)?.apply {
                setTextColor(0xFF6C757D.toInt())
                setTypeface(null, android.graphics.Typeface.NORMAL)
            }
        }
    }
}
    // refreshSidebarAuthState() and openAuthDialog() removed: the former wrote to
    // tvSidebarUsername / tvSidebarEmail / btnSidebarSignIn, none of which exist
    // in nav_sidebar.xml, so all three lookups were full-hierarchy misses — paid
    // on both onCreate and onResume. The latter was only reachable from the dead
    // sidebar handlers. Sign-in from this screen needs those views added to
    // nav_sidebar.xml first.

    // ── Camera ────────────────────────────────────────────────────────────────

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            // The provider resolves asynchronously, so the activity may already
            // have been stopped (and the pipeline torn down) by the time this
            // runs — binding here would resurrect a camera we just released.
            if (!visionActive) return@addListener
            cameraProvider = future.get()
            bindCamera()
        }, ContextCompat.getMainExecutor(this))
    }

    /**
     * Picks an AE target-fps range with the highest available lower bound.
     *
     * Only ranges the HAL advertises are eligible — passing an unsupported range
     * makes the capture session throw. Preferring a high FLOOR is the point: it is
     * the floor the HAL drops to in low light, and on this hardware the default
     * [5, 30] is what pinned the pipeline near 5 fps. Ties break on the higher
     * ceiling. Returns null if nothing beats the default, leaving CameraX alone.
     */
    private fun selectAeFpsRange(): Range<Int>? = try {
        val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val lensFacing = if (isFrontCamera) {
            CameraCharacteristics.LENS_FACING_FRONT
        } else {
            CameraCharacteristics.LENS_FACING_BACK
        }
        val cameraId = manager.cameraIdList.firstOrNull { id ->
            manager.getCameraCharacteristics(id)
                .get(CameraCharacteristics.LENS_FACING) == lensFacing
        }
        val ranges = cameraId?.let {
            manager.getCameraCharacteristics(it)
                .get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
        }
        val best = ranges
            ?.filter { it.upper >= MIN_ACCEPTABLE_FPS }
            ?.maxWithOrNull(compareBy({ it.lower }, { it.upper }))

        if (best != null && best.lower >= MIN_ACCEPTABLE_FPS) {
            Log.i(TAG, "AE fps range pinned to $best (available: ${ranges?.joinToString()})")
            best
        } else {
            Log.w(TAG, "No AE range with floor >= $MIN_ACCEPTABLE_FPS; " +
                "leaving HAL default (available: ${ranges?.joinToString()})")
            null
        }
    } catch (e: Exception) {
        Log.w(TAG, "Could not query AE fps ranges: ${e.message}")
        null
    }

    private fun bindCamera() {
        val provider = cameraProvider ?: return

        // Pin the auto-exposure frame-rate floor.
        //
        // The MediaTek HAL defaults this to [5, 30]: in anything short of bright
        // light, AE lengthens exposure and drops the sensor to ~5 fps to brighten the
        // image. Measured on-device, that alone set the whole pipeline's cadence —
        // frames arrived ~200 ms apart while the work per frame was only ~110 ms, so
        // the analyzer sat idle waiting for the camera, and recognition saw a third
        // of the frames it was tuned for.
        //
        // Raising the floor to 24 trades some low-light brightness for a steady feed.
        // Applied to Preview, so the analyzer inherits the same capture cadence.
        val previewBuilder = Preview.Builder()
        selectAeFpsRange()?.let { range ->
            Camera2Interop.Extender(previewBuilder)
                .setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
        }
        val preview = previewBuilder.build().also {
            it.setSurfaceProvider(binding.cameraPreview.surfaceProvider)
        }

        // For front camera, mirror the preview
        if (isFrontCamera) {
            // CameraX PreviewView handles mirroring automatically for front camera
            // But if you need to force it:
            binding.cameraPreview.scaleX = -1f
            binding.cameraPreview.scaleY = 1f
        } else {
            binding.cameraPreview.scaleX = 1f
            binding.cameraPreview.scaleY = 1f
        }        

        val analysis = ImageAnalysis.Builder()
            .setTargetRotation(binding.cameraPreview.display?.rotation ?: android.view.Surface.ROTATION_0)
            .setTargetResolution(android.util.Size(240, 180))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()

        analysis.setAnalyzer(executor) { imageProxy ->
            // The camera is bound before the landmarker finishes building, so
            // early frames have nowhere to go. Bail before the bitmap work
            // rather than after it.
            val lm = landmarker
            if (lm == null) {
                imageProxy.close()
                return@setAnalyzer
            }
            frameCounter++
            // Skip every 2nd frame: MediaPipe runs on half the camera frames.
            //
            // Combined with PredictionService.MOTION_SLIDE_INTERVAL = 2, an LSTM pass
            // therefore happens on every 4th CAMERA frame — roughly 7.5 Hz at 30 fps.
            // That is the cadence the firing constants were tuned against
            // (MOTION_EARLY_STREAK = 10 ≈ 40 camera frames ≈ 1.3 s of held sign), so
            // changing this skip silently retunes MOTION_EARLY_STREAK / EARLY_EXIT_STREAK
            // in wall-clock terms. Re-run sigla-ml/tools/simulate_early_fire.py before
            // altering it.
            //
            // STRATEGY_KEEP_ONLY_LATEST means CameraX drops stale frames if MediaPipe
            // falls behind, so the real rate self-limits to what the device sustains.
            if (frameCounter % 2 == 0) {
                imageProxy.close()
                return@setAnalyzer
            }
            val t0              = if (PIPELINE_PROFILING) System.nanoTime() else 0L
            val bitmap          = imageProxy.toBitmap()
            val rotationDegrees = imageProxy.imageInfo.rotationDegrees
            val t1              = if (PIPELINE_PROFILING) System.nanoTime() else 0L
            val prepared        = prepareBitmap(bitmap, rotationDegrees, isFrontCamera)
            val t2              = if (PIPELINE_PROFILING) System.nanoTime() else 0L
            lm.detectAsync(prepared, SystemClock.elapsedRealtime())
            val t3              = if (PIPELINE_PROFILING) System.nanoTime() else 0L
            imageProxy.close()
            if (PIPELINE_PROFILING) {
                PipelineProfiler.recordCamera(
                    toBitmapMs = (t1 - t0) / 1e6,
                    prepareMs  = (t2 - t1) / 1e6,
                    submitMs   = (t3 - t2) / 1e6
                )
            }
        }

        val selector = if (isFrontCamera)
            CameraSelector.DEFAULT_FRONT_CAMERA
        else
            CameraSelector.DEFAULT_BACK_CAMERA

        try {
            provider.unbindAll()
            provider.bindToLifecycle(this, selector, preview, analysis)
        } catch (e: Exception) {
            Log.e(TAG, "Camera bind failed: ${e.message}")
        }
    }

    // 2D cross-product z of (wrist→index-MCP)×(wrist→pinky-MCP) for a hand block.
    // Landmarks 0=wrist, 5=index MCP, 17=pinky MCP. Byte-identical to Python _hand_cross_z.
    private fun handCrossZ(features: FloatArray, base: Int): Float {
        val wx = features[base]; val wy = features[base + 1]
        val v1x = features[base + 5 * 3] - wx;  val v1y = features[base + 5 * 3 + 1] - wy
        val v2x = features[base + 17 * 3] - wx; val v2y = features[base + 17 * 3 + 1] - wy
        return v1x * v2y - v1y * v2x
    }

    private fun isRightHand(crossZ: Float): Boolean =
        if (CHIRALITY_RIGHT_IS_NEGATIVE_CROSS) crossZ < 0f else crossZ > 0f

    // Reorder the two hand blocks so RIGHT→slot0, LEFT→slot1 (matches Python
    // canonicalize_slots). One-handed frames are untouched. The swap decision is LATCHED
    // per gesture (votes accumulate while hands are visible). For the ordering KEY only,
    // the front-camera x-flip is undone (negate x) so anatomical chirality matches
    // training/back-cam — the features themselves are NOT altered here.
    private fun canonicalizeSlots(
        features: FloatArray,
        handedness: List<String?>,
        handsDetected: Int,
    ): FloatArray {
        if (!SLOT_CANONICALIZATION_ENABLED) return features
        if (handsDetected == 0) return features   // latch reset handled in canonicalizeHandedness

        var slot0Present = false
        for (k in 0 until 63) if (features[k] != 0f) { slot0Present = true; break }
        var slot1Present = false
        for (k in 63 until 126) if (features[k] != 0f) { slot1Present = true; break }
        if (!(slot0Present && slot1Present)) return features   // one-handed → no reorder

        // Camera-independent (see MEDIAPIPE_LABELS_INVERTED calibration note above):
        // MediaPipe sees the true, unmirrored scene on both cameras, so chirality needs
        // no per-camera correction here either — same fix as canonicalizeHandedness's
        // mirrorLabel, which had the same now-false "front camera flips the bitmap"
        // assumption.
        val cz0 = handCrossZ(features, 0)
        val cz1 = handCrossZ(features, 63)

        // Update the decision only when THIS frame is the most hands-apart so far —
        // that is where chirality is most reliable. Ambiguous hands-together frames
        // (small |cz0|+|cz1|) never override a cleaner earlier frame's decision.
        val sep = kotlin.math.abs(cz0) + kotlin.math.abs(cz1)
        if (sep > bestSlotSep) {
            bestSlotSep = sep
            latchedSwapSlots = (!isRightHand(cz0)) && isRightHand(cz1)
        }
        val swap = latchedSwapSlots ?: false

        // Stage-0 log to verify the chirality convention on-device.
        Log.d(TAG, "slots cam=${if (isFrontCamera) "front" else "back"} " +
                "cz0=$cz0 cz1=$cz1 sep=$sep best=$bestSlotSep " +
                "mp0=${handedness.getOrNull(0)} mp1=${handedness.getOrNull(1)} swap=$swap")

        if (!swap) return features
        val out = features.copyOf()
        for (k in 0 until 63) { out[k] = features[63 + k]; out[63 + k] = features[k] }
        return out
    }

    // Canonicalize every hand to the right-handed orientation the model was trained on.
    // Rule (camera-independent): mirror a hand iff MediaPipe reports it "Left" — the
    // front-camera flip is already encoded in that label. To resist per-frame label
    // flicker, the mirror decision is LATCHED per gesture: votes accumulate while hands
    // are visible and the latched decision holds until hands leave for LATCH_NO_HAND_RESET
    // frames. Per hand slot; absent (all-zero) blocks are skipped.
    private fun canonicalizeHandedness(
        features: FloatArray,
        handedness: List<String?>,
        scores: List<Float>,
        handsDetected: Int,
    ): FloatArray {
        if (!LEFT_HANDED_SUPPORT_ENABLED) {
            // Legacy behavior: unconditionally mirror the whole frame on the front camera.
            return if (isFrontCamera) mirrorHandX(features) else features
        }

        // Gesture boundary: when hands disappear long enough, reset the latch.
        if (handsDetected == 0) {
            latchNoHandFrames++
            if (latchNoHandFrames >= LATCH_NO_HAND_RESET) resetHandednessLatch()
            return features
        }
        latchNoHandFrames = 0

        val out = features.copyOf()

        // Camera-independent: MediaPipe's Left/Right label matches the true anatomical
        // hand the same way on both cameras (see MEDIAPIPE_LABELS_INVERTED above), so
        // the same hand always gets the same mirror decision regardless of camera.
        val mirrorLabel = if (MEDIAPIPE_LABELS_INVERTED) "Right" else "Left"

        var presentCount = 0
        var lastDecidedSlotMirrored = false

        for (slot in 0..1) {
            val base = slot * 63
            var present = false
            for (k in base until base + 63) {
                if (out[k] != 0f) { present = true; break }
            }
            if (!present) continue
            presentCount++

            val latched = if (slot == 0) latchedMirrorSlot0 else latchedMirrorSlot1
            if (latched == null) {
                val label = handedness.getOrNull(slot)
                val score = scores.getOrNull(slot) ?: 0f
                if (label != null && score >= HANDEDNESS_MIN_SCORE) {
                    val vote = if (label == mirrorLabel) 1 else -1
                    if (slot == 0) handVoteMirror0 += vote else handVoteMirror1 += vote
                }
                val votes = if (slot == 0) handVoteMirror0 else handVoteMirror1
                if (kotlin.math.abs(votes) >= 3) {
                    val decision = votes > 0
                    if (slot == 0) latchedMirrorSlot0 = decision else latchedMirrorSlot1 = decision
                }
            }

            val decided = (if (slot == 0) latchedMirrorSlot0 else latchedMirrorSlot1)
                ?: ((if (slot == 0) handVoteMirror0 else handVoteMirror1) > 0)
            if (decided) {
                for (j in 0..20) out[base + j * 3] = -out[base + j * 3]
            }
            lastDecidedSlotMirrored = decided
        }

        // Pose block (nose/shoulders/elbows/wrists) describes the WHOLE body, not a single
        // hand slot, so mirroring only the hand landmarks leaves an inconsistent frame: a
        // "right-hand-shaped" hand paired with the TRUE, unmirrored arm/shoulder position —
        // a combination the model never saw in training (real right-handed samples pair a
        // right hand with a right-arm-raised pose). Only safe to resolve automatically for
        // one-handed frames; with two hands present and potentially conflicting mirror
        // decisions, there's no single correct pose mirror, so we leave it alone (same
        // known limitation as the two-handed slot-swap case above).
        if (presentCount == 1 && lastDecidedSlotMirrored) {
            mirrorPoseBlock(out)
        }
        return out
    }

    // Negate x + swap L/R paired points (Lshoulder<->Rshoulder, Lelbow<->Relbow,
    // Lwrist<->Rwrist; nose stays). MUST match HandLandmarkHelper's POSE_BASE (126) and
    // POSE_KEYPOINTS order (nose, Lshoulder, Rshoulder, Lelbow, Relbow, Lwrist, Rwrist).
    private fun mirrorPoseBlock(features: FloatArray) {
        val base = 126
        var present = false
        for (k in base until base + 21) if (features[k] != 0f) { present = true; break }
        if (!present) return

        for (k in 0..6) features[base + k * 3] = -features[base + k * 3]
        for ((a, b) in listOf(1 to 2, 3 to 4, 5 to 6)) {
            for (off in 0..2) {
                val ai = base + a * 3 + off
                val bi = base + b * 3 + off
                val tmp = features[ai]
                features[ai] = features[bi]
                features[bi] = tmp
            }
        }
    }

    private fun resetHandednessLatch() {
        latchedMirrorSlot0 = null
        latchedMirrorSlot1 = null
        handVoteMirror0 = 0
        handVoteMirror1 = 0
        latchNoHandFrames = 0
        // Reset the slot-order latch together (same gesture lifecycle).
        latchedSwapSlots = null
        bestSlotSep = -1f
    }

    private fun mirrorHandX(features: FloatArray): FloatArray {
        val mirrored = features.copyOf()
        // Landmarks are wrist-relative (normalized in HandLandmarkHelper), so a
        // horizontal mirror is a sign flip: x → -x. Only flip present hands; an absent
        // hand is 63 zeros (−0 == 0, so it stays a valid "no hand" sentinel).
        for (hand in 0..1) {
            val base = hand * 63
            var present = false
            for (k in base until base + 63) {
                if (mirrored[k] != 0f) { present = true; break }
            }
            if (!present) continue
            for (j in 0..20) {
                mirrored[base + j * 3] = -mirrored[base + j * 3]
            }
        }
        return mirrored
    }

    private fun prepareBitmap(bitmap: Bitmap, rotationDegrees: Int, frontCamera: Boolean): Bitmap {
        val maxDim = 640
        val scale = minOf(maxDim.toFloat() / bitmap.width, maxDim.toFloat() / bitmap.height, 1f)
        
        // Fast path: no transform needed
        if (scale >= 1f && rotationDegrees == 0 && !frontCamera) {
            return bitmap
        }
        
        // Reused rather than allocated: this runs on every camera frame, and in
        // portrait rotationDegrees is never 0, so the fast path above never hits.
        val matrix = frameMatrix.apply {
            reset()
            if (scale < 1f) postScale(scale, scale)
            if (rotationDegrees != 0) postRotate(rotationDegrees.toFloat())
            // For front camera: DON'T mirror the image going to the model
            // The preview (PreviewView) handles the display mirroring separately
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
    // ── Permissions ───────────────────────────────────────────────────────────

    private fun hasCameraPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED

    private fun requestCameraPermission() =
        ActivityCompat.requestPermissions(
            this, arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION)

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION &&
            grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            Toast.makeText(this, "Camera permission required", Toast.LENGTH_LONG).show()
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onResume() {
        super.onResume()
        // refreshNotifBadge() removed: it fired a network request on every
        // resume — plus an encrypted-prefs read and a failed view lookup — to
        // populate tvNotifBadge, which exists in no inflated layout.
        // Picks up translations edited in the admin panel without needing a restart.
        loadFilipinoTranslations()
    }

    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        if (binding.drawerLayout.isDrawerOpen(GravityCompat.START)) {
            binding.drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onStart() {
        super.onStart()
        // Re-acquire after a previous onStop() released the pipeline. No-op on
        // the cold path, where onCreate has already called this.
        startVision()
    }

    /**
     * Release the camera and both models here rather than in onDestroy().
     *
     * onDestroy() for this activity runs *after* the next activity's onCreate(),
     * so holding MediaPipe and TFLite until then meant two sets of models were
     * live at the moment of navigation — the stall when switching screens.
     */
    override fun onStop() {
        stopVision()
        super.onStop()
    }

    override fun onDestroy() {
        executor.shutdown()
        stopVision()          // defensive: onStop normally got here first
        tts?.shutdown()
        super.onDestroy()
    }
}




