package com.example.sigla

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.card.MaterialCardView

class CategoryGridAdapter(
    private val items: MutableList<CategoryGridItem>,
    private val onClick: (CategoryGridItem) -> Unit
) : RecyclerView.Adapter<CategoryGridAdapter.CardViewHolder>() {

    class CardViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val card: MaterialCardView = view.findViewById(R.id.cardCategory)
        val iconChip: MaterialCardView = view.findViewById(R.id.cardIconChip)
        val icon: ImageView = view.findViewById(R.id.ivCategoryIcon)
        val name: TextView = view.findViewById(R.id.tvCategoryName)
        val count: TextView = view.findViewById(R.id.tvCategoryCount)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CardViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_category_card, parent, false)
        return CardViewHolder(view)
    }

    /**
     * Theme-dependent values, resolved once per adapter rather than per bind.
     *
     * Every one of these was a Resources lookup inside onBindViewHolder, plus a
     * ColorStateList allocation for the icon tint — up to six lookups for every row,
     * on every rebind. The adapter is recreated when the screen is, so these cannot
     * outlive a theme change.
     */
    private class Palette(context: android.content.Context) {
        val isDarkMode  = CategoryColorUtil.isNightMode(context)
        val favIcon     = ContextCompat.getColor(context, R.color.sig_favtile_icon)
        val favBadge    = ContextCompat.getColor(context, R.color.sig_favtile_badge)
        val surfaceCard = ContextCompat.getColor(context, R.color.sig_surface_card)
        val accentPill  = ContextCompat.getColor(context, R.color.sig_accent_pill)
        val textPrimary = ContextCompat.getColor(context, R.color.sig_text_primary)
        val textSecond  = ContextCompat.getColor(context, R.color.sig_text_secondary)
        val favIconTint: android.content.res.ColorStateList =
            android.content.res.ColorStateList.valueOf(favIcon)
        val whiteTint: android.content.res.ColorStateList =
            android.content.res.ColorStateList.valueOf(WHITE)
    }

    private var palette: Palette? = null

    private fun palette(context: android.content.Context): Palette =
        palette ?: Palette(context).also { palette = it }

    override fun onBindViewHolder(holder: CardViewHolder, position: Int) {
        val item = items[position]
        val p = palette(holder.itemView.context)

        holder.name.text = item.displayName.capitalizeFirst()
        holder.count.text = "${item.wordCount} Word${if (item.wordCount != 1) "s" else ""}"

        when {
            item.isFavorites -> {
                holder.icon.setImageResource(android.R.drawable.btn_star_big_on)
                holder.icon.imageTintList = p.favIconTint
                holder.iconChip.setCardBackgroundColor(p.favBadge)
                holder.card.setCardBackgroundColor(p.surfaceCard)
                holder.name.setTextColor(p.textPrimary)
                holder.count.setTextColor(p.textSecond)
            }
            item.isAllWords -> {
                holder.icon.setImageResource(android.R.drawable.ic_menu_agenda)
                holder.icon.imageTintList = p.favIconTint
                holder.iconChip.setCardBackgroundColor(p.favBadge)
                holder.card.setCardBackgroundColor(p.accentPill)
                holder.name.setTextColor(p.textPrimary)
                holder.count.setTextColor(p.textSecond)
            }
            else -> {
                holder.icon.setImageResource(android.R.drawable.ic_menu_agenda)
                holder.icon.imageTintList = p.whiteTint
                holder.iconChip.setCardBackgroundColor(CHIP_SCRIM)
                holder.card.setCardBackgroundColor(CategoryColorUtil.colorFor(item.displayName, p.isDarkMode))
                holder.name.setTextColor(WHITE)
                holder.count.setTextColor(WHITE_70)
            }
        }

        holder.card.setOnClickListener { onClick(item) }
    }

    override fun getItemCount(): Int = items.size

    /**
     * Diffs against the current contents rather than calling notifyDataSetChanged().
     *
     * This is driven by onResume and by every category-filter change, and each bind
     * re-tints six views — so a blanket rebind was both expensive and visibly flickery.
     */
    fun setItems(newItems: List<CategoryGridItem>) {
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = items.size
            override fun getNewListSize() = newItems.size

            // Identity is the tile's role, not its contents: the two pinned tiles are
            // distinguished by their flags, and category tiles by name. wordCount is
            // deliberately excluded so a changed count animates as an update.
            override fun areItemsTheSame(oldPos: Int, newPos: Int): Boolean {
                val a = items[oldPos]
                val b = newItems[newPos]
                return a.isFavorites == b.isFavorites &&
                       a.isAllWords == b.isAllWords &&
                       a.displayName.equals(b.displayName, ignoreCase = true)
            }

            // CategoryGridItem is a data class, so this covers wordCount and dbCategory.
            override fun areContentsTheSame(oldPos: Int, newPos: Int): Boolean =
                items[oldPos] == newItems[newPos]
        })
        items.clear()
        items.addAll(newItems)
        diff.dispatchUpdatesTo(this)
    }

    private companion object {
        const val WHITE      = 0xFFFFFFFF.toInt()
        const val WHITE_70   = 0xB3FFFFFF.toInt()
        const val CHIP_SCRIM = 0x33FFFFFF
    }
}