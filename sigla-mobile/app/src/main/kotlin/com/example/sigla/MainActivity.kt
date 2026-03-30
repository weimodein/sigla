package com.example.sigla

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.AudioManager
import android.os.Bundle
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.view.MotionEvent
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.example.sigla.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import java.util.concurrent.Executors
import retrofit2.Response

private const val TAG               = "MainActivity"
private const val CAMERA_PERMISSION = 100

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var predictor: PredictionService
    private lateinit var landmarker: HandLandmarkHelper
    private lateinit var session: SessionManager
    private lateinit var historyManager: TranslationHistoryManager
    private lateinit var appSettings: AppSettings
    private var tts: TextToSpeech? = null
    private var isTtsReady = false

    private val executor      = Executors.newSingleThreadExecutor()
    private var isFrontCamera = false
    private var cameraProvider: ProcessCameraProvider? = null
    private var showFilipino  = true
    private var emergencyHoldStart = 0L
    private var filipinoMap = mutableMapOf<String, String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        session        = SessionManager.getInstance(this)
        historyManager = TranslationHistoryManager.getInstance(this)
        appSettings    = AppSettings.getInstance(this)
        showFilipino   = appSettings.showFilipino

        initTts()

        predictor = PredictionService(this)
        landmarker = HandLandmarkHelper(this) { result ->
            predictor.processFrame(result.features, result.handsDetected)
            runOnUiThread {
                binding.overlayView.setLandmarks(
                    result.landmarks,
                    binding.cameraPreview.width.toFloat(),
                    binding.cameraPreview.height.toFloat()
                )
            }
        }

        lifecycleScope.launch(Dispatchers.IO) {
            predictor.init()
            withContext(Dispatchers.Main) {
                binding.tvStatus.text = if (predictor.isReady)
                    getString(R.string.models_ready)
                else "⚠ Model files missing"
            }
        }

        setupCallbacks()
        setupButtons()
        setupDrawer()
        updateFilipinoToggleLabel()
        loadFilipinoTranslations()

        if (hasCameraPermission()) startCamera()
        else requestCameraPermission()

        // Check first launch / onboarding
        if (session.isFirstLaunch) {
            session.isFirstLaunch = false
            if (!session.isOnboardingDone) {
                startActivity(Intent(this, OnboardingActivity::class.java))
            }
        }
    }

    // ── TTS ──────────────────────────────────────────────────────────────────

    private fun initTts() {
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.ENGLISH
                isTtsReady = true
            }
        }
    }

    private fun speak(text: String) {
        if (!isTtsReady) return
        val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
        val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val targetVol = (appSettings.volume / 100.0 * maxVol).toInt()
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, targetVol, 0)
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, null)
    }

    // ── Callbacks ─────────────────────────────────────────────────────────────

    private fun setupCallbacks() {
        predictor.onResult = { result ->
            runOnUiThread {
                val pct = (result.confidence * 100).toInt()
                val tag = if (result.isMotion) "MOTION" else "STATIC"
                val ee  = if (result.earlyExit) " ⚡" else ""

                binding.tvResult.text     = result.label.uppercase()
                binding.tvConfidence.text = "$pct%  [$tag]$ee"
                binding.tvResult.textSize = appSettings.textSize.toFloat()
                binding.cardResult.visibility = View.VISIBLE
                binding.progressBuffer.progress = 0

                // Filipino translation
                val filipino = filipinoMap[result.label.lowercase()]
                if (filipino != null && showFilipino) {
                    binding.tvFilipinoResult.text = filipino
                    binding.tvFilipinoResult.visibility = View.VISIBLE
                } else {
                    binding.tvFilipinoResult.visibility = View.GONE
                }

                // Text-to-speech
                speak(result.label)

                // Save to history
                historyManager.add(result.label, pct, if (result.isMotion) "motion" else "static")

                binding.cardResult.postDelayed(
                    { binding.cardResult.visibility = View.INVISIBLE }, 2000)
            }
        }

        predictor.onCollecting = { state ->
            runOnUiThread {
                binding.progressBuffer.progress = (state.progress * 100).toInt()
                binding.tvFrames.text = "Frames: ${state.frames}"
                binding.tvVelocity.text = if (state.isMotion) "● MOTION" else "○ static"
                binding.tvVelocity.setTextColor(
                    ContextCompat.getColor(this,
                        if (state.isMotion) android.R.color.holo_orange_light
                        else android.R.color.darker_gray))
                if (state.streak > 0) {
                    binding.tvStreak.text = "Early-exit: ${state.streak}/5"
                    binding.tvStreak.visibility = View.VISIBLE
                } else {
                    binding.tvStreak.visibility = View.GONE
                }
            }
        }

        predictor.onNoHands = {
            runOnUiThread {
                binding.tvFrames.text = "Detecting…"
                binding.tvVelocity.text = ""
                binding.tvStreak.visibility = View.GONE
                binding.progressBuffer.progress = 0
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
            bindCamera()
        }

        // Filipino toggle
        binding.btnToggleFilipino.setOnClickListener {
            showFilipino = !showFilipino
            appSettings.showFilipino = showFilipino
            updateFilipinoToggleLabel()
            if (!showFilipino) binding.tvFilipinoResult.visibility = View.GONE
        }

        // Emergency button — hold 2 seconds
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
        Toast.makeText(this, "Emergency alert played", Toast.LENGTH_SHORT).show()
    }

    private fun updateFilipinoToggleLabel() {
        binding.btnToggleFilipino.text =
            if (showFilipino) "Hide Filipino" else "Show Filipino"
    }

    // ── Filipino translations (loaded from API) ────────────────────────────────

    private fun loadFilipinoTranslations() {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val response: Response<WordBankResponse> =
                    ApiClient.get(session.token).getWordBank()

                if (response.isSuccessful) {
                    val body: WordBankResponse? = response.body()
                    val words: List<WordBankWord> = body?.words ?: emptyList()

                    val map = mutableMapOf<String, String>()

                    for (word: WordBankWord in words) {
                        val translation: String? = word.filipino_translation
                        if (!translation.isNullOrBlank()) {
                            map[word.label.lowercase()] = translation
                        }
                    }

                    withContext(Dispatchers.Main) {
                        filipinoMap = map
                    }
                }

            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    // ── Drawer ────────────────────────────────────────────────────────────────

    private fun setupDrawer() {
        // The sidebar view is the include'd LinearLayout which is the second child of DrawerLayout
        val sidebar = binding.drawerLayout.getChildAt(1)
        NavigationHelper.setup(this, binding.drawerLayout, sidebar, Screen.MAIN)

        // Hamburger opens drawer
        binding.btnMenu.setOnClickListener {
            binding.drawerLayout.openDrawer(sidebar)
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

        val analysis = ImageAnalysis.Builder()
            .setTargetRotation(binding.cameraPreview.display.rotation)
            .setTargetResolution(android.util.Size(320, 240))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()

        analysis.setAnalyzer(executor) { imageProxy ->
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
            android.util.Log.e(TAG, "Camera bind failed: ${e.message}")
        }
    }

    private fun prepareBitmap(bitmap: Bitmap, rotationDegrees: Int, frontCamera: Boolean): Bitmap {
        val maxDim = 640
        val scale  = minOf(maxDim.toFloat() / bitmap.width, maxDim.toFloat() / bitmap.height, 1f)
        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            if (rotationDegrees != 0) postRotate(rotationDegrees.toFloat())
            if (frontCamera) postScale(-1f, 1f, bitmap.width * scale / 2f, 0f)
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    // ── Permissions ───────────────────────────────────────────────────────────

    private fun hasCameraPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED

    private fun requestCameraPermission() =
        ActivityCompat.requestPermissions(this,
            arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION)

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION &&
            grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            Toast.makeText(this, "Camera permission required", Toast.LENGTH_LONG).show()
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
