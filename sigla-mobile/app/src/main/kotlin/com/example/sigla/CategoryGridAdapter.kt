package com.example.sigla

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
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

    override fun onBindViewHolder(holder: CardViewHolder, position: Int) {
        val item = items[position]
        val context = holder.itemView.context
        val isDarkMode = CategoryColorUtil.isNightMode(context)

        holder.name.text = item.displayName.capitalizeFirst()
        holder.count.text = "${item.wordCount} Word${if (item.wordCount != 1) "s" else ""}"

        when {
            item.isFavorites -> {
                val iconColor = ContextCompat.getColor(context, R.color.sig_favtile_icon)
                holder.icon.setImageResource(android.R.drawable.btn_star_big_on)
                holder.icon.imageTintList = android.content.res.ColorStateList.valueOf(iconColor)
                holder.iconChip.setCardBackgroundColor(ContextCompat.getColor(context, R.color.sig_favtile_badge))
                holder.card.setCardBackgroundColor(ContextCompat.getColor(context, R.color.sig_surface_card))
                holder.name.setTextColor(ContextCompat.getColor(context, R.color.sig_text_primary))
                holder.count.setTextColor(ContextCompat.getColor(context, R.color.sig_text_secondary))
            }
            item.isAllWords -> {
                val iconColor = ContextCompat.getColor(context, R.color.sig_favtile_icon)
                holder.icon.setImageResource(android.R.drawable.ic_menu_agenda)
                holder.icon.imageTintList = android.content.res.ColorStateList.valueOf(iconColor)
                holder.iconChip.setCardBackgroundColor(ContextCompat.getColor(context, R.color.sig_favtile_badge))
                holder.card.setCardBackgroundColor(ContextCompat.getColor(context, R.color.sig_accent_pill))
                holder.name.setTextColor(ContextCompat.getColor(context, R.color.sig_text_primary))
                holder.count.setTextColor(ContextCompat.getColor(context, R.color.sig_text_secondary))
            }
            else -> {
                holder.icon.setImageResource(android.R.drawable.ic_menu_agenda)
                holder.icon.imageTintList = android.content.res.ColorStateList.valueOf(0xFFFFFFFF.toInt())
                holder.iconChip.setCardBackgroundColor(0x33FFFFFF)
                holder.card.setCardBackgroundColor(CategoryColorUtil.colorFor(item.displayName, isDarkMode))
                holder.name.setTextColor(0xFFFFFFFF.toInt())
                holder.count.setTextColor(0xB3FFFFFF.toInt())
            }
        }

        holder.card.setOnClickListener { onClick(item) }
    }

    override fun getItemCount(): Int = items.size

    fun setItems(newItems: List<CategoryGridItem>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }
}