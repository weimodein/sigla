package com.example.sigla

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView

/**
 * Minimal word row (icon + label only) used by the category word-list screen
 * and by Word Bank search results — tapping a row opens the full detail sheet.
 */
class SimpleWordAdapter(
    private val words: MutableList<WordBankWord>,
    private val onWordClick: (WordBankWord) -> Unit
) : RecyclerView.Adapter<SimpleWordAdapter.WordViewHolder>() {

    class WordViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val tvWord: TextView = view.findViewById(R.id.tvSimpleWord)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): WordViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_word_simple, parent, false)
        return WordViewHolder(view)
    }

    override fun onBindViewHolder(holder: WordViewHolder, position: Int) {
        val word = words[position]
        holder.tvWord.text = word.label
        holder.itemView.setOnClickListener { onWordClick(word) }
    }

    override fun getItemCount(): Int = words.size

    /**
     * Diffs against the current contents rather than calling notifyDataSetChanged().
     *
     * Word Bank calls this on every debounced keystroke, so a blanket rebind meant
     * re-binding every visible row for what is usually a small change to the tail of
     * the list.
     */
    fun setWords(newWords: List<WordBankWord>) {
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = words.size
            override fun getNewListSize() = newWords.size

            override fun areItemsTheSame(oldPos: Int, newPos: Int): Boolean =
                words[oldPos].id == newWords[newPos].id

            // WordBankWord is a data class, so equality covers every displayed field.
            override fun areContentsTheSame(oldPos: Int, newPos: Int): Boolean =
                words[oldPos] == newWords[newPos]
        })
        words.clear()
        words.addAll(newWords)
        diff.dispatchUpdatesTo(this)
    }
}
