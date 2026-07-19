package com.example.sigla

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
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

    fun setWords(newWords: List<WordBankWord>) {
        words.clear()
        words.addAll(newWords)
        notifyDataSetChanged()
    }
}
