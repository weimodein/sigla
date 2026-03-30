import { useState, useEffect, useCallback } from "react";
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
import { getUserStats, getUserRegistrations, getRecentActivity } from "../../api/userApi.js";
import { getWordStats, getAllWords } from "../../api/wordApi.js";
import { getAllModels, getModelStats } from "../../api/modelApi.js";
import { broadcastAnnouncement } from "../../api/notificationApi.js";
import {
  Users,
  BookOpen,
  Cpu,
  ClipboardList,
  Send,
  Bell,
  CheckCircle,
  XCircle,
  Database,
  Activity,
  FileText,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────
const ACTION_LABELS = {
  submitted_word: "submitted a word",
  admin_added_word: "added a word",
  admin_uploaded_samples: "uploaded samples",
  approved_submission: "approved a submission",
  rejected_submission: "rejected a submission",
  locked_word: "locked a word",
  unlocked_word: "unlocked a word",
  approved_word: "approved a word",
  rejected_word: "rejected a word",
  updated_word: "updated a word",
  deleted_word: "deleted a word",
  created_user: "created a user",
  approved_user: "approved a user",
  warned_user: "warned a user",
  deactivated_user: "deactivated a user",
  reactivated_user: "reactivated a user",
  auto_reactivated_user: "auto-reactivated a user",
  deleted_user: "deleted a user",
  updated_user: "updated a user",
  trained_model: "trained a model",
  tested_model: "tested a model",
  deployed_model: "deployed a model",
  reverted_model: "reverted a model",
  deleted_model: "deleted a model",
  sent_announcement: "sent an announcement",
};

const ACTION_COLORS = {
  submitted_word: "bg-blue-100 text-blue-700",
  admin_added_word: "bg-blue-100 text-blue-700",
  approved_submission: "bg-green-100 text-green-700",
  approved_word: "bg-green-100 text-green-700",
  approved_user: "bg-green-100 text-green-700",
  reactivated_user: "bg-green-100 text-green-700",
  auto_reactivated_user: "bg-green-100 text-green-700",
  rejected_submission: "bg-red-100 text-red-700",
  rejected_word: "bg-red-100 text-red-700",
  deleted_word: "bg-red-100 text-red-700",
  deleted_user: "bg-red-100 text-red-700",
  deleted_model: "bg-red-100 text-red-700",
  warned_user: "bg-orange-100 text-orange-700",
  deactivated_user: "bg-orange-100 text-orange-700",
  deployed_model: "bg-purple-100 text-purple-700",
  trained_model: "bg-purple-100 text-purple-700",
  tested_model: "bg-purple-100 text-purple-700",
};

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
  if (period === "year") {
    return d.toLocaleDateString("en-PH", { month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

// ── Stat Card ─────────────────────────────────────────────────
const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white rounded-xl shadow-sm p-5 flex items-center gap-4">
    <div className={`p-3 rounded-full ${color}`}>
      <Icon size={20} className="text-white" />
    </div>
    <div>
      <p className="text-xs text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value ?? "—"}</p>
    </div>
  </div>
);

// ── Dashboard ─────────────────────────────────────────────────
const Dashboard = () => {
  const navigate = useNavigate();

  const [userStats, setUserStats] = useState(null);
  const [wordStats, setWordStats] = useState(null);
  const [modelStats, setModelStats] = useState(null);
  const [allModels, setAllModels] = useState([]);
  const [pendingWords, setPendingWords] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [activity, setActivity] = useState([]);
  const [regPeriod, setRegPeriod] = useState("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Announcement form
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState("");
  const [sendError, setSendError] = useState("");

  // ── Fetch core data ─────────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [users, words, models, modelsAll, pendingData, activityData] =
          await Promise.all([
            getUserStats(),
            getWordStats(),
            getModelStats(),
            getAllModels(),
            getAllWords({ status: "pending", limit: 5 }),
            getRecentActivity(10),
          ]);
        setUserStats(users);
        setWordStats(words);
        setModelStats(models);
        setAllModels(modelsAll.models || []);
        setPendingWords(pendingData.words || []);
        setActivity(activityData.activity || []);
      } catch (err) {
        setError("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  // ── Fetch registration chart data ───────────────────────────
  const fetchRegistrations = useCallback(async (period) => {
    try {
      const res = await getUserRegistrations(period);
      setRegistrations(res.data || []);
    } catch {
      setRegistrations([]);
    }
  }, []);

  useEffect(() => {
    fetchRegistrations(regPeriod);
  }, [regPeriod, fetchRegistrations]);

  // ── Send Announcement ───────────────────────────────────────
  const handleSendAnnouncement = async () => {
    if (!announcementTitle.trim() || !announcementMessage.trim()) {
      setSendError("Title and message are required");
      return;
    }
    setSending(true);
    setSendError("");
    setSendSuccess("");
    try {
      const res = await broadcastAnnouncement({
        title: announcementTitle.trim(),
        message: announcementMessage.trim(),
      });
      setSendSuccess(`Announcement sent to ${res.sent} users successfully.`);
      setAnnouncementTitle("");
      setAnnouncementMessage("");
      setTimeout(() => setSendSuccess(""), 4000);
    } catch (err) {
      setSendError(
        err.response?.data?.message || "Failed to send announcement",
      );
    } finally {
      setSending(false);
    }
  };

  // ── Loading ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
        {error}
      </div>
    );
  }

  const deployedModel = modelStats?.current_model;
  const chartData = registrations.map((r) => ({
    ...r,
    label: formatChartDate(r.date, regPeriod),
  }));

  // Models with accuracy, sorted newest first, limit 8
  const modelsWithAccuracy = allModels
    .filter((m) => m.accuracy != null)
    .slice(0, 8);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
        <p className="text-gray-500 text-sm mt-1">
          Overview of SIGLA system activity
        </p>
      </div>

      {/* ── Summary — 5 key stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Total Users"
          value={userStats?.total}
          icon={Users}
          color="bg-blue-900"
        />
        <StatCard
          title="Total Words"
          value={wordStats?.total}
          icon={BookOpen}
          color="bg-blue-700"
        />
        <StatCard
          title="Pending Submissions"
          value={wordStats?.pending}
          icon={ClipboardList}
          color="bg-yellow-500"
        />
        <StatCard
          title="Gesture Samples"
          value={wordStats?.total_samples}
          icon={Database}
          color="bg-indigo-500"
        />
        <StatCard
          title="Model Version"
          value={deployedModel?.version_number ?? "None"}
          icon={Cpu}
          color="bg-green-600"
        />
      </div>

      {/* ── Chart + Model Accuracy ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Registration chart (2/3 width) */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-gray-700">
              New User Registrations
            </p>
            <div className="flex gap-1">
              {["week", "month", "year"].map((p) => (
                <button
                  key={p}
                  onClick={() => setRegPeriod(p)}
                  className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                    regPeriod === p
                      ? "bg-blue-900 text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              No registration data for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                  cursor={{ fill: "#f3f4f6" }}
                />
                <Bar dataKey="count" name="Registrations" fill="#1e3a8a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Model accuracy list (1/3 width) */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <p className="text-sm font-semibold text-gray-700 mb-4">
            Model Accuracy by Version
          </p>
          {modelsWithAccuracy.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">
              No trained models yet
            </p>
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-56">
              {modelsWithAccuracy.map((m) => {
                const pct = (m.accuracy * 100).toFixed(1);
                const isDeployed = m.status === "deployed";
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-medium text-gray-700 truncate">
                          v{m.version_number}
                        </p>
                        {isDeployed && (
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                            deployed
                          </span>
                        )}
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${isDeployed ? "bg-green-500" : "bg-blue-400"}`}
                          style={{ width: `${Math.min(parseFloat(pct), 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-gray-600 w-10 text-right">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Activity + Pending Submissions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent activity feed */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-gray-400" />
            <p className="text-sm font-semibold text-gray-700">
              Recent Activity
            </p>
          </div>
          {activity.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">
              No activity yet
            </p>
          ) : (
            <div className="space-y-3">
              {activity.map((log) => {
                const label = ACTION_LABELS[log.action] || log.action;
                const colorClass =
                  ACTION_COLORS[log.action] || "bg-gray-100 text-gray-600";
                const actor = log.user?.username || "System";
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 py-2 border-b last:border-0"
                  >
                    <span
                      className={`mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${colorClass}`}
                    >
                      {log.action.replace(/_/g, " ")}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-700">
                        <span className="font-medium">{actor}</span>{" "}
                        {label}
                        {log.details ? (
                          <span className="text-gray-400"> — {log.details}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatActivityDate(log.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pending word submissions */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-gray-400" />
              <p className="text-sm font-semibold text-gray-700">
                Words Waiting for Review
              </p>
            </div>
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
              {wordStats?.pending ?? 0} pending
            </span>
          </div>
          {pendingWords.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">
              No pending submissions
            </p>
          ) : (
            <div className="space-y-3">
              {pendingWords.map((word) => (
                <div
                  key={word.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {word.label}
                    </p>
                    <p className="text-xs text-gray-400">
                      by {word.submitter?.username || "—"} ·{" "}
                      {word.total_samples || 0} samples
                    </p>
                  </div>
                  <button
                    onClick={() => navigate("/words")}
                    className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1 rounded-lg"
                  >
                    Review
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Send Announcement ── */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Bell size={18} className="text-blue-900" />
          <p className="text-sm font-semibold text-gray-700">
            Send Announcement
          </p>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Broadcast a notification to all active users. This will appear in
          their Notifications module.
        </p>

        {sendSuccess && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
            <CheckCircle size={16} />
            {sendSuccess}
          </div>
        )}
        {sendError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
            <XCircle size={16} />
            {sendError}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Title
            </label>
            <input
              type="text"
              value={announcementTitle}
              onChange={(e) => setAnnouncementTitle(e.target.value)}
              placeholder="e.g. Scheduled Maintenance"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Message
            </label>
            <textarea
              value={announcementMessage}
              onChange={(e) => setAnnouncementMessage(e.target.value)}
              placeholder="Write your announcement here..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900 resize-none"
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Will be sent to all active users
            </p>
            <button
              onClick={handleSendAnnouncement}
              disabled={
                sending ||
                !announcementTitle.trim() ||
                !announcementMessage.trim()
              }
              className="flex items-center gap-2 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-5 py-2 rounded-lg transition disabled:opacity-50"
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

export default Dashboard;
