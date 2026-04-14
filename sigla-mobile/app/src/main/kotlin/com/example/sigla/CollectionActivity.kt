package com.example.sigla

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Bundle
import android.os.Environment
import android.util.Base64
import android.util.Log
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.example.sigla.databinding.ActivityCollectionBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors

private const val TAG = "CollectionActivity"

// Default targets (will be overridden by backend if in suggest mode)
private const val TARGET_ADMIN = 300
private const val TARGET_SUGGEST = 100
private const val TARGET_SUGGEST_MOTION = 75

// Timing constants
private const val SEQUENCE_LENGTH = 30
private const val STATIC_FRAMES_PER_SAMPLE = 5
private const val MIN_FRAMES = 8
private const val COUNTDOWN_FRAMES = 15
private const val COOLDOWN_FRAMES = 20
private const val NO_HAND_FRAMES = 10
private const val BATCH_SIZE = 5

private enum class CollectState { WAITING, COUNTDOWN, RECORDING, COOLDOWN, DONE }

class CollectionActivity : AppCompatActivity() {

    private lateinit var binding: ActivityCollectionBinding
    private lateinit var landmarker: HandLandmarkHelper
    private lateinit var session: SessionManager

    private val executor = Executors.newSingleThreadExecutor()
    private var isProcessing = false

    // Camera state
    private var isFrontCamera = false
    private var cameraProvider: ProcessCameraProvider? = null

    // Config
    private var label = ""
    private var isMotion = false
    private var wordId: Int = 0
    private var isSuggestMode = false
    private var mirrorLeftHand = true
    private var saveDir: File? = null

    // Collection targets
    private var targetCount = TARGET_ADMIN
    private var countdownFrames = COUNTDOWN_FRAMES
    private var cooldownFrames = COOLDOWN_FRAMES

    // State machine
    private var state = CollectState.WAITING
    private var count = 0
    private var countdownTick = 0
    private var cooldownTick = 0
    private var noHandTick = 0
    private var flashTick = 0
    private val seqBuffer = mutableListOf<FloatArray>()
    private val seqImageBuffer = mutableListOf<Bitmap>()
    private var staticFrameBuffer = mutableListOf<FloatArray>()

    // In-memory store for suggest mode (batch upload)
    private val pendingStaticLandmarks = mutableListOf<List<Float>>()
    private val pendingMotionSequences = mutableListOf<List<List<Float>>>()
    private val pendingMotionImages = mutableListOf<List<String>>()
    private val pendingStaticImages = mutableListOf<String>()
    private var uploadError: String? = null
    private var uploadJob: kotlinx.coroutines.Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCollectionBinding.inflate(layoutInflater)
        setContentView(binding.root)

        session = SessionManager.getInstance(this)
        landmarker = HandLandmarkHelper(this)

        // Get intent extras for suggest mode
        val wordIdExtra = intent.getIntExtra("word_id", -1)
        val wordLabel = intent.getStringExtra("word_label")
        val gestureType = intent.getStringExtra("gesture_type")
        val mode = intent.getStringExtra("mode")
        val handsCount = intent.getIntExtra("hands_count", 1)
        val targetCountExtra = intent.getIntExtra("target_count", -1)

        if (mode == "suggest" && wordIdExtra != -1 && !wordLabel.isNullOrEmpty() && !gestureType.isNullOrEmpty()) {
            // SUGGEST MODE - Skip config dialog, use data from intent
            isSuggestMode = true
            wordId = wordIdExtra
            label = wordLabel
            isMotion = gestureType == "motion"

            val sessionMax = if (isMotion) TARGET_SUGGEST_MOTION else TARGET_SUGGEST
            targetCount = if (targetCountExtra > 0) minOf(targetCountExtra, sessionMax) else sessionMax

            countdownFrames = 2
            cooldownFrames = if (isMotion) 2 else 1

            saveDir = File(
                getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS),
                "sigla_dataset/$label"
            ).also { it.mkdirs() }

            count = saveDir!!.listFiles { f -> f.name.endsWith(".json") }?.size ?: 0

            setupUI()
            setupButtons()
            if (hasCameraPermission()) startCamera()
            else ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 200)
        } else {
            // ADMIN MODE - Show config dialog
            showConfigDialog()
        }
    }

    private fun setupUI() {
        binding.tvLabel.text = label
        binding.tvType.text = if (isMotion) "MOTION" else "STATIC"
        binding.tvType.setTextColor(
            ContextCompat.getColor(this,
                if (isMotion) android.R.color.holo_orange_light
                else android.R.color.holo_green_light)
        )
        updateCountDisplay()
    }

    private fun setupButtons() {
        binding.btnSwitchCamera.setOnClickListener {
            isFrontCamera = !isFrontCamera
            bindCamera()
        }
        binding.btnCancel.setOnClickListener { finish() }
        binding.btnSubmit.setOnClickListener { finish() }
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }

    // ── Config dialog for admin mode ─────────────────────────────────────────

    private fun showConfigDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_collection_config, null)
        val etLabel = dialogView.findViewById<android.widget.EditText>(R.id.etLabel)
        val swMotion = dialogView.findViewById<android.widget.Switch>(R.id.swMotion)

        AlertDialog.Builder(this)
            .setTitle("Configure Gesture")
            .setView(dialogView)
            .setCancelable(false)
            .setPositiveButton("Start") { _, _ ->
                val lbl = etLabel.text.toString().trim().uppercase()
                if (lbl.isEmpty()) {
                    finish()
                    return@setPositiveButton
                }
                label = lbl
                isMotion = swMotion.isChecked
                mirrorLeftHand = true

                targetCount = TARGET_ADMIN
                countdownFrames = COUNTDOWN_FRAMES
                cooldownFrames = if (isMotion) COOLDOWN_FRAMES else COOLDOWN_FRAMES

                val baseDir = File(
                    getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS),
                    "sigla_dataset/$label"
                )

                if (baseDir.exists() && baseDir.listFiles()?.isNotEmpty() == true) {
                    AlertDialog.Builder(this)
                        .setTitle("Existing data found")
                        .setMessage("Folder for '$label' already contains ${baseDir.listFiles()?.size ?: 0} files. Delete old files?")
                        .setPositiveButton("Delete") { _, _ ->
                            baseDir.deleteRecursively()
                            baseDir.mkdirs()
                            saveDir = baseDir
                            count = 0
                            setupUI()
                            if (hasCameraPermission()) startCamera()
                            else ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 200)
                        }
                        .setNegativeButton("Keep (append)") { _, _ ->
                            saveDir = baseDir
                            count = saveDir!!.listFiles { f -> f.name.endsWith(".json") }?.size ?: 0
                            setupUI()
                            if (hasCameraPermission()) startCamera()
                            else ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 200)
                        }
                        .show()
                } else {
                    baseDir.mkdirs()
                    saveDir = baseDir
                    count = 0
                    setupUI()
                    if (hasCameraPermission()) startCamera()
                    else ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 200)
                }
            }
            .setNegativeButton("Cancel") { _, _ -> finish() }
            .show()
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
            .setTargetResolution(android.util.Size(640, 480))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()

        analysis.setAnalyzer(executor) { imageProxy -> processFrame(imageProxy) }

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

    // ── Frame processing ──────────────────────────────────────────────────────

    private fun processFrame(imageProxy: ImageProxy) {
        if (isProcessing || state == CollectState.DONE) {
            imageProxy.close()
            return
        }
        isProcessing = true
        try {
            val bitmap = imageProxy.toBitmap()
            val rotationDegrees = imageProxy.imageInfo.rotationDegrees
            val prepared = prepareBitmap(bitmap, rotationDegrees, isFrontCamera)
            val result = landmarker.detect(prepared)
            val thumb = Bitmap.createScaledBitmap(prepared, 320, 240, true)
            
            // Mirror features for front camera
            val finalFeatures = if (isFrontCamera) {
                mirrorHandX(result.features)
            } else {
                result.features
            }
            
            runOnUiThread {
                binding.overlayView.setLandmarks(
                    result.landmarks,  // Pass directly, no mirroring
                    binding.cameraPreview.width.toFloat(),
                    binding.cameraPreview.height.toFloat()
                )
                tick(result.handsDetected, finalFeatures, thumb)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Frame error: ${e.message}")
        } finally {
            isProcessing = false
            imageProxy.close()
        }
    }

    private fun prepareBitmap(bitmap: Bitmap, rotationDegrees: Int, frontCamera: Boolean): Bitmap {
        val maxDim = 640
        val scale = minOf(maxDim.toFloat() / bitmap.width, maxDim.toFloat() / bitmap.height, 1f)
        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            if (rotationDegrees != 0) postRotate(rotationDegrees.toFloat())
            if (frontCamera) postScale(-1f, 1f, bitmap.width * scale / 2f, 0f)
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    private fun isHandValid(features: FloatArray, forMotion: Boolean = false): Boolean {
        for (i in 0 until 21) {
            val x = features[i * 3]
            val y = features[i * 3 + 1]
            if (forMotion) {
                if (x < 0f || x > 1f || y < 0f || y > 1f) return false
            } else {
                if (x < 0.05f || x > 0.95f || y < 0.05f || y > 0.95f) return false
            }
        }
        return true
    }

    private fun mirrorHandX(features: FloatArray): FloatArray {
        val mirrored = features.copyOf()
        for (i in 0 until 21) {
            mirrored[i * 3] = 1.0f - mirrored[i * 3]
        }
        return mirrored
    }

    private fun bitmapToBase64(bitmap: Bitmap): String {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 65, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    // ── State machine ─────────────────────────────────────────────────────────

    private fun tick(handsDetected: Int, features: FloatArray, frameBitmap: Bitmap) {
        if (count >= targetCount) {
            state = CollectState.DONE
            showDoneScreen()
            return
        }

        val handOk = handsDetected > 0 && isHandValid(features, isMotion)
        // features are already mirrored for front camera in processFrame() — use as-is
        val finalFeatures = features

        when (state) {
            CollectState.WAITING -> {
                binding.tvOverlay.text = if (isSuggestMode)
                    "Show your hand to start\n($targetCount samples needed)"
                else
                    "Show your hand to begin…"
                binding.tvOverlay.visibility = View.VISIBLE
                if (handOk) {
                    state = CollectState.COUNTDOWN
                    countdownTick = 0
                }
            }

            CollectState.COUNTDOWN -> {
                if (!handOk) {
                    state = CollectState.WAITING
                } else {
                    countdownTick++
                    val rem = countdownFrames - countdownTick
                    binding.tvOverlay.text = if (rem > 0) "Get ready… $rem" else "GO!"
                    if (countdownTick >= countdownFrames) {
                        state = CollectState.RECORDING
                        seqBuffer.clear()
                        seqImageBuffer.clear()
                        staticFrameBuffer.clear()
                        noHandTick = 0
                        flashTick = 0
                        binding.tvOverlay.visibility = View.GONE
                    }
                }
            }

            CollectState.RECORDING -> {
                if (!isMotion) {
                    // STATIC gesture collection
                    if (handOk) {
                        staticFrameBuffer.add(finalFeatures.copyOf())
                        if (staticFrameBuffer.size >= STATIC_FRAMES_PER_SAMPLE) {
                            val avgFeatures = FloatArray(126)
                            for (frame in staticFrameBuffer) {
                                for (i in avgFeatures.indices) {
                                    avgFeatures[i] += frame[i]
                                }
                            }
                            for (i in avgFeatures.indices) {
                                avgFeatures[i] = avgFeatures[i] / staticFrameBuffer.size
                            }
                            saveSample(avgFeatures, frameBitmap)
                            count++
                            updateCountDisplay()
                            state = CollectState.COOLDOWN
                            cooldownTick = 0
                            staticFrameBuffer.clear()
                        }
                        binding.tvOverlay.text = "${staticFrameBuffer.size}/$STATIC_FRAMES_PER_SAMPLE"
                        binding.tvOverlay.visibility = View.VISIBLE
                        binding.tvRec.visibility = View.VISIBLE
                    } else {
                        staticFrameBuffer.clear()
                        state = CollectState.WAITING
                        Toast.makeText(this, "Hand lost, restart", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    // MOTION gesture collection
                    if (handOk) {
                        seqBuffer.add(finalFeatures.copyOf())
                        seqImageBuffer.add(frameBitmap.copy(Bitmap.Config.ARGB_8888, true))
                        noHandTick = 0

                        val ratio = seqBuffer.size.toFloat() / SEQUENCE_LENGTH
                        binding.progressCapture.progress = (ratio * 100).toInt()

                        flashTick = (flashTick + 1) % 20
                        binding.tvRec.visibility = if (flashTick < 10) View.VISIBLE else View.INVISIBLE

                        binding.tvOverlay.text = "${seqBuffer.size}/$SEQUENCE_LENGTH"
                        binding.tvOverlay.visibility = View.VISIBLE

                        if (seqBuffer.size >= SEQUENCE_LENGTH) {
                            saveSequence(seqBuffer, seqImageBuffer)
                            count++
                            updateCountDisplay()
                            state = CollectState.COOLDOWN
                            cooldownTick = 0
                            seqBuffer.clear()
                            seqImageBuffer.clear()
                            binding.tvRec.visibility = View.GONE
                            binding.tvOverlay.visibility = View.GONE
                        }
                    } else {
                        noHandTick++
                        val remaining = NO_HAND_FRAMES - noHandTick
                        if (remaining > 0) {
                            binding.tvOverlay.text = "No hands — stopping in $remaining…"
                            binding.tvOverlay.visibility = View.VISIBLE
                        }
                        if (noHandTick >= NO_HAND_FRAMES) {
                            if (seqBuffer.size >= MIN_FRAMES) {
                                saveSequence(seqBuffer, seqImageBuffer)
                                count++
                                updateCountDisplay()
                                state = CollectState.COOLDOWN
                                cooldownTick = 0
                            } else {
                                state = CollectState.WAITING
                                Toast.makeText(this, "Too short — discarded", Toast.LENGTH_SHORT).show()
                            }
                            seqBuffer.clear()
                            seqImageBuffer.clear()
                            noHandTick = 0
                            binding.tvRec.visibility = View.GONE
                            binding.tvOverlay.visibility = View.GONE
                        }
                    }
                }
            }

            CollectState.COOLDOWN -> {
                binding.progressCapture.progress = 0
                cooldownTick++
                val rem = cooldownFrames - cooldownTick
                binding.tvOverlay.text = "✓ Saved! Next in $rem…"
                binding.tvOverlay.visibility = View.VISIBLE
                if (cooldownTick >= cooldownFrames) {
                    state = if (handOk) CollectState.COUNTDOWN else CollectState.WAITING
                    binding.tvOverlay.visibility = View.GONE
                }
            }

            CollectState.DONE -> showDoneScreen()
        }

        binding.progressTotal.progress = (count.toFloat() / targetCount * 100).toInt()
    }

    // ── Save helpers with backend upload ──────────────────────────────────────

    private fun saveSample(features: FloatArray, frameBitmap: Bitmap) {
        // For suggest mode, batch upload to backend
        if (isSuggestMode) {
            pendingStaticLandmarks.add(features.toList())
            pendingStaticImages.add(bitmapToBase64(frameBitmap))
            if (pendingStaticLandmarks.size >= BATCH_SIZE) {
                uploadBatchAsync()
            }
        }

        // Also save locally
        try {
            if (saveDir == null) {
                Log.e(TAG, "saveDir is null, cannot write static sample")
                return
            }
            val file = File(saveDir, "$count.json")
            val arr = JSONArray().apply { features.forEach { put(it) } }
            file.writeText(JSONObject().apply {
                put("type", "static")
                put("label", label)
                put("features", arr)
                if (mirrorLeftHand) put("normalised", true)
            }.toString())
            Log.d(TAG, "Static sample saved to ${file.absolutePath}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save static sample: ${e.message}", e)
        }
    }

    private fun saveSequence(buffer: List<FloatArray>, frameBitmaps: List<Bitmap>) {
        // Pad/trim to SEQUENCE_LENGTH
        val paddedBuffer = buffer.toMutableList()
        val paddedImages = frameBitmaps.toMutableList()
        while (paddedBuffer.size < SEQUENCE_LENGTH) {
            paddedBuffer.add(paddedBuffer.last().copyOf())
            paddedImages.add(paddedImages.last())
        }
        val trimmedBuffer = paddedBuffer.take(SEQUENCE_LENGTH)
        val trimmedImages = paddedImages.take(SEQUENCE_LENGTH)

        // For suggest mode, batch upload to backend
        if (isSuggestMode) {
            pendingMotionSequences.add(trimmedBuffer.map { it.toList() })
            val frameBase64List = trimmedImages.map { bitmapToBase64(it) }
            pendingMotionImages.add(frameBase64List)
            if (pendingMotionSequences.size >= BATCH_SIZE) {
                uploadBatchAsync()
            }
        }

        // Also save locally
        try {
            if (saveDir == null) {
                Log.e(TAG, "saveDir is null, cannot write motion sample")
                return
            }
            val file = File(saveDir, "$count.json")
            val seqArr = JSONArray()
            for (frame in trimmedBuffer) {
                seqArr.put(JSONArray().apply { frame.forEach { put(it) } })
            }
            file.writeText(JSONObject().apply {
                put("type", "motion")
                put("label", label)
                put("sequence", seqArr)
                if (mirrorLeftHand) put("normalised", true)
            }.toString())
            Log.d(TAG, "Motion sample saved to ${file.absolutePath}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save motion sample: ${e.message}", e)
        }
    }

    private fun updateCountDisplay() {
        binding.tvSessionCount.text = "$count / $targetCount"
    }

    // ── Batched upload to backend ─────────────────────────────────────────────

    private fun uploadBatchAsync() {
        if (!isSuggestMode) return
        uploadJob?.cancel()
        uploadJob = lifecycleScope.launch {
            val staticBatch = if (!isMotion) pendingStaticLandmarks.toList() else emptyList()
            val motionBatch = if (isMotion) pendingMotionSequences.toList() else emptyList()
            val staticImagesBatch = if (!isMotion) pendingStaticImages.toList() else emptyList()
            val motionImagesBatch = if (isMotion) pendingMotionImages.toList() else emptyList()

            if (staticBatch.isEmpty() && motionBatch.isEmpty()) return@launch

            pendingStaticLandmarks.clear()
            pendingMotionSequences.clear()
            pendingStaticImages.clear()
            pendingMotionImages.clear()

            try {
                if (!session.isLoggedIn) {
                    uploadError = "Not logged in"
                    showUploadError(uploadError!!)
                    return@launch
                }

                val request = if (!isMotion) {
                    UploadSamplesRequest(
                        landmarks = staticBatch,
                        sample_count = staticBatch.size,
                        images = staticImagesBatch.ifEmpty { null }
                    )
                } else {
                    UploadSamplesRequest(
                        sequence = motionBatch,
                        sample_count = motionBatch.size,
                        images = motionImagesBatch.ifEmpty { null } as Any?
                    )
                }

                val response = ApiClient.get(session.token).uploadSamples(wordId, request)
                withContext(Dispatchers.Main) {
                    if (!response.isSuccessful) {
                        val errMsg = try {
                            val json = com.google.gson.JsonParser.parseString(
                                response.errorBody()?.string() ?: ""
                            ).asJsonObject
                            json.get("message")?.asString ?: "Upload failed"
                        } catch (_: Exception) { "Upload failed (${response.code()})" }
                        uploadError = errMsg
                        showUploadError(errMsg)
                    } else {
                        uploadError = null
                        Log.d(TAG, "Batch uploaded successfully")
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    uploadError = e.message
                    showUploadError("Connection error: ${e.message}")
                }
            }
        }
    }

    // ── Done screen ───────────────────────────────────────────────────────────

    private fun showDoneScreen() {
        cameraProvider?.unbindAll()
        binding.overlayDone.visibility = View.VISIBLE

        if (isSuggestMode) {
            binding.tvUploadStatus.visibility = View.VISIBLE
            binding.tvUploadStatus.text = "Uploading samples... Please wait."
            binding.progressUpload.visibility = View.VISIBLE

            lifecycleScope.launch {
                uploadJob?.join()
                uploadBatchAsync()
                uploadJob?.join()

                withContext(Dispatchers.Main) {
                    binding.progressUpload.visibility = View.GONE
                    if (uploadError != null) {
                        binding.tvUploadStatus.text = "⚠ Upload failed: $uploadError\nSamples saved locally."
                        binding.tvUploadStatus.setTextColor(0xFFFF5252.toInt())
                        binding.tvDonePath.text = "Local backup: ${saveDir?.absolutePath}"
                        binding.tvDonePath.visibility = View.VISIBLE
                    } else {
                        binding.tvUploadStatus.text = "✓ Collection complete!\n${count} samples recorded."
                        binding.tvUploadStatus.setTextColor(0xFF00E676.toInt())
                    }
                    binding.btnSubmit.visibility = View.VISIBLE
                }
            }
        } else {
            binding.tvDonePath.text = "Files saved to:\n${saveDir?.absolutePath}\n\nTransfer to PC and run:\npython convert_collection.py"
            binding.btnSubmit.visibility = View.VISIBLE
        }
    }

    private fun showUploadError(msg: String) {
        binding.progressUpload.visibility = View.GONE
        binding.tvUploadStatus.text = "⚠ $msg\n\nSamples are saved locally."
        binding.tvUploadStatus.setTextColor(0xFFFF5252.toInt())
        binding.tvDonePath.text = "Local backup: ${saveDir?.absolutePath}"
        binding.tvDonePath.visibility = View.VISIBLE
    }

    // ── Permissions ───────────────────────────────────────────────────────────

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 200 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED)
            startCamera()
    }

    override fun onDestroy() {
        uploadJob?.cancel()
        executor.shutdown()
        landmarker.close()
        super.onDestroy()
    }
}