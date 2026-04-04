package com.example.sigla

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

class NotificationsActivity : AppCompatActivity() {

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var rvNotifications: RecyclerView
    private lateinit var tvEmpty: TextView
    private lateinit var progressLoading: ProgressBar
    private lateinit var session: SessionManager
    private lateinit var adapter: NotificationAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_notifications)

        session = SessionManager.getInstance(this)
        drawerLayout = findViewById(R.id.drawerLayout)
        rvNotifications = findViewById(R.id.rvNotifications)
        tvEmpty = findViewById(R.id.tvEmpty)
        progressLoading = findViewById(R.id.progressLoading)

        // Sidebar
        val sidebar = drawerLayout.getChildAt(1)
        NavigationHelper.setup(this, drawerLayout, sidebar, Screen.NOTIFICATIONS)
        findViewById<MaterialButton>(R.id.btnMenu).setOnClickListener {
            drawerLayout.openDrawer(sidebar)
        }

        // Mark all read
        findViewById<MaterialButton>(R.id.btnMarkAllRead).setOnClickListener { markAllRead() }

        // RecyclerView
        adapter = NotificationAdapter { notif -> markRead(notif) }
        rvNotifications.layoutManager = LinearLayoutManager(this)
        rvNotifications.adapter = adapter

        // Swipe to delete
        val swipeHandler = object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT) {
            override fun onMove(rv: RecyclerView, vh: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder) = false
            override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                val pos = viewHolder.adapterPosition
                val notif = adapter.getItem(pos)
                deleteNotification(notif.id, pos)
            }
        }
        ItemTouchHelper(swipeHandler).attachToRecyclerView(rvNotifications)

        loadNotifications()
    }

    private fun loadNotifications() {
        if (!session.isLoggedIn) {
            tvEmpty.text = "Sign in to view notifications"
            tvEmpty.visibility = View.VISIBLE
            return
        }

        progressLoading.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val response = ApiClient.get(session.token).getNotifications()
                if (response.isSuccessful) {
                    val notifications = response.body()?.notifications ?: emptyList()
                    adapter.submitList(notifications)
                    tvEmpty.visibility = if (notifications.isEmpty()) View.VISIBLE else View.GONE
                    rvNotifications.visibility = if (notifications.isNotEmpty()) View.VISIBLE else View.GONE
                } else {
                    tvEmpty.text = "Failed to load notifications"
                    tvEmpty.visibility = View.VISIBLE
                }
            } catch (e: Exception) {
                tvEmpty.text = "Connection error"
                tvEmpty.visibility = View.VISIBLE
            } finally {
                progressLoading.visibility = View.GONE
            }
        }
    }

    private fun markRead(notif: NotificationItem) {
        if (notif.is_read) return
        lifecycleScope.launch {
            try {
                ApiClient.get(session.token).markRead(notif.id)
                loadNotifications()
            } catch (_: Exception) {}
        }
    }

    private fun markAllRead() {
        lifecycleScope.launch {
            try {
                ApiClient.get(session.token).markAllRead()
                loadNotifications()
            } catch (_: Exception) {}
        }
    }

    private fun deleteNotification(id: Int, position: Int) {
        lifecycleScope.launch {
            try {
                ApiClient.get(session.token).deleteNotification(id)
                loadNotifications()
            } catch (_: Exception) {
                adapter.notifyItemChanged(position)
            }
        }
    }
}

// ── Notification Adapter ────────────────────────────────────────────

class NotificationAdapter(
    private val onClick: (NotificationItem) -> Unit
) : RecyclerView.Adapter<NotificationAdapter.VH>() {

    private var items = listOf<NotificationItem>()

    fun submitList(list: List<NotificationItem>) {
        items = list
        notifyDataSetChanged()
    }

    fun getItem(position: Int) = items[position]

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val tvTitle: TextView = view.findViewById(R.id.tvNotifTitle)
        val tvMessage: TextView = view.findViewById(R.id.tvNotifMessage)
        val tvTime: TextView = view.findViewById(R.id.tvNotifTime)
        val dotUnread: View = view.findViewById(R.id.dotUnread)
        val card: View = view
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_notification, parent, false)
        return VH(view)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val notif = items[position]
        holder.tvTitle.text = notif.title
        holder.tvMessage.text = notif.message
        holder.tvTime.text = formatRelativeTime(notif.created_at)
        holder.dotUnread.visibility = if (!notif.is_read) View.VISIBLE else View.GONE

        // Card background
        val cardView = holder.card as? androidx.cardview.widget.CardView
        cardView?.setCardBackgroundColor(
            if (!notif.is_read) 0xFF131A3A.toInt() else 0xFF0D1127.toInt()
        )

        holder.card.setOnClickListener { onClick(notif) }
    }

    override fun getItemCount() = items.size

    private fun formatRelativeTime(iso: String): String {
        return try {
            // Handle different ISO formats: with/without milliseconds and timezone
            val cleanIso = iso.replace(Regex("\\.\\d{3}.*"), "") // Remove milliseconds and timezone
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            val date = sdf.parse(cleanIso) ?: return iso

            // Convert UTC date to local time for accurate diff calculation
            val localTimeZone = TimeZone.getDefault()
            val utcTime = date.time
            val localTime = utcTime + localTimeZone.getOffset(utcTime)

            val diff = System.currentTimeMillis() - localTime
            val minutes = diff / 60000
            val hours = minutes / 60
            val days = hours / 24

            when {
                minutes < 1 -> "Just now"
                minutes < 60 -> "${minutes}m ago"
                hours < 24 -> "${hours}h ago"
                days < 7 -> "${days}d ago"
                else -> SimpleDateFormat("MMM dd", Locale.getDefault()).format(Date(localTime))
            }
        } catch (e: Exception) { iso }
    }
}
