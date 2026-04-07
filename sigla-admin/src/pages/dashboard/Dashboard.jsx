import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getUserStats, getUserRegistrations } from "../../api/userApi.js";
import { getWordStats, getAllWords } from "../../api/wordApi.js";
import { getAllModels, getModelStats } from "../../api/modelApi.js";
import { broadcastAnnouncement } from "../../api/notificationApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import {
  Users,
  BookOpen,
  Cpu,
  ClipboardList,
  Database,
  TrendingUp,
  Send,
  Activity,
  Clock,
} from "lucide-react";

// ── Helpers ──
const formatActivityDate = (dateStr) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

const formatChartDate = (dateStr, period) => {
  const d = new Date(dateStr);
  if (period === "year")
    return d.toLocaleDateString("en-PH", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

// ── Stat Card ──
const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="dash-stat-card flex items-center gap-4 min-w-0">
    <div className={`p-3 rounded-full shrink-0 ${color}`}>
      <Icon size={20} className="text-white" />
    </div>
    <div className="min-w-0">
      <p className="text-xs text-gray-500 truncate">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value ?? "—"}</p>
    </div>
  </div>
);

// ── Skeleton Card ──
const SkeletonCard = () => (
  <div className="dash-stat-card flex items-center gap-4" style={{ opacity: 0.6 }}>
    <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse shrink-0" />
    <div className="space-y-2 flex-1 min-w-0">
      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
      <div className="h-7 w-10 bg-gray-200 rounded animate-pulse" />
    </div>
  </div>
);

// ── Activity badge ──
const ActivityBadge = ({ badge }) => {
  const map = {
    registered: "bg-blue-100 text-blue-700",
    pending:    "bg-yellow-100 text-yellow-700",
    approved:   "bg-green-100 text-green-700",
    rejected:   "bg-red-100 text-red-700",
    ready:      "bg-blue-100 text-blue-700",
  };
  const label = {
    registered: "Registered",
    pending:    "Pending",
    approved:   "Approved",
    rejected:   "Rejected",
    ready:      "Registered",
  };
  return (
    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${map[badge] ?? "bg-gray-100 text-gray-600"}`}>
      {label[badge] ?? badge}
    </span>
  );
};

// ── Chart that hides during sidebar transition ──
const TransitionAwareChart = ({ children }) => {
  const [isTransitioning, setIsTransitioning] = useState(
    document.body.classList.contains("sidebar-transitioning"),
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setIsTransitioning(document.body.classList.contains("sidebar-transitioning")),
    );
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  if (isTransitioning) {
    return (
      <div className="h-full flex items-center justify-center text-gray-300">
        <TrendingUp size={32} style={{ opacity: 0.35 }} />
      </div>
    );
  }
  return children;
};

// ── Dashboard ──
const Dashboard = () => {
  const navigate = useNavigate();
  const toast = useToast();

  const [userStats, setUserStats]   = useState(null);
  const [wordStats, setWordStats]   = useState(null);
  const [modelStats, setModelStats] = useState(null);
  const [allModels, setAllModels]   = useState([]);
  const [pendingWords, setPendingWords] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [recentReviews, setRecentReviews] = useState([]);
  const [regPeriod, setRegPeriod]   = useState("month");
  const [loading, setLoading]       = useState(true);
  const [announcementTitle, setAnnouncementTitle]     = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [sending, setSending]       = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [users, words, models, modelsAll, pendingData] = await Promise.all([
          getUserStats(),
          getWordStats(),
          getModelStats(),
          getAllModels(),
          getAllWords({ status: "pending", limit: 5 }),
        ]);
        setUserStats(users);
        setWordStats(words);
        setModelStats(models);
        setAllModels(modelsAll.models || []);
        setPendingWords(pendingData.words || []);
      } catch {
        toast.error("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [toast]);

  const fetchRegistrations = useCallback(async (period) => {
    try {
      const res = await getUserRegistrations(period);
      setRegistrations(res.data || []);
    } catch {
      setRegistrations([]);
    }
  }, []);

  const fetchRecentReviews = useCallback(async () => {
    try {
      const [approved, rejected] = await Promise.all([
        getAllWords({ status: "approved", limit: 10 }),
        getAllWords({ status: "rejected", limit: 10 }),
      ]);
      const combined = [
        ...(approved.words || []).map((w) => ({ ...w, reviewStatus: "approved" })),
        ...(rejected.words || []).map((w) => ({ ...w, reviewStatus: "rejected" })),
      ];
      combined.sort(
        (a, b) =>
          new Date(b.reviewed_at ?? b.updated_at) -
          new Date(a.reviewed_at ?? a.updated_at),
      );
      setRecentReviews(combined.slice(0, 10));
    } catch {
      setRecentReviews([]);
    }
  }, []);

  useEffect(() => { fetchRecentReviews(); }, [fetchRecentReviews]);
  useEffect(() => { fetchRegistrations(regPeriod); }, [regPeriod, fetchRegistrations]);

  const handleSendAnnouncement = async () => {
    if (!announcementTitle.trim() || !announcementMessage.trim()) {
      toast.error("Title and message are required");
      return;
    }
    setSending(true);
    try {
      const res = await broadcastAnnouncement({
        title: announcementTitle.trim(),
        message: announcementMessage.trim(),
      });
      toast.success(`Announcement sent to ${res.sent} users successfully.`);
      setAnnouncementTitle("");
      setAnnouncementMessage("");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send announcement");
    } finally {
      setSending(false);
    }
  };

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-44 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />
        </div>
        {/* Stat cards skeleton — 3-col spanning grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 280px", gridTemplateRows: "auto auto", gap: "24px" }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <div style={{ gridColumn: "3", gridRow: "1 / 3" }} className="dash-stat-card animate-pulse" />
        </div>
        {/* Chart skeleton */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
          <div className="dash-card animate-pulse">
            <div className="dash-card-header"><div className="h-5 w-40 bg-gray-200 rounded" /></div>
            <div className="dash-card-body"><div className="h-64 bg-gray-100 rounded" /></div>
          </div>
          <div className="dash-card animate-pulse">
            <div className="dash-card-header"><div className="h-5 w-28 bg-gray-200 rounded" /></div>
            <div className="dash-card-body space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <div className="h-3 w-24 bg-gray-200 rounded" />
                  <div className="h-2 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const deployedModel      = modelStats?.current_model;
  const modelsWithAccuracy = (allModels || []).filter((m) => m.accuracy != null).slice(0, 8);

  // Compose recent activity
  const recentActivity = (() => {
    const activities = [];
    registrations.slice(0, 10).forEach((r) => {
      activities.push({
        id: `reg-${r.date}`,
        label: "New User Registration",
        description: `${r.count} user(s) registered`,
        badge: "registered",
        date: r.date,
      });
    });
    pendingWords.forEach((word) => {
      activities.push({
        id: `word-${word.id}`,
        label: word.label,
        description: `${word.total_samples || 0} sample(s) submitted for review`,
        badge: "pending",
        date: word.created_at || word.updated_at || Date.now(),
      });
    });
    recentReviews.forEach((word) => {
      activities.push({
        id: `review-${word.id}`,
        label: `${word.reviewStatus === "approved" ? "Approved" : "Rejected"}: ${word.label}`,
        description: word.reviewStatus === "approved"
          ? "Word approved and added to word bank"
          : "Word rejected — submitter notified",
        badge: word.reviewStatus,
        date: word.reviewed_at || word.updated_at || Date.now(),
      });
    });
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));
    return activities.slice(0, 10);
  })();

  const chartData = registrations.map((r) => ({
    ...r,
    label: formatChartDate(r.date, regPeriod),
  }));

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div>
        <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Welcome back! Here's what's happening today.</p>
      </div>

      {/* ── Stat cards — 3-col grid, model version spans both rows on the right ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 280px", gridTemplateRows: "auto auto", gap: "24px" }}>
        {/* Col 3, rows 1–2 — placed first so auto-placement fills cols 1–2 correctly */}
        <div style={{ gridColumn: "3", gridRow: "1 / 3" }}>
          <div className="dash-stat-card h-full flex flex-col items-center justify-center gap-3">
            <div className="p-4 rounded-full bg-green-600 shrink-0">
              <Cpu size={24} className="text-white" />
            </div>
            <div className="text-center min-w-0">
              <p className="text-xs text-gray-500">Active Model Version</p>
              <p className="text-3xl font-bold text-gray-800 mt-1">
                {deployedModel?.version_number ?? "None"}
              </p>
            </div>
          </div>
        </div>
        {/* 4 auto-placed cards — fill cols 1 & 2, rows 1 & 2 */}
        <StatCard title="Total Users"         value={userStats?.total}         icon={Users}         color="bg-blue-900" />
        <StatCard title="Total Words"         value={wordStats?.total}         icon={BookOpen}      color="bg-blue-800" />
        <StatCard title="Gesture Samples"     value={wordStats?.total_samples} icon={Database}      color="bg-blue-700" />
        <StatCard title="Pending Submissions" value={wordStats?.pending}       icon={ClipboardList} color="bg-yellow-500" />
      </div>

      {/* ── Charts row: Registration bar chart + Model accuracy list ── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6 items-start">

        {/* Registration chart */}
        <div className="dash-card">
          <div className="dash-card-header flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">New User Registrations</h2>
              <p className="text-sm text-gray-500 mt-0.5">User signups over time</p>
            </div>
            {/* Period toggle */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 shrink-0">
              {["week", "month", "year"].map((p) => (
                <button
                  key={p}
                  onClick={() => setRegPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition capitalize ${
                    regPeriod === p
                      ? "bg-white text-blue-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="dash-card-body">
            <div style={{ height: 280 }}>
              {chartData.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
                  <TrendingUp size={40} style={{ opacity: 0.35 }} />
                  <p className="text-sm font-medium">No registration data for this period</p>
                </div>
              ) : (
                <TransitionAwareChart>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} cursor={{ fill: "#f3f4f6" }} />
                      <Bar dataKey="count" name="Registrations" fill="#1e3a8a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </TransitionAwareChart>
              )}
            </div>
          </div>
        </div>

        {/* Model accuracy list */}
        <div className="dash-card">
          <div className="dash-card-header">
            <h2 className="text-lg font-semibold text-gray-800">Model Accuracy</h2>
            <p className="text-sm text-gray-500 mt-0.5">By version</p>
          </div>
          <div className="dash-card-body space-y-4 max-h-72 overflow-y-auto">
            {modelsWithAccuracy.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No trained models yet</p>
            ) : (
              modelsWithAccuracy.map((m) => {
                const pct = (m.accuracy * 100).toFixed(1);
                const isDeployed = m.status === "deployed";
                return (
                  <div key={m.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-700">v{m.version_number}</span>
                      {isDeployed && (
                        <span className="text-[11px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                          deployed
                        </span>
                      )}
                      <span className="ml-auto text-xs font-semibold text-gray-500">{pct}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-500 ${isDeployed ? "bg-green-500" : "bg-blue-400"}`}
                        style={{ width: `${Math.min(parseFloat(pct), 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Activity row: Recent activity + Pending reviews ── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6 items-start">

        {/* Recent activity */}
        <div className="dash-card">
          <div className="dash-card-header flex items-center gap-2">
            <Activity size={18} className="text-gray-400 shrink-0" />
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Recent Activity</h2>
              <p className="text-sm text-gray-500 mt-0.5">Latest events in the system</p>
            </div>
          </div>
          <div className="dash-card-body max-h-80 overflow-y-auto">
            {recentActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
                <Activity size={36} style={{ opacity: 0.35 }} />
                <p className="text-sm font-medium">No recent activity</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentActivity.map((item) => (
                  <div key={item.id} className="dash-request-item">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-0.5">
                        <h4 className="text-sm font-semibold text-gray-800 truncate">{item.label}</h4>
                        <ActivityBadge badge={item.badge} />
                      </div>
                      <p className="text-xs text-gray-500 truncate">{item.description}</p>
                      <span className="text-[11px] text-gray-400">{formatActivityDate(item.date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pending reviews */}
        <div className="dash-card">
          <div className="dash-card-header flex items-center gap-2">
            <Clock size={18} className="text-gray-400 shrink-0" />
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Pending Reviews</h2>
              <p className="text-sm text-gray-500 mt-0.5">Submissions awaiting review</p>
            </div>
          </div>
          <div className="dash-card-body max-h-80 overflow-y-auto">
            {pendingWords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
                <BookOpen size={36} style={{ opacity: 0.35 }} />
                <p className="text-sm font-medium">No pending reviews</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingWords.map((word) => (
                  <div key={word.id} className="dash-request-item flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-gray-800 truncate">{word.label}</h4>
                      <p className="text-xs text-gray-500">
                        {word.submitter?.username || "—"} · {word.total_samples || 0} samples
                      </p>
                      <span className="text-[11px] text-gray-400">
                        {formatActivityDate(word.created_at || word.updated_at || Date.now())}
                      </span>
                    </div>
                    <button
                      onClick={() => navigate(`/word_bank?status=pending&wordId=${word.id}`)}
                      className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border-2 border-blue-900 text-blue-900 hover:bg-blue-900 hover:text-white transition"
                    >
                      Review
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Send Announcement ── */}
      <div className="dash-card">
        <div className="dash-card-header flex items-center gap-2">
          <Send size={18} className="text-gray-400 shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Send Announcement</h2>
            <p className="text-sm text-gray-500 mt-0.5">Broadcast a notification to all active users</p>
          </div>
        </div>
        <div className="dash-card-body">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Title</label>
              <input
                type="text"
                value={announcementTitle}
                onChange={(e) => setAnnouncementTitle(e.target.value)}
                placeholder="e.g. Scheduled Maintenance"
                className="w-full px-3 py-2.5 text-sm border-2 border-gray-200 rounded-lg focus:outline-none focus:border-blue-900 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Message</label>
              <input
                type="text"
                value={announcementMessage}
                onChange={(e) => setAnnouncementMessage(e.target.value)}
                placeholder="Write your announcement here..."
                className="w-full px-3 py-2.5 text-sm border-2 border-gray-200 rounded-lg focus:outline-none focus:border-blue-900 transition"
              />
            </div>
            <button
              onClick={handleSendAnnouncement}
              disabled={sending || !announcementTitle.trim() || !announcementMessage.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Send size={15} />
              {sending ? "Sending..." : "Send to All Users"}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default React.memo(Dashboard);
