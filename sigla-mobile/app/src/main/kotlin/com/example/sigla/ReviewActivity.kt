package com.example.sigla

import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder

class ReviewActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_review)

        val bitmaps = CollectionActivity.reviewBitmaps
        val isMotion = CollectionActivity.reviewIsMotion
        val wordLabel = CollectionActivity.reviewWordLabel
        val sampleCount = bitmaps.size

        // Header
        findViewById<TextView>(R.id.tvReviewWord).text = wordLabel
        findViewById<TextView>(R.id.tvGestureBadge).text = if (isMotion) "MOTION" else "STATIC"
        findViewById<TextView>(R.id.tvSampleCount).text = "$sampleCount sample${if (sampleCount != 1) "s" else ""} captured"

        // Thumbnail grid — 3 columns
        val rv = findViewById<RecyclerView>(R.id.rvThumbnails)
        rv.layoutManager = GridLayoutManager(this, 3)
        rv.adapter = ThumbnailAdapter(bitmaps, isMotion)

        // Retake
        findViewById<MaterialButton>(R.id.btnRetake).setOnClickListener {
            MaterialAlertDialogBuilder(this)
                .setTitle("Retake Samples?")
                .setMessage("Discard all $sampleCount captured sample${if (sampleCount != 1) "s" else ""} and redo the collection?")
                .setPositiveButton("Discard & Retake") { _, _ ->
                    setResult(RESULT_CANCELED)
                    finish()
                }
                .setNegativeButton("Keep") { dialog, _ -> dialog.dismiss() }
                .show()
        }

        // Submit
        findViewById<MaterialButton>(R.id.btnSubmitAll).setOnClickListener {
            setResult(RESULT_OK)
            finish()
        }
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
            // Make each cell square based on column width
            val size = parent.width / 3
            view.layoutParams = ViewGroup.LayoutParams(size, size)
            return VH(view)
        }

        override fun onBindViewHolder(holder: VH, position: Int) {
            holder.image.setImageBitmap(bitmaps[position])
            holder.badge.visibility = if (isMotion) View.VISIBLE else View.GONE
            holder.number.text = "${position + 1}"
        }

        override fun getItemCount() = bitmaps.size
    }
}
