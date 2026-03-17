import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getUserStats, getAllUsers } from "../../api/userApi.js";
import { getWordStats, getAllWords } from "../../api/wordApi.js";
import { getModelStats } from "../../api/modelApi.js";
import { broadcastAnnouncement } from "../../api/notificationApi.js";
import {
  Users,
  BookOpen,
  Cpu,
  ClipboardList,
  AlertTriangle,
  Send,
  Bell,
  CheckCircle,
  XCircle,
  UserPlus,
} from "lucide-react";

// ── Stat Card ─────────────────────────────────────────────────
const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white rounded-xl shadow-sm p-6 flex items-center gap-4">
    <div className={`p-3 rounded-full ${color}`}>
      <Icon size={22} className="text-white" />
    </div>
    <div>
      <p className="text-sm text-gray-500">{title}</p>
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
  const [pendingWords, setPendingWords] = useState([]);
  const [recentUsers, setRecentUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Announcement form
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState("");
  const [sendError, setSendError] = useState("");

  // ── Fetch ───────────────────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [users, words, models, pendingData, recentUsersData] =
          await Promise.all([
            getUserStats(),
            getWordStats(),
            getModelStats(),
            getAllWords({ status: "pending", limit: 5 }),
            getAllUsers({ limit: 5 }),
          ]);
        setUserStats(users);
        setWordStats(words);
        setModelStats(models);
        setPendingWords(pendingData.words || []);
        setRecentUsers(recentUsersData.users || []);
      } catch (err) {
        setError("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
        <p className="text-gray-500 text-sm mt-1">
          Overview of SIGLA system activity
        </p>
      </div>

      {/* User Stats */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Users
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Users"
            value={userStats?.total}
            icon={Users}
            color="bg-blue-900"
          />
          <StatCard
            title="Pending Requests"
            value={userStats?.pending}
            icon={ClipboardList}
            color="bg-yellow-500"
          />
          <StatCard
            title="Deactivated"
            value={userStats?.deactivated}
            icon={Users}
            color="bg-red-500"
          />
          <StatCard
            title="Warned"
            value={userStats?.warned}
            icon={AlertTriangle}
            color="bg-orange-500"
          />
        </div>
      </div>

      {/* Word Stats */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Words
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Words"
            value={wordStats?.total}
            icon={BookOpen}
            color="bg-blue-900"
          />
          <StatCard
            title="Pending Approval"
            value={wordStats?.pending}
            icon={ClipboardList}
            color="bg-yellow-500"
          />
          <StatCard
            title="Approved"
            value={wordStats?.approved}
            icon={BookOpen}
            color="bg-green-500"
          />
          <StatCard
            title="Rejected"
            value={wordStats?.rejected}
            icon={BookOpen}
            color="bg-red-500"
          />
        </div>
      </div>

      {/* Model Stats */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Model
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Total Versions"
            value={modelStats?.total}
            icon={Cpu}
            color="bg-blue-900"
          />
          <StatCard
            title="Deployed"
            value={modelStats?.deployed}
            icon={Cpu}
            color="bg-green-500"
          />
          <StatCard
            title="Trained (not deployed)"
            value={modelStats?.trained}
            icon={Cpu}
            color="bg-yellow-500"
          />
        </div>
      </div>

      {/* Currently Deployed Model */}
      {modelStats?.current_model && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Currently Deployed Model
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500">Version</p>
              <p className="font-semibold text-gray-800">
                {modelStats.current_model.version_number}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Accuracy</p>
              <p className="font-semibold text-gray-800">
                {modelStats.current_model.accuracy
                  ? `${(modelStats.current_model.accuracy * 100).toFixed(1)}%`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Classes</p>
              <p className="font-semibold text-gray-800">
                {modelStats.current_model.total_classes ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Deployed At</p>
              <p className="font-semibold text-gray-800">
                {modelStats.current_model.deployed_at
                  ? new Date(
                      modelStats.current_model.deployed_at,
                    ).toLocaleDateString("en-PH")
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Row — Pending Submissions + Recent Users */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending word submissions */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-gray-700">
              Words Waiting for Review
            </p>
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

        {/* Recent activity */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <p className="text-sm font-semibold text-gray-700 mb-4">
            Recent User Registrations
          </p>
          {recentUsers.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">
              No recent registrations
            </p>
          ) : (
            <div className="space-y-3">
              {recentUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-3 py-2 border-b last:border-0"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <UserPlus size={14} className="text-blue-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {user.username}
                    </p>
                    <p className="text-xs text-gray-400">{user.email}</p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                      user.status === "active"
                        ? "bg-green-100 text-green-700"
                        : user.status === "pending"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {user.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Send Announcement */}
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
