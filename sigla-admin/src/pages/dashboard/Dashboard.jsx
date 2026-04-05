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
  Send,
  Bell,
  CheckCircle,
  XCircle,
  Database,
  FileText,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────

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

// ── Skeleton Card ─────────────────────────────────────────────
const SkeletonCard = () => (
  <div className="bg-white rounded-xl shadow-sm p-5 flex items-center gap-4">
    <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
      <div className="h-7 w-12 bg-gray-200 rounded animate-pulse" />
    </div>
  </div>
);

// ── Dashboard ─────────────────────────────────────────────────
const Dashboard = () => {
  const navigate = useNavigate();
  const toast = useToast();

  const [userStats, setUserStats] = useState(null);
  const [wordStats, setWordStats] = useState(null);
  const [modelStats, setModelStats] = useState(null);
  const [allModels, setAllModels] = useState([]);
  const [pendingWords, setPendingWords] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [regPeriod, setRegPeriod] = useState("month");
  const [loading, setLoading] = useState(true);

  // Announcement form
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [sending, setSending] = useState(false);

  // ── Fetch core data ─────────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [users, words, models, modelsAll, pendingData] =
          await Promise.all([
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
      } catch (err) {
        toast.error("Failed to load dashboard data");
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

  // ── Loading ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <div className="h-8 w-28 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
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
              <BarChart
                data={chartData}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
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
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                  }}
                  cursor={{ fill: "#f3f4f6" }}
                />
                <Bar
                  dataKey="count"
                  name="Registrations"
                  fill="#1e3a8a"
                  radius={[4, 4, 0, 0]}
                />
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
                          style={{
                            width: `${Math.min(parseFloat(pct), 100)}%`,
                          }}
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

      {/* ── Pending Submissions ── */}
      <div className="grid grid-cols-1 gap-6">
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
