package com.example.sigla

import android.content.Context
import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.card.MaterialCardView

/**
 * Word Bank category cards (spec §4–5): uniform pale cards, with Favorites as the
 * navy highlight. Replaces the old per-category colours (CategoryColorUtil).
 */
class CategoryGridAdapter(
    private val items: MutableList<CategoryGridItem>,
    private val onClick: (CategoryGridItem) -> Unit,
) : RecyclerView.Adapter<CategoryGridAdapter.CardViewHolder>() {

    class CardViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val card: MaterialCardView = view.findViewById(R.id.cardCategory)
        val icon: ImageView = view.findViewById(R.id.ivCategoryIcon)
        val name: TextView = view.findViewById(R.id.tvCategoryName)
        val count: TextView = view.findViewById(R.id.tvCategoryCount)
    }

    /** Colours resolved once per adapter, not per bind. */
    private class Palette(private val context: Context) {
        private fun c(id: Int) = ContextCompat.getColor(context, id)
        val brand = c(R.color.sg_brand)
        val tint = c(R.color.sg_tint)
        val onBrand = c(R.color.sg_on_brand)
        val onBrandSecondary = c(R.color.sg_on_brand_secondary)
        val text = c(R.color.sg_text)
        val textSecondary = c(R.color.sg_text_secondary)
        val brandText = c(R.color.sg_brand_text)
    }

    private var palette: Palette? = null
    private fun palette(context: Context) = palette ?: Palette(context).also { palette = it }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CardViewHolder =
        CardViewHolder(LayoutInflater.from(parent.context).inflate(R.layout.item_category_card, parent, false))

    override fun onBindViewHolder(holder: CardViewHolder, position: Int) {
        val item = items[position]
        val p = palette(holder.itemView.context)

        // Favorites/All Words are literal labels; server categories are title-cased
        // so a long all-caps name doesn't fill the card edge to edge.
        val displayText = if (item.isFavorites || item.isAllWords) item.displayName else item.displayName.toTitleCase()
        // A single word must never wrap (Android would hyphenate it mid-word).
        holder.name.maxLines = if (displayText.contains(' ')) 2 else 1
        holder.name.text = displayText
        holder.count.text = "${item.wordCount} word${if (item.wordCount != 1) "s" else ""}"

        val navy = item.isFavorites
        holder.card.setCardBackgroundColor(if (navy) p.brand else p.tint)
        holder.name.setTextColor(if (navy) p.onBrand else p.text)
        holder.count.setTextColor(if (navy) p.onBrandSecondary else p.textSecondary)
        holder.icon.setImageResource(
            when {
                item.isFavorites -> R.drawable.ic_star_fill
                item.isAllWords -> R.drawable.ic_book_line
                else -> R.drawable.ic_tag_line
            }
        )
        holder.icon.imageTintList = ColorStateList.valueOf(if (navy) p.onBrand else p.brandText)

        holder.card.contentDescription = "$displayText, ${holder.count.text}"
        holder.card.setOnClickListener { onClick(item) }
    }

    override fun getItemCount(): Int = items.size

    fun setItems(newItems: List<CategoryGridItem>) {
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = items.size
            override fun getNewListSize() = newItems.size
            override fun areItemsTheSame(oldPos: Int, newPos: Int): Boolean {
                val a = items[oldPos]
                val b = newItems[newPos]
                return a.isFavorites == b.isFavorites &&
                    a.isAllWords == b.isAllWords &&
                    a.displayName.equals(b.displayName, ignoreCase = true)
            }
            override fun areContentsTheSame(oldPos: Int, newPos: Int): Boolean = items[oldPos] == newItems[newPos]
        })
        items.clear()
        items.addAll(newItems)
        diff.dispatchUpdatesTo(this)
    }
}
