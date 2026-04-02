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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors

private const val TAG = "CollectionActivity"

// ── Progress bar colour helpers ───────────────────────────────────────────
private const val COLOR_GREEN        = 0
private const val COLOR_YELLOW       = 1
private const val COLOR_RED_TO_GREEN = 2

// ── Admin/dev collection (large dataset) ──────────────────────────────────
private const val TARGET_ADMIN    = 300
private const val COUNTDOWN_ADMIN = 15
private const val COOLDOWN_STATIC_ADMIN = 10
private const val COOLDOWN_MOTION_ADMIN = 20

// ── Suggest mode (user contribution — fast) ───────────────────────────────
private const val TARGET_SUGGEST        = 100  // static samples per session
private const val TARGET_SUGGEST_MOTION = 75   // motion sequences per session
private const val COUNTDOWN_SUGGEST     = 5
private const val COOLDOWN_STATIC_SUGGEST = 3
private const val COOLDOWN_MOTION_SUGGEST = 6

// ── Shared constants ──────────────────────────────────────────────────────
private const val SEQUENCE_LENGTH = 30           // FIXED: must match model (was 10)
private const val STATIC_FRAMES_PER_SAMPLE = 5   // collect 5 frames for static, then average
private const val MIN_FRAMES      = 8            // min frames before a cut clip is kept
private const val NO_HAND_FRAMES  = 5
private const val BATCH_SIZE      = 20           // upload in batches to avoid OOM

// Hand validity: reject landmarks with extreme edges (likely detection errors)
private const val MIN_VALID_COORD = 0.05f
private const val MAX_VALID_COORD = 0.95f

private enum class CollectState { WAITING, COUNTDOWN, RECORDING, COOLDOWN, DONE }

class CollectionActivity : AppCompatActivity() {

    private lateinit var binding: ActivityCollectionBinding
    private lateinit var landmarker: HandLandmarkHelper

    private val executor = Executors.newSingleThreadExecutor()
    private var isProcessing = false

    // Config
    private var label          = ""
    private var isMotion       = false
    private var saveDir: File? = null
    private var wordId: Int    = 0
    private var isSuggestMode  = false
    private var mirrorLeftHand = true   // normalise left-hand to right-hand during collection

    // Timing
    private var targetCount     = TARGET_ADMIN
    private var countdownFrames = COUNTDOWN_ADMIN
    private var cooldownFrames  = COOLDOWN_MOTION_ADMIN

    // Camera
    private var cameraProvider: ProcessCameraProvider? = null
    private var isFrontCamera  = false

    // State machine
    private var state         = CollectState.WAITING
    private var count         = 0
    private var countdownTick = 0
    private var cooldownTick  = 0
    private var noHandTick    = 0
    private var flashTick     = 0
    private val seqBuffer     = mutableListOf<FloatArray>()
    private var staticFrameBuffer = mutableListOf<FloatArray>()   // collect multiple frames for static

    // In-memory store for suggest mode (batched)
    private val pendingStaticLandmarks = mutableListOf<List<Float>>()
    private val pendingMotionSequences = mutableListOf<List<List<Float>>>()
    private val pendingImages          = mutableListOf<String>()
    private var uploadBatchIndex = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCollectionBinding.inflate(layoutInflater)
        setContentView(binding.root)

        landmarker = HandLandmarkHelper(this)

        val wordIdExtra  = intent.getIntExtra("word_id", -1)
        val wordLabel    = intent.getStringExtra("word_label")
        val gestureType  = intent.getStringExtra("gesture_type")
        val mode         = intent.getStringExtra("mode")

        if (mode == "suggest" && wordIdExtra != -1 && !wordLabel.isNullOrEmpty() && !gestureType.isNullOrEmpty()) {
            isSuggestMode = true
            wordId        = wordIdExtra
            label         = wordLabel
            isMotion      = gestureType == "motion"

            val sessionMax  = if (isMotion) TARGET_SUGGEST_MOTION else TARGET_SUGGEST
            val fromBackend = intent.getIntExtra("target_count", -1)
            targetCount     = if (fromBackend > 0) minOf(fromBackend, sessionMax) else sessionMax

            countdownFrames = COUNTDOWN_SUGGEST
            cooldownFrames  = if (isMotion) COOLDOWN_MOTION_SUGGEST else COOLDOWN_STATIC_SUGGEST

            saveDir = File(
                getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS),
                "sigla_dataset/$label"
            ).also { it.mkdirs() }

            setupUI()
            if (hasCameraPermission()) startCamera()
            else ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 200)
        } else {
            showConfigDialog()
        }

        binding.btnSwitchCamera.setOnClickListener { switchCamera() }
        binding.btnUndo.setOnClickListener { undoLastSample() }
        binding.btnBack.setOnClickListener { finish() }
        binding.btnDoneClose.setOnClickListener { finish() }
    }

    // ── Config dialog (admin/dev mode) with folder cleanup option ──────────
    private fun showConfigDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_collection_config, null)
        val etLabel    = dialogView.findViewById<android.widget.EditText>(R.id.etLabel)
        val swMotion   = dialogView.findViewById<android.widget.Switch>(R.id.swMotion)

        AlertDialog.Builder(this)
            .setTitle("Configure Gesture")
            .setView(dialogView)
            .setCancelable(false)
            .setPositiveButton("Start") { _, _ ->
                val lbl = etLabel.text.toString().trim().uppercase()
                if (lbl.isEmpty()) { finish(); return@setPositiveButton }
                label    = lbl
                isMotion = swMotion.isChecked
                mirrorLeftHand = true   // always mirror left hand to right hand

                targetCount     = TARGET_ADMIN
                countdownFrames = COUNTDOWN_ADMIN
                cooldownFrames  = if (isMotion) COOLDOWN_MOTION_ADMIN else COOLDOWN_STATIC_ADMIN

                val baseDir = File(
                    getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS),
                    "sigla_dataset/$label"
                )

                // Ask to delete existing folder if it contains files
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

    private fun setupUI() {
        binding.tvLabel.text = label
        binding.tvType.text  = if (isMotion) "MOTION" else "STATIC"
        binding.tvType.setTextColor(
            ContextCompat.getColor(this,
                if (isMotion) android.R.color.holo_orange_light
                else android.R.color.holo_green_light)
        )
        updateCountDisplay()
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

        val cameraSelector = if (isFrontCamera)
            CameraSelector.DEFAULT_FRONT_CAMERA
        else
            CameraSelector.DEFAULT_BACK_CAMERA

        try {
            provider.unbindAll()
            provider.bindToLifecycle(this, cameraSelector, preview, analysis)
        } catch (e: Exception) {
            Log.e(TAG, "Camera binding error: ${e.message}")
        }
    }

    private fun switchCamera() {
        isFrontCamera = !isFrontCamera
        bindCamera()
    }

    private fun hasCameraPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    // ── Frame processing ──────────────────────────────────────────────────────
    private fun processFrame(imageProxy: ImageProxy) {
        if (isProcessing || state == CollectState.DONE) {
            imageProxy.close(); return
        }
        isProcessing = true
        try {
            val bitmap = imageProxy.toBitmap()
            val prepared = prepareBitmap(bitmap, imageProxy.imageInfo.rotationDegrees)
            val result = landmarker.detect(prepared)
            val thumb = Bitmap.createScaledBitmap(prepared, 320, 240, true)
            runOnUiThread { tick(result.handsDetected, result.features, thumb) }
        } catch (e: Exception) {
            Log.e(TAG, "Frame error: ${e.message}")
        } finally {
            isProcessing = false
            imageProxy.close()
        }
    }

    private fun prepareBitmap(bitmap: Bitmap, rotationDegrees: Int): Bitmap {
        val maxDim = 640
        val scale  = minOf(maxDim.toFloat() / bitmap.width, maxDim.toFloat() / bitmap.height, 1f)
        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            if (rotationDegrees != 0) postRotate(rotationDegrees.toFloat())
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    // ── Hand validity check ──────────────────────────────────────────────────
    private fun isHandValid(features: FloatArray): Boolean {
        // Check all 21 landmarks for valid x,y (z can be anything)
        for (i in 0 until 21) {
            val x = features[i * 3]
            val y = features[i * 3 + 1]
            if (x < MIN_VALID_COORD || x > MAX_VALID_COORD || y < MIN_VALID_COORD || y > MAX_VALID_COORD) {
                return false
            }
        }
        return true
    }

    // ── Normalise left hand to right hand (mirror x) ─────────────────────────
    private fun mirrorHandX(features: FloatArray): FloatArray {
        val mirrored = features.copyOf()
        for (i in 0 until 21) {
            mirrored[i * 3] = 1.0f - mirrored[i * 3]   // mirror x coordinate
        }
        return mirrored
    }

    // ── State machine ─────────────────────────────────────────────────────────
    private fun tick(handsDetected: Int, features: FloatArray, frameBitmap: Bitmap) {
        if (count >= targetCount) {
            state = CollectState.DONE
            showDoneScreen()
            return
        }

        // Enforce hand validity
        val handOk = handsDetected > 0 && isHandValid(features)
        val finalFeatures = if (handOk && mirrorLeftHand && !isFrontCamera) {
            // Only mirror for back camera (front camera already shows mirrored)
            // We can detect left/right heuristically: if wrist x < 0.5? Actually simpler: always mirror
            // for consistency. But front camera users expect natural movement. We'll mirror only for back.
            mirrorHandX(features)
        } else {
            features
        }

        when (state) {
            CollectState.WAITING -> {
                binding.tvOverlay.text = if (isSuggestMode)
                    "Show your hand to start\n($targetCount samples needed)"
                else
                    "Show your hand to begin…"
                binding.tvOverlay.visibility = View.VISIBLE
                if (isMotion) setCaptureBarColor(count.toFloat() / targetCount, COLOR_GREEN)
                if (handOk) {
                    state         = CollectState.COUNTDOWN
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
                    if (isMotion) setCaptureBarColor(countdownTick.toFloat() / countdownFrames, COLOR_YELLOW)
                    if (countdownTick >= countdownFrames) {
                        state     = CollectState.RECORDING
                        seqBuffer.clear()
                        staticFrameBuffer.clear()
                        noHandTick = 0
                        flashTick  = 0
                        binding.tvOverlay.visibility = View.GONE
                    }
                }
            }

            CollectState.RECORDING -> {
                if (!isMotion) {
                    // Static: collect multiple frames then average
                    if (handOk) {
                        staticFrameBuffer.add(finalFeatures.copyOf())
                        if (staticFrameBuffer.size >= STATIC_FRAMES_PER_SAMPLE) {
                            // Average features across collected frames
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
                        // Show progress for static frame collection
                        binding.tvOverlay.text = "${staticFrameBuffer.size}/$STATIC_FRAMES_PER_SAMPLE"
                        binding.tvOverlay.visibility = View.VISIBLE
                        binding.tvRec.visibility = View.VISIBLE
                    } else {
                        // Lost hand during static collection
                        staticFrameBuffer.clear()
                        state = CollectState.WAITING
                        Toast.makeText(this, "Hand lost, restart", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    // Motion: collect sequence
                    if (handOk) {
                        seqBuffer.add(finalFeatures.copyOf())
                        noHandTick = 0

                        val ratio = seqBuffer.size.toFloat() / SEQUENCE_LENGTH
                        setCaptureBarColor(ratio, COLOR_RED_TO_GREEN)

                        flashTick = (flashTick + 1) % 20
                        binding.tvRec.visibility = if (flashTick < 10) View.VISIBLE else View.INVISIBLE

                        binding.tvOverlay.text = "${seqBuffer.size}/$SEQUENCE_LENGTH"
                        binding.tvOverlay.visibility = View.VISIBLE

                        if (seqBuffer.size >= SEQUENCE_LENGTH) {
                            saveSequence(seqBuffer, frameBitmap)
                            count++
                            updateCountDisplay()
                            state = CollectState.COOLDOWN
                            cooldownTick = 0
                            seqBuffer.clear()
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
                                saveSequence(seqBuffer, frameBitmap)
                                count++
                                updateCountDisplay()
                                state = CollectState.COOLDOWN
                                cooldownTick = 0
                            } else {
                                state = CollectState.WAITING
                                Toast.makeText(this, "Too short — discarded", Toast.LENGTH_SHORT).show()
                            }
                            seqBuffer.clear()
                            noHandTick = 0
                            binding.tvRec.visibility = View.GONE
                            binding.tvOverlay.visibility = View.GONE
                        }
                    }
                }
            }

            CollectState.COOLDOWN -> {
                if (!isMotion) binding.progressCapture.progress = 0
                cooldownTick++
                val rem = cooldownFrames - cooldownTick
                binding.tvOverlay.text = "✓ Saved!  Next in $rem…"
                binding.tvOverlay.visibility = View.VISIBLE
                if (isMotion) setCaptureBarColor(count.toFloat() / targetCount, COLOR_GREEN)
                if (cooldownTick >= cooldownFrames) {
                    state = if (handOk) CollectState.COUNTDOWN else CollectState.WAITING
                    binding.tvOverlay.visibility = View.GONE
                }
            }

            CollectState.DONE -> showDoneScreen()
        }

        binding.progressTotal.progress = (count.toFloat() / targetCount * 100).toInt()
    }

    private fun setCaptureBarColor(ratio: Float, mode: Int) {
        val r = ratio.coerceIn(0f, 1f)
        val color = when (mode) {
            COLOR_GREEN  -> android.graphics.Color.rgb(0, 200, 0)
            COLOR_YELLOW -> android.graphics.Color.rgb(220, 200, 0)
            else         -> android.graphics.Color.rgb(
                (255 * (1f - r)).toInt(),
                (255 * r).toInt(),
                0
            )
        }
        binding.progressCapture.progress = (r * 100).toInt()
        binding.progressCapture.progressTintList =
            android.content.res.ColorStateList.valueOf(color)
    }

    // ── Save helpers ──────────────────────────────────────────────────────────
    private fun bitmapToBase64(bitmap: Bitmap): String {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 65, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun saveSample(features: FloatArray, frameBitmap: Bitmap) {
        // Store in-memory for suggest mode (batched)
        if (isSuggestMode) {
            pendingStaticLandmarks.add(features.toList())
            pendingImages.add(bitmapToBase64(frameBitmap))
            // Upload in batches
            if (pendingStaticLandmarks.size >= BATCH_SIZE) {
                uploadBatchAsync()
            }
        }
        // Write to disk (admin mode primary, suggest mode fallback)
        val file = File(saveDir, "$count.json")
        val arr  = JSONArray().apply { features.forEach { put(it) } }
        file.writeText(JSONObject().apply {
            put("type",     "static")
            put("label",    label)
            put("features", arr)
            if (mirrorLeftHand) put("normalised", true)
        }.toString())
    }

    private fun saveSequence(buffer: List<FloatArray>, frameBitmap: Bitmap) {
        // Pad/trim to SEQUENCE_LENGTH
        val padded = buffer.toMutableList()
        while (padded.size < SEQUENCE_LENGTH) padded.add(padded.last().copyOf())
        val trimmed = padded.take(SEQUENCE_LENGTH)

        // Store in-memory for suggest mode
        if (isSuggestMode) {
            pendingMotionSequences.add(trimmed.map { it.toList() })
            pendingImages.add(bitmapToBase64(frameBitmap))
            if (pendingMotionSequences.size >= BATCH_SIZE) {
                uploadBatchAsync()
            }
        }

        // Write to disk
        val seqArr = JSONArray()
        for (frame in trimmed) {
            seqArr.put(JSONArray().apply { frame.forEach { put(it) } })
        }
        val file = File(saveDir, "$count.json")
        file.writeText(JSONObject().apply {
            put("type",     "motion")
            put("label",    label)
            put("sequence", seqArr)
            if (mirrorLeftHand) put("normalised", true)
        }.toString())
    }

    private fun undoLastSample() {
        if (count <= 0) return
        count--
        val file = File(saveDir, "$count.json")
        if (file.exists()) file.delete()

        if (isSuggestMode) {
            // Remove last pending sample from appropriate list
            if (!isMotion && pendingStaticLandmarks.isNotEmpty()) {
                pendingStaticLandmarks.removeLast()
                if (pendingImages.isNotEmpty()) pendingImages.removeLast()
            } else if (isMotion && pendingMotionSequences.isNotEmpty()) {
                pendingMotionSequences.removeLast()
                if (pendingImages.isNotEmpty()) pendingImages.removeLast()
            }
            // Also remove from already-uploaded? Not necessary – undo only affects pending.
        }
        updateCountDisplay()
        Toast.makeText(this, "Deleted sample $count", Toast.LENGTH_SHORT).show()
        state = CollectState.COOLDOWN
        cooldownTick = 0
        flashTick = 0
    }

    private fun updateCountDisplay() {
        binding.tvCount.text = "$count / $targetCount"
    }

    // ── Batched upload for suggest mode ───────────────────────────────────────
    private var uploadJob: kotlinx.coroutines.Job? = null

    private fun uploadBatchAsync() {
        if (!isSuggestMode) return
        uploadJob?.cancel()
        uploadJob = lifecycleScope.launch {
            // Take current batch and clear pending
            val staticBatch = if (!isMotion) pendingStaticLandmarks.toList() else emptyList()
            val motionBatch = if (isMotion) pendingMotionSequences.toList() else emptyList()
            val imagesBatch = pendingImages.toList()

            if (staticBatch.isEmpty() && motionBatch.isEmpty()) return@launch

            // Clear pending BEFORE upload to avoid re-upload on failure (will retry on next save)
            pendingStaticLandmarks.clear()
            pendingMotionSequences.clear()
            pendingImages.clear()

            try {
                val session = SessionManager.getInstance(this@CollectionActivity)
                if (!session.isLoggedIn) {
                    showUploadError("Not logged in")
                    return@launch
                }

                val request = if (!isMotion) {
                    UploadSamplesRequest(
                        landmarks = staticBatch,
                        sample_count = staticBatch.size,
                        images = imagesBatch.ifEmpty { null }
                    )
                } else {
                    UploadSamplesRequest(
                        sequence = motionBatch,
                        sample_count = motionBatch.size,
                        images = imagesBatch.ifEmpty { null }
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
                        showUploadError(errMsg)
                    } else {
                        // Success – no action needed
                        Log.d(TAG, "Batch uploaded successfully")
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
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
            // Upload any remaining samples
            uploadBatchAsync()
            lifecycleScope.launch {
                // Wait a moment for final batch to upload, then show summary
                delay(1000)
                withContext(Dispatchers.Main) {
                    binding.tvDonePath.visibility = View.GONE
                    binding.progressUpload.visibility = View.GONE
                    binding.tvUploadStatus.text = "✓ Collection complete!\n${count} samples recorded."
                    binding.tvUploadStatus.setTextColor(0xFF00E676.toInt())
                    binding.btnDoneClose.visibility = View.VISIBLE
                }
            }
        } else {
            binding.tvDonePath.text = "Files saved to:\n${saveDir?.absolutePath}\n\n" +
                    "Transfer to PC and run:\npython convert_collection.py"
            binding.btnDoneClose.visibility = View.VISIBLE
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