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
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.GravityCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.example.sigla.databinding.ActivityMainBinding
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import java.util.concurrent.Executors
import kotlinx.coroutines.delay

private const val TAG               = "MainActivity"
private const val CAMERA_PERMISSION = 100

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
    private lateinit var predictor : PredictionService
    private lateinit var landmarker: HandLandmarkHelper

    // Backend-related managers
    private lateinit var session: SessionManager
    private lateinit var historyManager: TranslationHistoryManager
    private lateinit var appSettings: AppSettings
    private var tts: TextToSpeech? = null
    private var isTtsReady = false

    private val executor      = Executors.newSingleThreadExecutor()
    private var isFrontCamera = false
    private var cameraProvider: ProcessCameraProvider? = null

    // Add this variable at the top of MainActivity
    private var frameCounter = 0

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

    // ── TEMP: diagnose NO/BREAD misrecognition — remove once resolved ───────────
    private var maxHandsSeenThisGesture = 0

    // ── UI state ──────────────────────────────────────────────────────────────
    private var showFilipino       = true
    private var emergencyHoldStart = 0L
    private var frameSkipCounter   = 0

    // Filipino translations cache
    private var filipinoMap = mutableMapOf<String, String>()

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

        // Check first launch / onboarding
        if (session.isFirstLaunch) {
            session.isFirstLaunch = false
            if (!session.isOnboardingDone) {
                startActivity(Intent(this, OnboardingActivity::class.java))
                return  // Exit onCreate, onboarding will start MainActivity when done
            }
        }

        // Initialize TTS
        initTts()

        predictor  = PredictionService(this)
        landmarker = HandLandmarkHelper(this) { result ->
            // TEMP: track whether this gesture ever showed 2 hands (diagnosing whether
            // NO/BREAD are being signed/trained as one- or two-handed).
            if (result.handsDetected > maxHandsSeenThisGesture) maxHandsSeenThisGesture = result.handsDetected

            // Canonical slot order FIRST (RIGHT→slot0, LEFT→slot1)
            val ordered = canonicalizeSlots(result.features, result.handedness, result.handsDetected)
            val features = canonicalizeHandedness(
                ordered, result.handedness, result.handednessScore, result.handsDetected
            )
            predictor.processFrame(features, result.handsDetected)
            
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
            }
        }

        lifecycleScope.launch(Dispatchers.IO) {
            withContext(Dispatchers.Main) { 
                binding.tvStatus.text = "Loading model..."
                binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_orange_light))
            }

            try {
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

                // Initialize predictor (it will fetch labels from backend)
                withContext(Dispatchers.Main) { 
                    binding.tvStatus.text = "Fetching words from database..."
                }
                predictor.init()
                
                // Wait a bit for labels to load
                delay(2000)
                
                withContext(Dispatchers.Main) {
                    if (predictor.isReady) {
                        binding.tvStatus.text = "✅ Models loaded ✓"
                        binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_green_dark))
                        Log.d("MainActivity", "✅ Model ready with ${predictor.getLabelCount()} classes")
                    } else {
                        binding.tvStatus.text = "⚠ Failed to load words from database"
                        binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_dark))
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.tvStatus.text = "⚠ Error: ${e.message}"
                    binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_dark))
                    Log.e("MainActivity", "Model error: ${e.message}", e)
                }
            }
        }

        // Load Filipino translations from backend/cache
        loadFilipinoTranslations()

        setupCallbacks()
        setupButtons()
        setupSidebar()
        updateFilipinoToggleLabel()

        if (hasCameraPermission()) startCamera()
        else requestCameraPermission()

        // Check if user is already signed in
        checkAuthState()
    }

    // ── Backend Initialization ────────────────────────────────────────────────

    private fun applyTtsVoice() {
        TtsVoiceHelper.applyPreferredVoice(tts, appSettings)
    }

    private fun initTts() {
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.ENGLISH
                applyTtsVoice()
                isTtsReady = true
            }
        }
    }

    private fun speak(text: String) {
        if (!isTtsReady) return
        applyTtsVoice()
        val volumeMultiplier = (appSettings.volume / 100f).coerceIn(0f, 1f)
        val params = Bundle().apply {
            putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volumeMultiplier)
        }
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, null)
    }

    private fun loadFilipinoTranslations() {
        lifecycleScope.launch(Dispatchers.IO) {
            val words: List<WordBankWord> = try {
                // Prefer local cache — works offline
                ModelUpdateManager.loadCachedWordBank(this@MainActivity)
                    ?: ApiClient.get(session.token).getWordBank().body()?.words
                    ?: emptyList()
            } catch (e: Exception) {
                emptyList()
            }

            val map = mutableMapOf<String, String>()
            for (word in words) {
                val translation = word.filipino_translation
                if (!translation.isNullOrBlank()) {
                    map[word.label.lowercase()] = translation
                }
            }
            withContext(Dispatchers.Main) {
                filipinoMap = map
                // Also save to history manager if needed
                words.forEach { word ->
                    if (!word.filipino_translation.isNullOrBlank()) {
                        historyManager.setTranslation(word.label.lowercase(), word.filipino_translation)
                    }
                }
            }
        }
    }

    private fun checkAuthState() {
        // Check if user has a valid token
        val token = session.token
        if (!token.isNullOrEmpty()) {
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val response = ApiClient.get(token).getMe()
                    if (response.isSuccessful) {
                        val user = response.body()?.user
                        if (user != null) {
                            isSignedIn = true
                            currentUsername = user.username
                            currentEmail = user.email
                            withContext(Dispatchers.Main) {
                                refreshSidebarAuthState()
                            }
                        }
                    }
                } catch (e: Exception) {
                    // Token might be expired
                    session.clearSession()
                }
            }
        }
    }

    // ── Predictor callbacks ───────────────────────────────────────────────────

    private fun setupCallbacks() {
        predictor.onResult = { result ->
            // TEMP: diagnose NO/BREAD misrecognition on front camera.
            Log.d(TAG, "NOBREAD_TEST cam=${if (isFrontCamera) "front" else "back"} " +
                "label=${result.label} conf=${result.confidence} maxHands=$maxHandsSeenThisGesture " +
                "latchedSlot0=$latchedMirrorSlot0 latchedSlot1=$latchedMirrorSlot1")
            maxHandsSeenThisGesture = 0
            runOnUiThread {
                val pct = (result.confidence * 100).toInt()
                val tag = if (result.isMotion) "MOTION" else "STATIC"
                val ee  = if (result.earlyExit) " ⚡" else ""

                binding.tvResult.text         = result.label.uppercase()
                binding.tvConfidence.text     = "$pct%  [$tag]$ee"
                binding.cardResult.visibility = View.VISIBLE
                binding.progressBuffer.progress = 0
                binding.tvBufferPercent.text = "0%"

                // Text-to-speech
                speak(result.label)

                // Save to history
                historyManager.add(result.label, pct, if (result.isMotion) "motion" else "static")

                // Filipino translation
                // FIX: removed redundant `filipino?.let` — direct assignment after null check
                val filipino = getFilipinoTranslation(result.label)
                if (filipino != null && showFilipino) {
                    binding.tvFilipinoResult.text = filipino
                    binding.tvFilipinoResult.visibility = View.VISIBLE
                } else {
                    binding.tvFilipinoResult.visibility = View.GONE
                }

                binding.cardResult.postDelayed(
                    { binding.cardResult.visibility = View.INVISIBLE }, 2000)
            }
        }

        predictor.onCollecting = { state ->
            runOnUiThread {
                val pct = (state.progress * 100).toInt()
                binding.progressBuffer.progress = pct
                binding.tvBufferPercent.text    = "$pct%"

                // 👐 Hands card
                binding.tvFrames.text = "${state.frames}"

                // 🎯 Gesture card — tvVelocity shows motion/static indicator
                binding.tvVelocity.text = if (state.isMotion) "● MOTION" else "○ static"
                binding.tvVelocity.setTextColor(
                    ContextCompat.getColor(this,
                        if (state.isMotion) android.R.color.holo_orange_light
                        else android.R.color.darker_gray)
                )

                // 📊 Status card — tvStreak shows early-exit streak
                if (state.streak > 0) {
                    binding.tvStreak.text       = "×${state.streak}"
                    binding.tvStreak.visibility = View.VISIBLE
                } else {
                    binding.tvStreak.visibility = View.GONE
                }
            }
        }

        predictor.onNoHands = {
            runOnUiThread {
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

    // ── Buttons ───────────────────────────────────────────────────────────────

    private fun setupButtons() {
        // Flip camera
        binding.btnFlipCamera.setOnClickListener {
            isFrontCamera = !isFrontCamera
            predictor.reset()
            resetHandednessLatch()
            bindCamera()
        }

        // Filipino translation toggle
        binding.btnToggleFilipino.setOnClickListener {
            showFilipino = !showFilipino
            appSettings.showFilipino = showFilipino
            updateFilipinoToggleLabel()
            if (!showFilipino) binding.tvFilipinoResult.visibility = View.GONE
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

        // btnSidebar replaces btnMenu from the original pattern
        binding.btnSidebar.setOnClickListener {
            drawer.openDrawer(GravityCompat.START)
        }

        findViewById<View>(R.id.navMainInterface)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
        }
        findViewById<View>(R.id.navWordBank)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, WordBankActivity::class.java))
        }
        findViewById<View>(R.id.navTranslationHistory)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, TranslationHistoryActivity::class.java))
        }
        findViewById<View>(R.id.navProfile)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            if (isSignedIn) {
                startActivity(Intent(this, ProfileActivity::class.java))
            } else {
                openAuthDialog()
            }
        }
        findViewById<View>(R.id.navNotifications)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            if (isSignedIn) {
                startActivity(Intent(this, NotificationsActivity::class.java))
            } else {
                openAuthDialog()
            }
        }
        findViewById<View>(R.id.navSettings)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        findViewById<View?>(R.id.btnSidebarSignIn)?.setOnClickListener {
            drawer.closeDrawers()
            openAuthDialog()
        }
        refreshSidebarAuthState()
    }

    private fun openAuthDialog() {
        val dialog = AuthDialogFragment()
        dialog.onSignedIn = {
            checkAuthState()
            refreshSidebarAuthState()
            loadFilipinoTranslations()
        }
        dialog.show(supportFragmentManager, "auth")
    }

    private fun refreshSidebarAuthState() {
        val tvUsername = findViewById<TextView?>(R.id.tvSidebarUsername)
        val tvEmail    = findViewById<TextView?>(R.id.tvSidebarEmail)
        val btnSignIn  = findViewById<MaterialButton?>(R.id.btnSidebarSignIn)

        if (isSignedIn) {
            tvUsername?.text      = currentUsername.ifBlank { "User" }
            tvEmail?.text         = currentEmail
            btnSignIn?.isVisible  = false
        } else {
            tvUsername?.text      = "Guest User"
            tvEmail?.text         = "Not signed in"
            btnSignIn?.isVisible  = true
        }
    }

    // ── Camera ────────────────────────────────────────────────────────────────

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            cameraProvider = future.get()
            bindCamera()
        }, ContextCompat.getMainExecutor(this))
    }

    private fun bindCamera() {
        val provider = cameraProvider ?: return

        val preview = Preview.Builder().build().also {
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
            frameCounter++
            // Skip every 2nd frame to reduce processing
            if (frameCounter % 2 == 0) {
                imageProxy.close()
                return@setAnalyzer
            }
            // Process every frame so quick signs keep up. STRATEGY_KEEP_ONLY_LATEST means
            // CameraX drops stale frames if MediaPipe falls behind, so this self-limits to
            // what the device can sustain. (If quick-sign lag returns under sustained load,
            // reinstate a light skip, e.g. `if (frameSkipCounter++ % 3 != 0)`.)
            val bitmap          = imageProxy.toBitmap()
            val rotationDegrees = imageProxy.imageInfo.rotationDegrees
            val prepared        = prepareBitmap(bitmap, rotationDegrees, isFrontCamera)
            landmarker.detectAsync(prepared, SystemClock.elapsedRealtime())
            imageProxy.close()
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
        
        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            if (rotationDegrees != 0) postRotate(rotationDegrees.toFloat())
            // For front camera: DON'T mirror the image going to the model
            // The preview (PreviewView) handles the display mirroring separately
            // if (frontCamera) postScale(-1f, 1f, bitmap.width * scale / 2f, 0f)  // ← REMOVE THIS
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
        refreshSidebarAuthState()
        refreshNotifBadge()
    }

    private fun refreshNotifBadge() {
        if (!session.isLoggedIn) return
        lifecycleScope.launch {
            try {
                val response = ApiClient.get(session.token).getUnreadCount()
                if (response.isSuccessful) {
                    val count = response.body()?.unread ?: 0
                    val badge = findViewById<TextView?>(R.id.tvNotifBadge)
                    if (count > 0) {
                        badge?.text = if (count > 99) "99+" else count.toString()
                        badge?.visibility = View.VISIBLE
                    } else {
                        badge?.visibility = View.GONE
                    }
                }
            } catch (_: Exception) { }
        }
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

    override fun onDestroy() {
        executor.shutdown()
        predictor.close()
        landmarker.close()
        tts?.shutdown()
        super.onDestroy()
    }
}




