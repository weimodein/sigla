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
import com.example.sigla.databinding.ActivityCollectionBinding
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

private const val TAG             = "CollectionActivity"
private const val TARGET_COUNT    = 300
private const val SEQUENCE_LENGTH = 30
private const val MIN_FRAMES      = 15
private const val COUNTDOWN_F     = 15
private const val COOLDOWN_F      = 20
private const val NO_HAND_F       = 10

private enum class CollectState { WAITING, COUNTDOWN, RECORDING, COOLDOWN, DONE }

class CollectionActivity : AppCompatActivity() {

    private lateinit var binding: ActivityCollectionBinding
    private lateinit var landmarker: HandLandmarkHelper

    private val executor = Executors.newSingleThreadExecutor()
    private var isProcessing = false

    // Config
    private var label       = ""
    private var isMotion    = false
    private var saveDir: File? = null

    // State machine
    private var state         = CollectState.WAITING
    private var count         = 0
    private var countdownTick = 0
    private var cooldownTick  = 0
    private var noHandTick    = 0
    private val seqBuffer     = mutableListOf<FloatArray>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCollectionBinding.inflate(layoutInflater)
        setContentView(binding.root)

        landmarker = HandLandmarkHelper(this)

        // Get config from dialog
        showConfigDialog()

        binding.btnUndo.setOnClickListener { undoLastSample() }
        binding.btnBack.setOnClickListener { finish() }
    }

    // ── Config dialog ─────────────────────────────────────────────────────────

    private fun showConfigDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_collection_config, null)
        val etLabel    = dialogView.findViewById<android.widget.EditText>(R.id.etLabel)
        // etTranslation available but not used in current implementation
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

                saveDir = File(
                    getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS),
                    "sigla_dataset/$label"
                ).also { it.mkdirs() }

                count = saveDir!!.listFiles { f -> f.name.endsWith(".json") }?.size ?: 0

                binding.tvLabel.text    = label
                binding.tvType.text     = if (isMotion) "MOTION" else "STATIC"
                binding.tvType.setTextColor(
                    ContextCompat.getColor(this,
                        if (isMotion) android.R.color.holo_orange_light
                        else android.R.color.holo_green_light))
                updateCountDisplay()

                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED) startCamera()
                else ActivityCompat.requestPermissions(
                    this, arrayOf(Manifest.permission.CAMERA), 200)
            }
            .setNegativeButton("Cancel") { _, _ -> finish() }
            .show()
    }

    // ── Camera ────────────────────────────────────────────────────────────────

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = future.get()
            val preview  = Preview.Builder().build().also {
                it.setSurfaceProvider(binding.cameraPreview.surfaceProvider)
            }
            val analysis = ImageAnalysis.Builder()
                .setTargetRotation(binding.cameraPreview.display.rotation)
                .setTargetResolution(android.util.Size(640, 480))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .build()
            analysis.setAnalyzer(executor) { imageProxy -> processFrame(imageProxy) }
            try {
                provider.unbindAll()
                provider.bindToLifecycle(
                    this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (e: Exception) { Log.e(TAG, "Camera error: ${e.message}") }
        }, ContextCompat.getMainExecutor(this))
    }

    // ── Frame processing ──────────────────────────────────────────────────────

    private fun processFrame(imageProxy: ImageProxy) {
        if (isProcessing || state == CollectState.DONE) {
            imageProxy.close(); return
        }
        isProcessing = true
        try {
            val bitmap  = imageProxy.toBitmap()
            val rotationDegrees = imageProxy.imageInfo.rotationDegrees
            val prepared = prepareBitmap(bitmap, rotationDegrees)
            val result  = landmarker.detect(prepared)
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
        if (count >= TARGET_COUNT) {
            state = CollectState.DONE
            showDoneScreen()
            return
        }

        when (state) {
            CollectState.WAITING -> {
                binding.tvOverlay.text = "Show your hand to begin…"
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
                    val rem = COUNTDOWN_F - countdownTick
                    binding.tvOverlay.text = "Get ready… $rem"
                    if (countdownTick >= COUNTDOWN_F) {
                        state      = CollectState.RECORDING
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
                        saveSample(features, isMotion = false)
                        count++
                        updateCountDisplay()
                        state         = CollectState.COOLDOWN
                        cooldownTick  = 0
                        binding.tvRec.visibility = View.GONE
                    }
                } else {
                    if (handsDetected > 0) {
                        seqBuffer.add(features.copyOf())
                        noHandTick = 0
                        val prog = seqBuffer.size.toFloat() / SEQUENCE_LENGTH
                        binding.progressCapture.progress = (prog * 100).toInt()
                        binding.tvOverlay.text = "${seqBuffer.size}/$SEQUENCE_LENGTH frames"
                        binding.tvOverlay.visibility = View.VISIBLE
                        if (seqBuffer.size >= SEQUENCE_LENGTH) {
                            saveSequence(seqBuffer)
                            count++
                            updateCountDisplay()
                            state         = CollectState.COOLDOWN
                            cooldownTick  = 0
                            seqBuffer.clear()
                            binding.tvRec.visibility    = View.GONE
                            binding.tvOverlay.visibility = View.GONE
                        }
                    } else {
                        noHandTick++
                        if (noHandTick >= NO_HAND_F) {
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
                            binding.tvRec.visibility    = View.GONE
                            binding.tvOverlay.visibility = View.GONE
                        }
                    }
                }
            }

            CollectState.COOLDOWN -> {
                binding.progressCapture.progress = 0
                cooldownTick++
                val rem = COOLDOWN_F - cooldownTick
                binding.tvOverlay.text = "✓ Saved! Next in $rem…"
                binding.tvOverlay.visibility = View.VISIBLE
                if (cooldownTick >= COOLDOWN_F) {
                    state = if (handsDetected > 0) CollectState.COUNTDOWN else CollectState.WAITING
                    binding.tvOverlay.visibility = View.GONE
                }
            }

            CollectState.DONE -> showDoneScreen()
        }

        binding.progressTotal.progress = (count.toFloat() / TARGET_COUNT * 100).toInt()
    }

    // ── Save helpers ──────────────────────────────────────────────────────────

    private fun saveSample(features: FloatArray, isMotion: Boolean) {
        val idx  = count
        val file = File(saveDir, "$idx.json")
        val arr  = JSONArray().apply { features.forEach { put(it) } }
        file.writeText(JSONObject().apply {
            put("type",     if (isMotion) "motion" else "static")
            put("label",    label)
            put("features", arr)
        }.toString())
    }

    private fun saveSequence(buffer: List<FloatArray>) {
        val padded = buffer.toMutableList()
        while (padded.size < SEQUENCE_LENGTH) padded.add(padded.last().copyOf())
        val trimmed = padded.take(SEQUENCE_LENGTH)

        val seqArr = JSONArray()
        for (frame in trimmed) {
            val frameArr = JSONArray().apply { frame.forEach { put(it) } }
            seqArr.put(frameArr)
        }
        val idx  = count
        val file = File(saveDir, "$idx.json")
        file.writeText(JSONObject().apply {
            put("type",     "motion")
            put("label",    label)
            put("sequence", seqArr)
        }.toString())
    }

    private fun undoLastSample() {
        if (count <= 0) return
        count--
        val file = File(saveDir, "$count.json")
        if (file.exists()) file.delete()
        updateCountDisplay()
        Toast.makeText(this, "Deleted sample $count", Toast.LENGTH_SHORT).show()
        state        = CollectState.COOLDOWN
        cooldownTick = 0
    }

    private fun updateCountDisplay() {
        binding.tvCount.text = "$count / $TARGET_COUNT"
    }

    private fun showDoneScreen() {
        binding.overlayDone.visibility = View.VISIBLE
        binding.tvDonePath.text = "Files saved to:\n${saveDir?.absolutePath}\n\n" +
                "Transfer to PC and run:\npython convert_collection.py"
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
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
