package com.example.sigla

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.drawerlayout.widget.DrawerLayout
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton

class TranslationHistoryActivity : AppCompatActivity() {

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var rvHistory: RecyclerView
    private lateinit var tvEmpty: TextView
    private lateinit var historyManager: TranslationHistoryManager
    private lateinit var adapter: HistoryAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_translation_history)

        drawerLayout = findViewById(R.id.drawerLayout)
        rvHistory = findViewById(R.id.rvHistory)
        tvEmpty = findViewById(R.id.tvEmpty)
        historyManager = TranslationHistoryManager.getInstance(this)

        // Sidebar
        val sidebar = drawerLayout.getChildAt(1)
        NavigationHelper.setup(this, drawerLayout, sidebar, Screen.HISTORY)
        findViewById<MaterialButton>(R.id.btnMenu).setOnClickListener {
            drawerLayout.openDrawer(sidebar)
        }

        // Clear all
        findViewById<MaterialButton>(R.id.btnClearAll).setOnClickListener {
            AlertDialog.Builder(this)
                .setMessage(getString(R.string.clear_confirm))
                .setPositiveButton("Clear") { _, _ ->
                    historyManager.clearAll()
                    refreshList()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        // RecyclerView
        adapter = HistoryAdapter()
        rvHistory.layoutManager = LinearLayoutManager(this)
        rvHistory.adapter = adapter

        // Swipe to delete
        val swipeHandler = object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT) {
            override fun onMove(rv: RecyclerView, vh: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder) = false
            override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                val pos = viewHolder.adapterPosition
                val item = adapter.getItem(pos)
                if (item is HistoryItem.Entry) {
                    historyManager.deleteAt(item.flatIndex)
                    refreshList()
                } else {
                    adapter.notifyItemChanged(pos) // can't delete headers
                }
            }

            override fun getSwipeDirs(rv: RecyclerView, vh: RecyclerView.ViewHolder): Int {
                // Only allow swiping entry items, not date headers
                return if (adapter.getItem(vh.adapterPosition) is HistoryItem.Entry) {
                    super.getSwipeDirs(rv, vh)
                } else 0
            }
        }
        ItemTouchHelper(swipeHandler).attachToRecyclerView(rvHistory)

        refreshList()
    }

    override fun onResume() {
        super.onResume()
        refreshList()
    }

    private fun refreshList() {
        val grouped = historyManager.getGrouped()
        val items = mutableListOf<HistoryItem>()
        var flatIndex = 0

        for ((date, entries) in grouped) {
            items.add(HistoryItem.Header(date))
            for (entry in entries) {
                items.add(HistoryItem.Entry(entry, flatIndex))
                flatIndex++
            }
        }

        adapter.submitList(items)
        tvEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        rvHistory.visibility = if (items.isNotEmpty()) View.VISIBLE else View.GONE
    }
}

// ── Data types ──────────────────────────────────────────────────────

sealed class HistoryItem {
    data class Header(val date: String) : HistoryItem()
    data class Entry(val entry: TranslationEntry, val flatIndex: Int) : HistoryItem()
}

// ── Adapter ─────────────────────────────────────────────────────────

class HistoryAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private var items = listOf<HistoryItem>()

    fun submitList(list: List<HistoryItem>) {
        items = list
        notifyDataSetChanged()
    }

    fun getItem(position: Int): HistoryItem = items[position]

    override fun getItemViewType(position: Int) = when (items[position]) {
        is HistoryItem.Header -> 0
        is HistoryItem.Entry -> 1
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        return if (viewType == 0) {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_history_header, parent, false)
            HeaderVH(view)
        } else {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_history_entry, parent, false)
            EntryVH(view)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val item = items[position]) {
            is HistoryItem.Header -> (holder as HeaderVH).bind(item)
            is HistoryItem.Entry -> (holder as EntryVH).bind(item)
        }
    }

    override fun getItemCount() = items.size

    class HeaderVH(view: View) : RecyclerView.ViewHolder(view) {
        private val tvDate: TextView = view.findViewById(R.id.tvDateHeader)
        fun bind(item: HistoryItem.Header) {
            tvDate.text = item.date
        }
    }

    class EntryVH(view: View) : RecyclerView.ViewHolder(view) {
        private val tvWord: TextView = view.findViewById(R.id.tvEntryWord)
        private val tvConfidence: TextView = view.findViewById(R.id.tvEntryConfidence)
        private val tvType: TextView = view.findViewById(R.id.tvEntryType)
        private val tvTime: TextView = view.findViewById(R.id.tvEntryTime)

        fun bind(item: HistoryItem.Entry) {
            val e = item.entry
            tvWord.text = e.word
            tvConfidence.text = "${e.confidence}%"
            tvType.text = e.gestureType
            tvTime.text = TranslationHistoryManager.formatTime(e.timestamp)
        }
    }
}
