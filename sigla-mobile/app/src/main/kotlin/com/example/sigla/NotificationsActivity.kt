package com.example.sigla

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.tabs.TabLayout
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import com.google.android.material.button.MaterialButton
import java.util.*

class NotificationsActivity : AppCompatActivity() {

    private lateinit var drawer: DrawerLayout
    private lateinit var session: SessionManager
    private lateinit var adapter: NotificationAdapter
    
    private var allNotifications = mutableListOf<NotificationItem>()
    private var filteredList = mutableListOf<NotificationItem>()
    
    private lateinit var loadingState: View
    private lateinit var emptyState: View

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_notifications)

        session = SessionManager.getInstance(this)
        drawer = findViewById(R.id.drawerLayout)
        loadingState = findViewById(R.id.loadingState)
        emptyState = findViewById(R.id.emptyState)

        setupTopBar()
        setupSidebar()
        setupRecyclerView()
        setupTabs()
        checkConnectivity()
        
        // Load notifications from backend
        loadNotifications()
    }

    override fun onResume() {
        super.onResume()
        refreshSidebarAuthState()  // ← UPDATE SIDEBAR WHEN ACTIVITY RESUMES
    }
    // ── Refresh Sidebar ───────────────────────────────────────────────────────────────
    private fun refreshSidebarAuthState() {
        val sidebar = drawer.getChildAt(1) ?: return
        val tvUsername = sidebar.findViewById<TextView>(R.id.tvSidebarUsername)
        val tvEmail = sidebar.findViewById<TextView>(R.id.tvSidebarEmail)
        val btnSignIn = sidebar.findViewById<MaterialButton>(R.id.btnSidebarSignIn)
        if (session.isLoggedIn) {
            tvUsername?.text = session.username ?: "User"
            tvEmail?.text = session.email ?: ""
            btnSignIn?.visibility = View.GONE
        } else {
            tvUsername?.text = "Guest User"
            tvEmail?.text = "Not signed in"
            btnSignIn?.visibility = View.VISIBLE
        }
    }
    private fun openAuthDialog() {
        val dialog = AuthDialogFragment()
        dialog.onSignedIn = {
            refreshSidebarAuthState()
            // Optional: reload data that requires login
            // finish()
            // startActivity(intent)
        }
        dialog.show(supportFragmentManager, "auth")
    }    
    // ── Top bar ───────────────────────────────────────────────────────────────
    private fun setupTopBar() {
        val btnSidebar = findViewById<View>(R.id.btnSidebar)
        btnSidebar.setOnClickListener { drawer.openDrawer(GravityCompat.START) }

        findViewById<View>(R.id.btnMarkAllRead).setOnClickListener {
            markAllRead()
        }
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────
    private fun setupSidebar() {
        refreshSidebarAuthState()
        setActiveNavItem(R.id.navNotifications)

        findViewById<View>(R.id.navMainInterface)?.setOnClickListener {
        drawer.closeDrawer(GravityCompat.START)
        val intent = Intent(this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        startActivity(intent)
        overridePendingTransition(0, 0)
    }
        findViewById<View>(R.id.navWordBank)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, WordBankActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.navTranslationHistory)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, TranslationHistoryActivity::class.java))
            finish()
        }
        // For Notifications - ADD LOGIN CHECK
        findViewById<View>(R.id.navNotifications)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {                    // ← ADD THIS CHECK
                startActivity(Intent(this, NotificationsActivity::class.java))
                finish()
            } else {
                openAuthDialog()                         // ← ADD THIS
            }
        }

        // For Profile - ADD LOGIN CHECK
        findViewById<View>(R.id.navProfile)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            if (session.isLoggedIn) {                    // ← ADD THIS CHECK
                startActivity(Intent(this, ProfileActivity::class.java))
                finish()
            } else {
                openAuthDialog()                         // ← ADD THIS
            }
        }
        findViewById<View>(R.id.navSettings)?.setOnClickListener {
            drawer.closeDrawer(GravityCompat.START)
            startActivity(Intent(this, SettingsActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.btnSidebarSignIn)?.setOnClickListener {
            drawer.closeDrawers()
            openAuthDialog()
        }        
    }

    private fun setActiveNavItem(activeId: Int) {
        val navIds = listOf(
            R.id.navMainInterface, R.id.navWordBank, R.id.navTranslationHistory,
            R.id.navNotifications, R.id.navProfile, R.id.navSettings
        )
        navIds.forEach { id ->
            val view = findViewById<LinearLayout>(id)
            if (id == activeId) {
                view?.setBackgroundResource(R.drawable.bg_nav_item_selected)
                (view?.getChildAt(0) as? ImageView)?.imageTintList =
                    android.content.res.ColorStateList.valueOf(0xFF4A90E2.toInt())
                (view?.getChildAt(1) as? TextView)?.apply {
                    setTextColor(0xFF4A90E2.toInt())
                    setTypeface(null, android.graphics.Typeface.BOLD)
                }
            } else {
                view?.setBackgroundResource(R.drawable.bg_nav_item_default)
                (view?.getChildAt(0) as? ImageView)?.imageTintList =
                    android.content.res.ColorStateList.valueOf(0xFF6C757D.toInt())
                (view?.getChildAt(1) as? TextView)?.apply {
                    setTextColor(0xFF6C757D.toInt())
                    setTypeface(null, android.graphics.Typeface.NORMAL)
                }
            }
        }
    }

    // ── Load Notifications from Backend ───────────────────────────────────────
    private fun loadNotifications() {
        if (!session.isLoggedIn) {
            Toast.makeText(this, "Sign in to view notifications", Toast.LENGTH_SHORT).show()
            return
        }
        
        loadingState.visibility = View.VISIBLE
        emptyState.visibility = View.GONE
        
        lifecycleScope.launch {
            try {
                val response = ApiClient.get(session.token).getNotifications()
                if (response.isSuccessful) {
                    val notifications = response.body()?.notifications ?: emptyList()
                    allNotifications.clear()
                    allNotifications.addAll(notifications.map { apiNotif ->
                        NotificationItem(
                            id = apiNotif.id.toString(),
                            type = mapNotificationType(apiNotif.title),
                            title = apiNotif.title,
                            message = apiNotif.message,
                            timeAgo = formatRelativeTime(apiNotif.created_at),
                            isRead = apiNotif.is_read
                        )
                    })
                    applyFilter(getCurrentTabFilter())
                    refreshSummaryBar()
                    refreshNotifBadge()
                } else {
                    Toast.makeText(this@NotificationsActivity, "Failed to load notifications", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@NotificationsActivity, "Connection error: ${e.message}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingState.visibility = View.GONE
            }
        }
    }
    
    private fun mapNotificationType(title: String): NotifType {
        return when {
            title.contains("Approved", ignoreCase = true) -> NotifType.APPROVAL
            title.contains("Denied", ignoreCase = true) || title.contains("Rejected", ignoreCase = true) -> NotifType.DENIAL
            title.contains("Warning", ignoreCase = true) -> NotifType.WARNING
            title.contains("Maintenance", ignoreCase = true) -> NotifType.MAINTENANCE
            title.contains("System", ignoreCase = true) -> NotifType.SYSTEM
            else -> NotifType.ANNOUNCEMENT
        }
    }
    
    private fun formatRelativeTime(iso: String): String {
        return try {
            val cleanIso = iso.replace(Regex("\\.\\d{3}.*"), "")
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            val date = sdf.parse(cleanIso) ?: return iso
            
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

    // ── RecyclerView ──────────────────────────────────────────────────────────
    private fun setupRecyclerView() {
        adapter = NotificationAdapter(filteredList) { item ->
            if (!item.isRead) {
                markRead(item.id.toInt())
            }
        }
        val rv = findViewById<RecyclerView>(R.id.rvNotifications)
        rv.layoutManager = LinearLayoutManager(this)
        rv.adapter = adapter
        updateEmptyState()
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────
    private fun setupTabs() {
        val tabs = findViewById<TabLayout>(R.id.tabsFilter)
        tabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab?) { 
                applyFilter(tab?.position ?: 0) 
            }
            override fun onTabUnselected(tab: TabLayout.Tab?) {}
            override fun onTabReselected(tab: TabLayout.Tab?) {}
        })
    }

    private fun getCurrentTabFilter(): Int =
        findViewById<TabLayout>(R.id.tabsFilter).selectedTabPosition

    private fun applyFilter(tabPosition: Int) {
        filteredList.clear()
        filteredList.addAll(when (tabPosition) {
            1    -> allNotifications.filter { !it.isRead }
            2    -> allNotifications.filter { it.type == NotifType.ANNOUNCEMENT || it.type == NotifType.MAINTENANCE }
            3    -> allNotifications.filter { it.type == NotifType.APPROVAL || it.type == NotifType.DENIAL }
            4    -> allNotifications.filter { it.type == NotifType.SYSTEM || it.type == NotifType.WARNING }
            else -> allNotifications
        })
        adapter.notifyDataSetChanged()
        updateEmptyState()
    }

    // ── Backend Actions ───────────────────────────────────────────────────────
    private fun markRead(notificationId: Int) {
        lifecycleScope.launch {
            try {
                val response = ApiClient.get(session.token).markRead(notificationId)
                if (response.isSuccessful) {
                    loadNotifications()
                }
            } catch (e: Exception) {
                // Silent fail
            }
        }
    }
    
    private fun markAllRead() {
        lifecycleScope.launch {
            try {
                val response = ApiClient.get(session.token).markAllRead()
                if (response.isSuccessful) {
                    loadNotifications()
                    Toast.makeText(this@NotificationsActivity, "All notifications marked as read.", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@NotificationsActivity, "Failed to mark all as read", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun refreshNotifBadge() {
        if (!session.isLoggedIn) return
        lifecycleScope.launch {
            try {
                val response = ApiClient.get(session.token).getUnreadCount()
                if (response.isSuccessful) {
                    val count = response.body()?.unread ?: 0
                    val sidebar = drawer.getChildAt(1)
                    val badge = sidebar?.findViewById<TextView>(R.id.tvNotifBadge)
                    if (count > 0) {
                        badge?.text = if (count > 99) "99+" else count.toString()
                        badge?.visibility = View.VISIBLE
                    } else {
                        badge?.visibility = View.GONE
                    }
                }
            } catch (_: Exception) { }
        }
    }

    // ── Summary bar ───────────────────────────────────────────────────────────
    private fun refreshSummaryBar() {
        val unread = allNotifications.count { !it.isRead }
        val badge = findViewById<TextView>(R.id.tvUnreadBadge)
        badge?.text = unread.toString()
        badge?.visibility = if (unread > 0) View.VISIBLE else View.GONE
        val summary = if (unread > 0) "$unread unread notification${if (unread > 1) "s" else ""}"
                      else "No unread notifications"
        findViewById<TextView>(R.id.tvNotifSummary)?.text = summary
    }

    // ── Empty state ───────────────────────────────────────────────────────────
    private fun updateEmptyState() {
        val isEmpty = filteredList.isEmpty()
        emptyState.visibility = if (isEmpty && loadingState.visibility != View.VISIBLE) View.VISIBLE else View.GONE
        findViewById<RecyclerView>(R.id.rvNotifications)?.visibility = if (isEmpty) View.GONE else View.VISIBLE
    }

    // ── Connectivity ──────────────────────────────────────────────────────────
    private fun checkConnectivity() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val isOnline = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        findViewById<View>(R.id.bannerOffline)?.visibility = if (isOnline) View.GONE else View.VISIBLE
    }

    // ── Back press ────────────────────────────────────────────────────────────
    @Deprecated("Use OnBackPressedDispatcher instead")
    override fun onBackPressed() {
        if (drawer.isDrawerOpen(GravityCompat.START)) {
            drawer.closeDrawer(GravityCompat.START)
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    // ── Data Classes ──────────────────────────────────────────────────────────
    enum class NotifType { ANNOUNCEMENT, APPROVAL, DENIAL, WARNING, MAINTENANCE, SYSTEM }

    data class NotificationItem(
        val id: String,
        val type: NotifType,
        val title: String,
        val message: String,
        val timeAgo: String,
        var isRead: Boolean = false
    )

    // ── Adapter ───────────────────────────────────────────────────────────────
    inner class NotificationAdapter(
        private val items: List<NotificationItem>,
        private val onItemClick: (NotificationItem) -> Unit
    ) : RecyclerView.Adapter<NotificationAdapter.VH>() {

        inner class VH(view: View) : RecyclerView.ViewHolder(view) {
            val icon: TextView = view.findViewById(R.id.tvNotifIcon)
            val title: TextView = view.findViewById(R.id.tvNotifTitle)
            val type: TextView = view.findViewById(R.id.tvNotifType)
            val message: TextView = view.findViewById(R.id.tvNotifMessage)
            val time: TextView = view.findViewById(R.id.tvNotifTime)
            val unreadBar: View = view.findViewById(R.id.viewUnreadAccent)
            val unreadDot: View = view.findViewById(R.id.viewUnreadDot)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
            VH(LayoutInflater.from(parent.context)
                .inflate(R.layout.item_notification, parent, false))

        override fun getItemCount() = items.size

        override fun onBindViewHolder(holder: VH, position: Int) {
            val item = items[position]
            holder.title.text = item.title
            holder.message.text = item.message
            holder.time.text = item.timeAgo

            val (emoji, label, color) = when (item.type) {
                NotifType.ANNOUNCEMENT -> Triple("📢", "ANNOUNCEMENT", "#0056A4")
                NotifType.APPROVAL     -> Triple("✅", "APPROVED",     "#2E7D32")
                NotifType.DENIAL       -> Triple("❌", "DENIED",       "#C62828")
                NotifType.WARNING      -> Triple("⚠️", "WARNING",      "#E65100")
                NotifType.MAINTENANCE  -> Triple("🔧", "MAINTENANCE",  "#5C6BC0")
                NotifType.SYSTEM       -> Triple("⚙️", "SYSTEM",       "#00838F")
            }
            holder.icon.text = emoji
            holder.type.text = label
            holder.type.setTextColor(android.graphics.Color.parseColor(color))

            holder.unreadBar.background?.alpha = if (item.isRead) 0 else 255
            holder.unreadDot.visibility = if (item.isRead) View.GONE else View.VISIBLE

            holder.itemView.setOnClickListener { onItemClick(item) }
        }
    }
}