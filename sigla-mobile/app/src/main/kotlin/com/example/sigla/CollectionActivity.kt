package com.example.sigla

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Bundle
import android.os.Environment
import android.util.Log
import android.view.View
import android.widget.Toast
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
import java.io.File
import java.util.concurrent.Executors

private const val TAG = "CollectionActivity"

// ── Admin/dev collection (large dataset) ──────────────────────────────────
private const val TARGET_ADMIN    = 300
private const val COUNTDOWN_ADMIN = 15
private const val COOLDOWN_STATIC_ADMIN = 10
private const val COOLDOWN_MOTION_ADMIN = 20

// ── Suggest mode (user contribution — fast) ───────────────────────────────
private const val TARGET_SUGGEST    = 30      // 30 static samples or 20 motion sequences
private const val TARGET_SUGGEST_MOTION = 20
private const val COUNTDOWN_SUGGEST = 5       // ~0.17s at 30fps
private const val COOLDOWN_STATIC_SUGGEST = 3 // ~0.1s
private const val COOLDOWN_MOTION_SUGGEST = 6 // ~0.2s

// ── Shared constants ──────────────────────────────────────────────────────
private const val SEQUENCE_LENGTH = 20        // frames per motion sequence (was 30)
private const val MIN_FRAMES      = 8         // min frames to save motion (was 15)
private const val NO_HAND_FRAMES  = 5         // frames with no hand before auto-save (was 10)

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
    private val seqBuffer     = mutableListOf<FloatArray>()

    // In-memory landmark store for suggest mode (sent directly to backend)
    private val collectedLandmarks = mutableListOf<List<Float>>()       // static
    private val collectedSequences = mutableListOf<List<List<Float>>>() // motion

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

            targetCount     = if (isMotion) TARGET_SUGGEST_MOTION else TARGET_SUGGEST
            countdownFrames = COUNTDOWN_SUGGEST
            cooldownFrames  = if (isMotion) COOLDOWN_MOTION_SUGGEST else COOLDOWN_STATIC_SUGGEST

            // Small local dir — used as fallback but primary store is in-memory
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

    // ── Config dialog (admin/dev mode) ────────────────────────────────────────

    private fun showConfigDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_collection_config, null)
        val etLabel    = dialogView.findViewById<android.widget.EditText>(R.id.etLabel)
        val swMotion   = dialogView.findViewById<android.widget.Switch>(R.id.swMotion)

        android.app.AlertDialog.Builder(this)
            .setTitle("Configure Gesture")
            .setView(dialogView)
            .setCancelable(false)
            .setPositiveButton("Start") { _, _ ->
                val lbl = etLabel.text.toString().trim().uppercase()
                if (lbl.isEmpty()) { finish(); return@setPositiveButton }
                label    = lbl
                isMotion = swMotion.isChecked

                targetCount     = TARGET_ADMIN
                countdownFrames = COUNTDOWN_ADMIN
                cooldownFrames  = if (isMotion) COOLDOWN_MOTION_ADMIN else COOLDOWN_STATIC_ADMIN

                saveDir = File(
                    getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS),
                    "sigla_dataset/$label"
                ).also { it.mkdirs() }

                count = saveDir!!.listFiles { f -> f.name.endsWith(".json") }?.size ?: 0

                setupUI()

                if (hasCameraPermission()) startCamera()
                else ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 200)
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
            runOnUiThread { tick(result.handsDetected, result.features) }
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

    // ── State machine ─────────────────────────────────────────────────────────

    private fun tick(handsDetected: Int, features: FloatArray) {
        if (count >= targetCount) {
            state = CollectState.DONE
            showDoneScreen()
            return
        }

        when (state) {
            CollectState.WAITING -> {
                binding.tvOverlay.text = if (isSuggestMode)
                    "Show your hand to start\n($targetCount samples needed)"
                else
                    "Show your hand to begin…"
                binding.tvOverlay.visibility = View.VISIBLE
                if (handsDetected > 0) {
                    state         = CollectState.COUNTDOWN
                    countdownTick = 0
                }
            }

            CollectState.COUNTDOWN -> {
                if (handsDetected == 0) {
                    state = CollectState.WAITING
                } else {
                    countdownTick++
                    val rem = countdownFrames - countdownTick
                    binding.tvOverlay.text = if (rem > 0) "Ready… $rem" else "GO!"
                    if (countdownTick >= countdownFrames) {
                        state = CollectState.RECORDING
                        seqBuffer.clear()
                        noHandTick = 0
                        binding.tvOverlay.visibility = View.GONE
                    }
                }
            }

            CollectState.RECORDING -> {
                binding.tvRec.visibility = View.VISIBLE
                if (!isMotion) {
                    if (handsDetected > 0) {
                        saveSample(features)
                        count++
                        updateCountDisplay()
                        state        = CollectState.COOLDOWN
                        cooldownTick = 0
                        binding.tvRec.visibility = View.GONE
                    }
                } else {
                    if (handsDetected > 0) {
                        seqBuffer.add(features.copyOf())
                        noHandTick = 0
                        binding.progressCapture.progress =
                            (seqBuffer.size.toFloat() / SEQUENCE_LENGTH * 100).toInt()
                        binding.tvOverlay.text = "${seqBuffer.size}/$SEQUENCE_LENGTH"
                        binding.tvOverlay.visibility = View.VISIBLE
                        if (seqBuffer.size >= SEQUENCE_LENGTH) {
                            saveSequence(seqBuffer)
                            count++
                            updateCountDisplay()
                            state        = CollectState.COOLDOWN
                            cooldownTick = 0
                            seqBuffer.clear()
                            binding.tvRec.visibility     = View.GONE
                            binding.tvOverlay.visibility = View.GONE
                        }
                    } else {
                        noHandTick++
                        if (noHandTick >= NO_HAND_FRAMES) {
                            if (seqBuffer.size >= MIN_FRAMES) {
                                saveSequence(seqBuffer)
                                count++
                                updateCountDisplay()
                                state        = CollectState.COOLDOWN
                                cooldownTick = 0
                            } else {
                                state = CollectState.WAITING
                                Toast.makeText(this, "Too short — discarded", Toast.LENGTH_SHORT).show()
                            }
                            seqBuffer.clear()
                            noHandTick = 0
                            binding.tvRec.visibility     = View.GONE
                            binding.tvOverlay.visibility = View.GONE
                        }
                    }
                }
            }

            CollectState.COOLDOWN -> {
                binding.progressCapture.progress = 0
                cooldownTick++
                val rem = cooldownFrames - cooldownTick
                binding.tvOverlay.text = "✓ $count/$targetCount  Next in $rem…"
                binding.tvOverlay.visibility = View.VISIBLE
                if (cooldownTick >= cooldownFrames) {
                    state = if (handsDetected > 0) CollectState.COUNTDOWN else CollectState.WAITING
                    binding.tvOverlay.visibility = View.GONE
                }
            }

            CollectState.DONE -> showDoneScreen()
        }

        binding.progressTotal.progress = (count.toFloat() / targetCount * 100).toInt()
    }

    // ── Save helpers ──────────────────────────────────────────────────────────

    private fun saveSample(features: FloatArray) {
        // Always store in-memory for suggest mode upload
        if (isSuggestMode) {
            collectedLandmarks.add(features.toList())
        }
        // Also write to disk (admin mode primary, suggest mode fallback)
        val file = File(saveDir, "$count.json")
        val arr  = JSONArray().apply { features.forEach { put(it) } }
        file.writeText(JSONObject().apply {
            put("type",     "static")
            put("label",    label)
            put("features", arr)
        }.toString())
    }

    private fun saveSequence(buffer: List<FloatArray>) {
        // Pad/trim to SEQUENCE_LENGTH
        val padded = buffer.toMutableList()
        while (padded.size < SEQUENCE_LENGTH) padded.add(padded.last().copyOf())
        val trimmed = padded.take(SEQUENCE_LENGTH)

        // Store in-memory for suggest mode upload
        if (isSuggestMode) {
            collectedSequences.add(trimmed.map { it.toList() })
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
        }.toString())
    }

    private fun undoLastSample() {
        if (count <= 0) return
        count--
        File(saveDir, "$count.json").also { if (it.exists()) it.delete() }
        if (isSuggestMode) {
            if (!isMotion && collectedLandmarks.isNotEmpty()) collectedLandmarks.removeLast()
            else if (isMotion && collectedSequences.isNotEmpty()) collectedSequences.removeLast()
        }
        updateCountDisplay()
        Toast.makeText(this, "Deleted sample $count", Toast.LENGTH_SHORT).show()
        state        = CollectState.COOLDOWN
        cooldownTick = 0
    }

    private fun updateCountDisplay() {
        binding.tvCount.text = "$count / $targetCount"
    }

    // ── Done screen ───────────────────────────────────────────────────────────

    private fun showDoneScreen() {
        cameraProvider?.unbindAll()
        binding.overlayDone.visibility = View.VISIBLE

        if (isSuggestMode) {
            binding.tvDonePath.visibility    = View.GONE
            binding.progressUpload.visibility = View.VISIBLE
            binding.tvUploadStatus.visibility = View.VISIBLE
            binding.tvUploadStatus.text       = "Uploading samples…"
            uploadSamples()
        } else {
            binding.tvDonePath.text = "Files saved to:\n${saveDir?.absolutePath}\n\n" +
                    "Transfer to PC and run:\npython convert_collection.py"
            binding.btnDoneClose.visibility = View.VISIBLE
        }
    }

    // ── Upload (suggest mode only) ─────────────────────────────────────────────

    private fun uploadSamples() {
        val session = SessionManager.getInstance(this)
        if (!session.isLoggedIn) {
            showUploadError("Not logged in")
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.Main) {
                    binding.progressUpload.isIndeterminate = true
                }

                val request = if (!isMotion) {
                    UploadSamplesRequest(
                        landmarks    = collectedLandmarks,
                        sample_count = collectedLandmarks.size
                    )
                } else {
                    UploadSamplesRequest(
                        sequence     = collectedSequences,
                        sample_count = collectedSequences.size
                    )
                }

                val response = ApiClient.get(session.token).uploadSamples(wordId, request)

                withContext(Dispatchers.Main) {
                    binding.progressUpload.isIndeterminate = false
                    binding.progressUpload.progress = 100

                    if (response.isSuccessful) {
                        val body = response.body()
                        binding.tvUploadStatus.text =
                            "✓ Uploaded ${count} samples successfully!\n${body?.message ?: ""}"
                        binding.tvUploadStatus.setTextColor(0xFF00E676.toInt())
                    } else {
                        val errMsg = try {
                            val json = com.google.gson.JsonParser.parseString(
                                response.errorBody()?.string() ?: ""
                            ).asJsonObject
                            json.get("message")?.asString ?: "Upload failed"
                        } catch (_: Exception) { "Upload failed (${response.code()})" }
                        showUploadError(errMsg)
                    }
                    binding.btnDoneClose.visibility = View.VISIBLE
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    showUploadError("Connection error: ${e.message}")
                    binding.btnDoneClose.visibility = View.VISIBLE
                }
            }
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
        executor.shutdown()
        landmarker.close()
        super.onDestroy()
    }
}
