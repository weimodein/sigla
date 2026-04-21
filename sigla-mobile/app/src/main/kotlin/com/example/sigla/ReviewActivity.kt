package com.example.sigla

import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.Response

class ReviewActivity : AppCompatActivity() {

    private lateinit var btnRetake: MaterialButton
    private lateinit var btnSubmitAll: MaterialButton
    private lateinit var progressUpload: ProgressBar
    private lateinit var tvUploadStatus: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_review)

        val bitmaps   = CollectionActivity.reviewBitmaps
        val isMotion  = CollectionActivity.reviewIsMotion
        val wordLabel = CollectionActivity.reviewWordLabel
        val count     = bitmaps.size

        btnRetake     = findViewById(R.id.btnRetake)
        btnSubmitAll  = findViewById(R.id.btnSubmitAll)
        progressUpload = findViewById(R.id.progressUpload)
        tvUploadStatus = findViewById(R.id.tvUploadStatus)

        // Header
        findViewById<TextView>(R.id.tvReviewWord).text = wordLabel
        findViewById<TextView>(R.id.tvGestureBadge).text = if (isMotion) "MOTION" else "STATIC"
        findViewById<TextView>(R.id.tvSampleCount).text =
            "$count sample${if (count != 1) "s" else ""} captured"

        // Thumbnail grid — 3 columns
        val rv = findViewById<RecyclerView>(R.id.rvThumbnails)
        rv.layoutManager = GridLayoutManager(this, 3)
        rv.adapter = ThumbnailAdapter(bitmaps, isMotion)

        // Retake
        btnRetake.setOnClickListener {
            MaterialAlertDialogBuilder(this)
                .setTitle("Retake Samples?")
                .setMessage(
                    "Discard all $count captured sample${if (count != 1) "s" else ""} " +
                    "and redo the collection?"
                )
                .setPositiveButton("Discard & Retake") { _, _ ->
                    setResult(RESULT_CANCELED)
                    finish()
                }
                .setNegativeButton("Keep") { dialog, _ -> dialog.dismiss() }
                .show()
        }

        // Submit — upload first, close only when done
        btnSubmitAll.setOnClickListener { startUpload() }
    }

    // ── Upload ────────────────────────────────────────────────────────────────

    private fun startUpload() {
        val token = CollectionActivity.uploadToken ?: run {
            showError("Not logged in")
            return
        }
        val isMotion = CollectionActivity.reviewIsMotion

        // Lock UI while uploading
        btnSubmitAll.isEnabled = false
        btnRetake.isEnabled    = false
        btnSubmitAll.text      = "Uploading…"
        progressUpload.visibility = View.VISIBLE
        tvUploadStatus.visibility = View.GONE

        lifecycleScope.launch {
            try {
                // Step 1: Create the word in the database (deferred from SuggestWordActivity)
                val wordResp = ApiClient.get(token).submitWord(
                    SubmitWordRequest(
                        label = CollectionActivity.reviewWordLabel,
                        description = CollectionActivity.uploadDescription,
                        hands_count = CollectionActivity.uploadHandsCount,
                        gesture_type = CollectionActivity.uploadGestureType
                    )
                )
                if (!wordResp.isSuccessful) {
                    withContext(Dispatchers.Main) {
                        progressUpload.visibility = View.GONE
                        showError(parseError(wordResp))
                    }
                    return@launch
                }
                val wordId = wordResp.body()?.word_id ?: wordResp.body()?.word?.id ?: 0

                // Step 2: Upload the collected samples
                val request = if (!isMotion) {
                    UploadSamplesRequest(
                        landmarks    = CollectionActivity.uploadStaticLandmarks,
                        sample_count = CollectionActivity.uploadStaticLandmarks.size,
                        images       = CollectionActivity.uploadStaticImages.ifEmpty { null }
                    )
                } else {
                    UploadSamplesRequest(
                        sequence     = CollectionActivity.uploadMotionSequences,
                        sample_count = CollectionActivity.uploadMotionSequences.size,
                        images       = CollectionActivity.uploadMotionImages
                            .ifEmpty { null } as Any?
                    )
                }

                val response = ApiClient.get(token).uploadSamples(wordId, request)

                withContext(Dispatchers.Main) {
                    progressUpload.visibility = View.GONE
                    if (response.isSuccessful) {
                        setResult(RESULT_OK)
                        finish()
                    } else {
                        showError(parseError(response))
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    progressUpload.visibility = View.GONE
                    showError("Connection error: ${e.message}")
                }
            }
        }
    }

    private fun parseError(response: retrofit2.Response<*>): String {
        return try {
            val json = com.google.gson.JsonParser.parseString(
                response.errorBody()?.string() ?: ""
            ).asJsonObject
            json.get("message")?.asString ?: "Request failed (${response.code()})"
        } catch (_: Exception) { "Request failed (${response.code()})" }
    }

    private fun showError(msg: String) {
        tvUploadStatus.text      = "⚠ $msg"
        tvUploadStatus.setTextColor(0xFFFF5252.toInt())
        tvUploadStatus.visibility = View.VISIBLE
        btnSubmitAll.isEnabled   = true
        btnRetake.isEnabled      = true
        btnSubmitAll.text        = "Retry Upload"
    }

    // ── Thumbnail RecyclerView adapter ────────────────────────────────────────

    private inner class ThumbnailAdapter(
        private val bitmaps: List<Bitmap>,
        private val isMotion: Boolean,
    ) : RecyclerView.Adapter<ThumbnailAdapter.VH>() {

        inner class VH(itemView: View) : RecyclerView.ViewHolder(itemView) {
            val image: ImageView = itemView.findViewById(R.id.ivThumbnail)
            val badge: ImageView = itemView.findViewById(R.id.ivMotionBadge)
            val number: TextView = itemView.findViewById(R.id.tvSampleNumber)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val view = layoutInflater.inflate(R.layout.item_sample_thumbnail, parent, false)
            val size = parent.width / 3
            view.layoutParams = ViewGroup.LayoutParams(size, size)
            return VH(view)
        }

        override fun onBindViewHolder(holder: VH, position: Int) {
            holder.image.setImageBitmap(bitmaps[position])
            holder.badge.visibility  = if (isMotion) View.VISIBLE else View.GONE
            holder.number.text       = "${position + 1}"
        }

        override fun getItemCount() = bitmaps.size
    }
}
