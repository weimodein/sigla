package com.example.sigla

import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy

/**
 * Word row (thumbnail, word, Filipino translation, favorite star) used by the
 * category word list and by Word Bank search results. Tapping a row opens the
 * word's detail screen. The star only shows favorite state; favoriting stays on
 * the detail screen (spec §5).
 */
class SimpleWordAdapter(
    private val words: MutableList<WordBankWord>,
    private val isFavorite: (Int) -> Boolean,
    private val onWordClick: (WordBankWord) -> Unit,
) : RecyclerView.Adapter<SimpleWordAdapter.WordViewHolder>() {

    class WordViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val thumb: ImageView = view.findViewById(R.id.ivWordThumb)
        val tvWord: TextView = view.findViewById(R.id.tvSimpleWord)
        val tvFilipino: TextView = view.findViewById(R.id.tvWordFilipino)
        val star: ImageView = view.findViewById(R.id.ivWordStar)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): WordViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_word_simple, parent, false)
        return WordViewHolder(view)
    }

    override fun onBindViewHolder(holder: WordViewHolder, position: Int) {
        val word = words[position]
        val context = holder.itemView.context

        holder.tvWord.text = word.label.toTitleCase()
        val filipino = filipinoDisplay(word.filipino_translation.orEmpty())
        holder.tvFilipino.text = filipino
        holder.tvFilipino.visibility = if (filipino.isEmpty()) View.GONE else View.VISIBLE

        // Saved copy first (works offline), then the URL; the hand placeholder when
        // neither exists or loading fails.
        val source: Any? = ModelUpdateManager.getLocalThumb(context, word.id)
            ?: ApiClient.resolveUrl(word.thumbnail_url)
        Glide.with(holder.thumb)
            .load(source)
            .diskCacheStrategy(DiskCacheStrategy.ALL)
            .placeholder(R.drawable.ic_hand_placeholder)
            .error(R.drawable.ic_hand_placeholder)
            .fallback(R.drawable.ic_hand_placeholder)
            .into(holder.thumb)

        val fav = isFavorite(word.id)
        holder.star.setImageResource(if (fav) R.drawable.ic_star_fill else R.drawable.ic_star_line)
        holder.star.imageTintList = ColorStateList.valueOf(
            ContextCompat.getColor(context, if (fav) R.color.sg_brand_text else R.color.sg_text_secondary)
        )
        holder.star.contentDescription = if (fav) "In favorites" else null

        holder.itemView.contentDescription =
            if (filipino.isEmpty()) word.label else "${word.label}, $filipino"
        holder.itemView.setOnClickListener { onWordClick(word) }
    }

    override fun getItemCount(): Int = words.size

    /**
     * Diffs against the current contents rather than calling notifyDataSetChanged().
     * Word Bank calls this on every debounced keystroke.
     */
    fun setWords(newWords: List<WordBankWord>) {
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = words.size
            override fun getNewListSize() = newWords.size
            override fun areItemsTheSame(oldPos: Int, newPos: Int): Boolean =
                words[oldPos].id == newWords[newPos].id
            override fun areContentsTheSame(oldPos: Int, newPos: Int): Boolean =
                words[oldPos] == newWords[newPos]
        })
        words.clear()
        words.addAll(newWords)
        diff.dispatchUpdatesTo(this)
    }

    /** Re-draws the stars after favorites may have changed on the detail screen. */
    fun refreshFavorites() {
        if (words.isNotEmpty()) notifyItemRangeChanged(0, words.size)
    }
}
