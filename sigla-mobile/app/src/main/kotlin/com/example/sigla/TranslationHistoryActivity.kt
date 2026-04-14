package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.drawerlayout.widget.DrawerLayout
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton


class TranslationHistoryActivity : AppCompatActivity() {

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var session: SessionManager
    private lateinit var btnSidebar: MaterialButton
    private lateinit var btnClearAll: MaterialButton
    private lateinit var rvHistory: RecyclerView
    private lateinit var emptyState: View
    private lateinit var tvEntryCount: TextView
    private lateinit var adapter: HistoryAdapter
    private lateinit var historyManager: TranslationHistoryManager

    companion object {
        const val MAX_ENTRIES = 200
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_translation_history)

        session = SessionManager.getInstance(this)  // ← ADD THIS
        drawerLayout = findViewById(R.id.drawerLayout)  // ← ADD THIS

        historyManager = TranslationHistoryManager.getInstance(this)

        bindViews()
        setupTopBar()
        setupSidebar()
        setupRecyclerView()
        setupSwipeToDelete()
        refreshList()
        wireListeners()
    }

    override fun onResume() {
        super.onResume()
        refreshSidebarAuthState()
    }
    // ── Resume Sidebar ─────────────────────────────────────────────────────────────────
    private fun refreshSidebarAuthState() {
        val sidebar = drawerLayout.getChildAt(1)
        val tvUsername = sidebar.findViewById<TextView>(R.id.tvSidebarUsername)
        val tvEmail = sidebar.findViewById<TextView>(R.id.tvSidebarEmail)
        val btnSignIn = sidebar.findViewById<MaterialButton>(R.id.btnSidebarSignIn)
        val suggestBadge = sidebar.findViewById<TextView>(R.id.tvSuggestWordBadge)

        if (session.isLoggedIn) {
            tvUsername?.text = session.username ?: "User"
            tvEmail?.text = session.email ?: ""
            btnSignIn?.visibility = View.GONE
            suggestBadge?.visibility = View.GONE
        } else {
            tvUsername?.text = "Guest User"
            tvEmail?.text = "Not signed in"
            btnSignIn?.visibility = View.VISIBLE
            suggestBadge?.visibility = View.VISIBLE
        }
    }    

    private fun openAuthDialog() {
        val dialog = AuthDialogFragment()
        dialog.onSignedIn = {
            refreshSidebarAuthState()
        }
        dialog.show(supportFragmentManager, "auth")
    }
    // ── Views ─────────────────────────────────────────────────────────────────

    private fun bindViews() {
        drawerLayout = findViewById(R.id.drawerLayout)
        btnSidebar   = findViewById(R.id.btnSidebar)
        btnClearAll  = findViewById(R.id.btnClearAll)
        rvHistory    = findViewById(R.id.rvHistory)
        emptyState   = findViewById(R.id.emptyState)
        tvEntryCount = findViewById(R.id.tvEntryCount)
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private fun setupTopBar() {
        btnSidebar.setOnClickListener {
            drawerLayout.openDrawer(GravityCompat.START)
        }
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────

    private fun setupSidebar() {
        val sidebar = findViewById<View>(R.id.sidebarDrawer)
        NavigationHelper.setup(this, drawerLayout, sidebar, Screen.HISTORY)
        
        // Override the sign-in button click to use your openAuthDialog
        findViewById<View>(R.id.btnSidebarSignIn)?.setOnClickListener {
            drawerLayout.closeDrawers()
            openAuthDialog()
        }
        
        // Override Suggest Word navigation to check login
        findViewById<View>(R.id.navSuggestWord)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {
                startActivity(Intent(this, SuggestWordActivity::class.java))
                finish()
            } else {
                openAuthDialog()
            }
        }
        
        // Override Profile navigation to check login
        findViewById<View>(R.id.navProfile)?.setOnClickListener {
            drawerLayout.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {
                startActivity(Intent(this, ProfileActivity::class.java))
                finish()
            } else {
                openAuthDialog()
            }
        }
    }

    // ── RecyclerView ──────────────────────────────────────────────────────────

    private fun setupRecyclerView() {
        adapter = HistoryAdapter(
            items    = mutableListOf(),
            onDelete = { flatIndex -> deleteEntry(flatIndex) }
        )
        rvHistory.layoutManager = LinearLayoutManager(this)
        rvHistory.adapter       = adapter
    }

    private fun setupSwipeToDelete() {
        val swipeCallback = object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT) {
            override fun onMove(
                recyclerView: RecyclerView,
                viewHolder: RecyclerView.ViewHolder,
                target: RecyclerView.ViewHolder
            ) = false

            override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                val position = viewHolder.adapterPosition
                if (adapter.isEntryRow(position)) {
                    val flatIndex = adapter.getFlatIndex(position)
                    deleteEntry(flatIndex)
                } else {
                    adapter.notifyItemChanged(position)
                }
            }

            override fun getSwipeDirs(
                recyclerView: RecyclerView,
                viewHolder: RecyclerView.ViewHolder
            ): Int = if (adapter.isEntryRow(viewHolder.adapterPosition))
                super.getSwipeDirs(recyclerView, viewHolder)
            else 0
        }
        ItemTouchHelper(swipeCallback).attachToRecyclerView(rvHistory)
    }

    // ── Data ──────────────────────────────────────────────────────────────────

    private fun refreshList() {
        android.util.Log.d("HistoryDebug", "Total saved entries: ${historyManager.getAll().size}")
        val grouped = historyManager.getGrouped()
        val items = mutableListOf<HistoryItem>()
        var flatIndex = 0

        for ((date, entries) in grouped) {
            items.add(HistoryItem.DateHeader(date))
            for (entry in entries) {
                items.add(HistoryItem.Entry(entry, flatIndex))
                flatIndex++
            }
        }

        adapter.setItems(items)
        updateUI()
    }

    // ── Listeners ─────────────────────────────────────────────────────────────

    private fun wireListeners() {
        btnClearAll.setOnClickListener { confirmClearAll() }
    }

    // ── Delete helpers ────────────────────────────────────────────────────────

    private fun deleteEntry(flatIndex: Int) {
        historyManager.deleteAt(flatIndex)
        refreshList()
    }

    private fun confirmClearAll() {
        AlertDialog.Builder(this)
            .setTitle("Clear History")
            .setMessage("Are you sure you want to permanently remove all translation history?")
            .setPositiveButton("Clear All") { _, _ ->
                historyManager.clearAll()
                refreshList()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ── UI state ──────────────────────────────────────────────────────────────

    private fun updateUI() {
        val count = adapter.entryCount()
        tvEntryCount.text     = "$count / $MAX_ENTRIES entries"
        emptyState.visibility = if (count == 0) View.VISIBLE else View.GONE
        rvHistory.visibility  = if (count == 0) View.GONE   else View.VISIBLE
        btnClearAll.isEnabled = count > 0
    }

    // ── Back press ────────────────────────────────────────────────────────────

    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        if (drawerLayout.isDrawerOpen(GravityCompat.START)) {
            drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }
}

// ── Data model ────────────────────────────────────────────────────────────────

sealed class HistoryItem {
    data class DateHeader(val date: String) : HistoryItem()
    data class Entry(
        val entry     : TranslationEntry,
        val flatIndex : Int              // position in the flat list from TranslationHistoryManager
    ) : HistoryItem()
}

// ── Adapter ───────────────────────────────────────────────────────────────────

class HistoryAdapter(
    private val items   : MutableList<HistoryItem>,
    private val onDelete: (Int) -> Unit          // receives flatIndex
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        private const val VIEW_TYPE_HEADER = 0
        private const val VIEW_TYPE_ENTRY  = 1
    }

    // ── ViewHolders ───────────────────────────────────────────────────────────

    class DateHeaderViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val tvDateHeader: TextView = view.findViewById(R.id.tvDateHeader)
    }

    class EntryViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val tvGestureTypeBadge : TextView    = view.findViewById(R.id.tvGestureTypeBadge)
        val tvWord             : TextView    = view.findViewById(R.id.tvWord)
        val tvConfidence       : TextView    = view.findViewById(R.id.tvConfidence)
        val tvTime             : TextView    = view.findViewById(R.id.tvTime)
        val btnDelete          : ImageButton = view.findViewById(R.id.btnDelete)
    }

    // ── Adapter overrides ─────────────────────────────────────────────────────

    override fun getItemViewType(position: Int): Int =
        when (items[position]) {
            is HistoryItem.DateHeader -> VIEW_TYPE_HEADER
            is HistoryItem.Entry      -> VIEW_TYPE_ENTRY
        }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return when (viewType) {
            VIEW_TYPE_HEADER -> DateHeaderViewHolder(
                inflater.inflate(R.layout.item_history_date_header, parent, false)
            )
            else -> EntryViewHolder(
                inflater.inflate(R.layout.item_history_entry, parent, false)
            )
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val item = items[position]) {
            is HistoryItem.DateHeader -> {
                (holder as DateHeaderViewHolder).tvDateHeader.text = item.date
            }
            is HistoryItem.Entry -> {
                (holder as EntryViewHolder).apply {
                    val e = item.entry

                    tvWord.text       = e.word
                    tvConfidence.text = "${e.confidence}% confidence"
                    tvTime.text       = TranslationHistoryManager.formatTime(e.timestamp)

                    // Badge: normalise to uppercase for display
                    val badgeLabel = e.gestureType.uppercase()
                    tvGestureTypeBadge.text = badgeLabel

                    // Blue for STATIC, teal for MOTION — matches UI version colours
                    val badgeColor = if (badgeLabel == "STATIC") 0xFF0056A4.toInt()
                                     else                        0xFF00796B.toInt()
                    tvGestureTypeBadge.setBackgroundColor(badgeColor)

                    // Delete button passes flatIndex back to the Activity
                    btnDelete.setOnClickListener { onDelete(item.flatIndex) }
                }
            }
        }
    }

    override fun getItemCount(): Int = items.size

    // ── Public helpers ────────────────────────────────────────────────────────

    fun setItems(newItems: List<HistoryItem>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    fun entryCount(): Int = items.count { it is HistoryItem.Entry }

    fun isEntryRow(position: Int): Boolean =
        position in items.indices && items[position] is HistoryItem.Entry

    fun getFlatIndex(position: Int): Int =
        (items.getOrNull(position) as? HistoryItem.Entry)?.flatIndex ?: -1
}