package com.example.sigla

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
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
import java.util.concurrent.Executors
import kotlinx.coroutines.delay

private const val TAG               = "MainActivity"
private const val CAMERA_PERMISSION = 100

// ── Left-handed support (inference-time handedness canonicalization) ──────────
private const val LEFT_HANDED_SUPPORT_ENABLED = true
private const val MEDIAPIPE_LABELS_INVERTED   = false
private const val HANDEDNESS_MIN_SCORE        = 0.8f
private const val LATCH_NO_HAND_RESET         = 6

// ── Canonical hand-slot ordering ─────────────────────────────────────────────
private const val SLOT_CANONICALIZATION_ENABLED = false
private const val CHIRALITY_RIGHT_IS_NEGATIVE_CROSS = true

class MainActivity : AppCompatActivity() {

    private lateinit var binding   : ActivityMainBinding
    private lateinit var predictor : PredictionService
    private lateinit var landmarker: HandLandmarkHelper

    // Backend-related managers
    private lateinit var session: SessionManager
    private lateinit var historyManager: TranslationHistoryManager
    private lateinit var appSettings: AppSettings

    private val executor      = Executors.newSingleThreadExecutor()
    private var isFrontCamera = false
    private var cameraProvider: ProcessCameraProvider? = null

    private var frameCounter = 0

    // ── Handedness latch ─────────────────────────────────────────────────────
    private var latchedMirrorSlot0: Boolean? = null
    private var latchedMirrorSlot1: Boolean? = null
    private var handVoteMirror0 = 0
    private var handVoteMirror1 = 0
    private var latchNoHandFrames = 0

    private var latchedSwapSlots: Boolean? = null
    private var bestSlotSep = -1f

    // ── TEMP: diagnose ──────────────────────────────────────────────────────
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
        Log.d("MainActivity", "onCreate called")
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Initialize managers
        session = SessionManager.getInstance(this)
        historyManager = TranslationHistoryManager.getInstance(this)
        appSettings = AppSettings.getInstance(this)
        showFilipino = appSettings.showFilipino

        // ★★★ RESTORE CAMERA PREFERENCE ★★★
        isFrontCamera = appSettings.isFrontCamera
        Log.d(TAG, "LOADED isFrontCamera = $isFrontCamera")

        // Check first launch / onboarding
        if (session.isFirstLaunch) {
            session.isFirstLaunch = false
            if (!session.isOnboardingDone) {
                startActivity(Intent(this, OnboardingActivity::class.java))
                overridePendingTransition(0, 0)
                return
            }
        }

        predictor = MainSessionCache.predictor ?: PredictionService(applicationContext).also {
            MainSessionCache.predictor = it
        }
        landmarker = MainSessionCache.landmarker?.also { it.onResult = ::onLandmarkResult }
            ?: HandLandmarkHelper(applicationContext, ::onLandmarkResult).also {
                MainSessionCache.landmarker = it
            }

        if (predictor.isReady) {
            binding.tvStatus.text = "Models loaded"
            binding.tvStatus.setTextColor(ContextCompat.getColor(this, android.R.color.holo_green_dark))
        } else {
            lifecycleScope.launch(Dispatchers.IO) {
                withContext(Dispatchers.Main) {
                    binding.tvStatus.text = "Loading model..."
                    binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_orange_light))
                }

                try {
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

                    withContext(Dispatchers.Main) {
                        binding.tvStatus.text = "Fetching words from database..."
                    }
                    predictor.init()

                    delay(2000)

                    withContext(Dispatchers.Main) {
                        if (predictor.isReady) {
                            binding.tvStatus.text = "Models loaded"
                            binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_green_dark))
                            Log.d("MainActivity", "Model ready with ${predictor.getLabelCount()} classes")
                        } else {
                            binding.tvStatus.text = "Failed to load words from database"
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
        }

        val cachedFilipinoMap = MainSessionCache.filipinoMap
        if (cachedFilipinoMap != null) {
            filipinoMap = cachedFilipinoMap.toMutableMap()
        } else {
            loadFilipinoTranslations()
        }
        setupCallbacks()
        setupButtons()
        setupSidebar()
        updateFilipinoToggleLabel()

        if (hasCameraPermission()) startCamera()
        else requestCameraPermission()

        checkAuthState()
    }

    // ── Backend Initialization ────────────────────────────────────────────────

    private fun onLandmarkResult(result: LandmarkResult) {
        if (result.handsDetected > maxHandsSeenThisGesture) maxHandsSeenThisGesture = result.handsDetected

        val ordered = canonicalizeSlots(result.features, result.handedness, result.handsDetected)
        val features = canonicalizeHandedness(
            ordered, result.handedness, result.handednessScore, result.handsDetected
        )
        predictor.processFrame(features, result.handsDetected)

        runOnUiThread {
            val width = binding.cameraPreview.width.toFloat()
            val height = binding.cameraPreview.height.toFloat()
            binding.overlayView.setLandmarks(
                result.landmarks,
                width,
                height,
                isFrontCamera
            )
        }
    }

    private fun speak(text: String) {
        SpeechHelper.speak(this, text, appSettings, lifecycleScope)
    }

    private fun loadFilipinoTranslations() {
        lifecycleScope.launch(Dispatchers.IO) {
            val words: List<WordBankWord> = try {
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
                MainSessionCache.filipinoMap = map
                words.forEach { word ->
                    if (!word.filipino_translation.isNullOrBlank()) {
                        historyManager.setTranslation(word.label.lowercase(), word.filipino_translation)
                    }
                }
            }
        }
    }

    private fun checkAuthState() {
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
                    session.clearSession()
                }
            }
        }
    }

    // ── Predictor callbacks ───────────────────────────────────────────────────

    private fun setupCallbacks() {
        predictor.onResult = { result ->
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

                speak(result.label)
                historyManager.add(result.label, pct, if (result.isMotion) "motion" else "static")

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

                binding.tvFrames.text = "${state.frames}"

                binding.tvVelocity.text = if (state.isMotion) "● MOTION" else "○ static"
                binding.tvVelocity.setTextColor(
                    ContextCompat.getColor(this,
                        if (state.isMotion) android.R.color.holo_orange_light
                        else android.R.color.darker_gray)
                )

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
            appSettings.isFrontCamera = isFrontCamera
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
            overridePendingTransition(0, 0)   // <-- instant transition
        }

        findViewById<View>(R.id.navTranslationHistory)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, TranslationHistoryActivity::class.java))
            overridePendingTransition(0, 0)
        }

        findViewById<View>(R.id.navSettings)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, SettingsActivity::class.java))
            overridePendingTransition(0, 0)
        }

        findViewById<View>(R.id.navProfile)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            if (isSignedIn) {
                startActivity(Intent(this, ProfileActivity::class.java))
                overridePendingTransition(0, 0)
            } else {
                openAuthDialog()
            }
        }

        findViewById<View>(R.id.navNotifications)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            if (isSignedIn) {
                startActivity(Intent(this, NotificationsActivity::class.java))
                overridePendingTransition(0, 0)
            } else {
                openAuthDialog()
            }
        }

        findViewById<View?>(R.id.btnSidebarSignIn)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            openAuthDialog()
        }

        refreshSidebarAuthState()
    }

    private fun setActiveNavItem(activeId: Int) {
        val navIds = listOf(
            R.id.navMainInterface, R.id.navWordBank, R.id.navTranslationHistory,
            R.id.navNotifications, R.id.navProfile, R.id.navSettings
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

    // Mirror preview for front camera
    binding.cameraPreview.scaleX = if (isFrontCamera) -1f else 1f
    binding.cameraPreview.scaleY = 1f

    val analysis = ImageAnalysis.Builder()
        .setTargetRotation(binding.cameraPreview.display?.rotation ?: android.view.Surface.ROTATION_0)
        .setTargetResolution(android.util.Size(240, 180))
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
        .build()

    analysis.setAnalyzer(executor) { imageProxy ->
        frameCounter++
        if (frameCounter % 2 == 0) {
            imageProxy.close()
            return@setAnalyzer
        }
        val bitmap = imageProxy.toBitmap()
        val rotationDegrees = imageProxy.imageInfo.rotationDegrees
        val prepared = prepareBitmap(bitmap, rotationDegrees, isFrontCamera)
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

    // ── (rest of the helper methods unchanged) ──────────────────────────────

    private fun handCrossZ(features: FloatArray, base: Int): Float {
        val wx = features[base]; val wy = features[base + 1]
        val v1x = features[base + 5 * 3] - wx;  val v1y = features[base + 5 * 3 + 1] - wy
        val v2x = features[base + 17 * 3] - wx; val v2y = features[base + 17 * 3 + 1] - wy
        return v1x * v2y - v1y * v2x
    }

    private fun isRightHand(crossZ: Float): Boolean =
        if (CHIRALITY_RIGHT_IS_NEGATIVE_CROSS) crossZ < 0f else crossZ > 0f

    private fun canonicalizeSlots(
        features: FloatArray,
        handedness: List<String?>,
        handsDetected: Int,
    ): FloatArray {
        if (!SLOT_CANONICALIZATION_ENABLED) return features
        if (handsDetected == 0) return features

        var slot0Present = false
        for (k in 0 until 63) if (features[k] != 0f) { slot0Present = true; break }
        var slot1Present = false
        for (k in 63 until 126) if (features[k] != 0f) { slot1Present = true; break }
        if (!(slot0Present && slot1Present)) return features

        val cz0 = handCrossZ(features, 0)
        val cz1 = handCrossZ(features, 63)

        val sep = kotlin.math.abs(cz0) + kotlin.math.abs(cz1)
        if (sep > bestSlotSep) {
            bestSlotSep = sep
            latchedSwapSlots = (!isRightHand(cz0)) && isRightHand(cz1)
        }
        val swap = latchedSwapSlots ?: false

        Log.d(TAG, "slots cam=${if (isFrontCamera) "front" else "back"} " +
                "cz0=$cz0 cz1=$cz1 sep=$sep best=$bestSlotSep " +
                "mp0=${handedness.getOrNull(0)} mp1=${handedness.getOrNull(1)} swap=$swap")

        if (!swap) return features
        val out = features.copyOf()
        for (k in 0 until 63) { out[k] = features[63 + k]; out[63 + k] = features[k] }
        return out
    }

    private fun canonicalizeHandedness(
        features: FloatArray,
        handedness: List<String?>,
        scores: List<Float>,
        handsDetected: Int,
    ): FloatArray {
        if (!LEFT_HANDED_SUPPORT_ENABLED) {
            return if (isFrontCamera) mirrorHandX(features) else features
        }

        if (handsDetected == 0) {
            latchNoHandFrames++
            if (latchNoHandFrames >= LATCH_NO_HAND_RESET) resetHandednessLatch()
            return features
        }
        latchNoHandFrames = 0

        val out = features.copyOf()
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

        if (presentCount == 1 && lastDecidedSlotMirrored) {
            mirrorPoseBlock(out)
        }
        return out
    }

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
        latchedSwapSlots = null
        bestSlotSep = -1f
    }

    private fun mirrorHandX(features: FloatArray): FloatArray {
        val mirrored = features.copyOf()
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

        if (scale >= 1f && rotationDegrees == 0 && !frontCamera) {
            return bitmap
        }

        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            if (rotationDegrees != 0) postRotate(rotationDegrees.toFloat())
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        Log.d("MainActivity", "onResume called")
        if (!isFinishing) {
            // Give UI a moment to settle before updating badge
            binding.root.postDelayed({
                refreshSidebarAuthState()
                refreshNotifBadge()
            }, 100)
        }
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
        if (!isChangingConfigurations) {
            predictor.close()
            landmarker.close()
            SpeechHelper.stop()
            MainSessionCache.clear()
        }
        super.onDestroy()
    }
}