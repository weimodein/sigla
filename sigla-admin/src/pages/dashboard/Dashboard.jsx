import React, { useState, useEffect, useCallback, useRef } from "react";
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
  UserCheck,
  BookOpen,
  Cpu,
  ClipboardList,
  Database,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Send,
} from "lucide-react";

// ── Color palette ──
const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
};

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
  if (period === "year") {
    return d.toLocaleDateString("en-PH", { month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};


// ── Stat Card ──
const StatCard = ({ title, value, icon: Icon, color, trend }) => (
  <div className="dash-stat-card flex items-center gap-4">
    <div className={`p-3 rounded-full ${color}`}>
      <Icon size={20} className="text-white" />
    </div>
    <div>
      <p className="text-xs text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value ?? "—"}</p>
    </div>
    {trend && (
      <div
        style={{
          position: "absolute",
          top: "20px",
          right: "20px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: trend > 0 ? "#16a34a" : "#dc2626",
        }}
      >
        {trend > 0 ? <TrendingUp size={14} /> : <ArrowDownRight size={14} />}
        <span>{Math.abs(trend)}%</span>
      </div>
    )}
  </div>
);

// ── Skeleton Card ──
const SkeletonCard = () => (
  <div className="dash-stat-card flex items-center gap-4" style={{ opacity: 0.6 }}>
    <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
      <div className="h-7 w-10 bg-gray-200 rounded animate-pulse" />
    </div>
  </div>
);

// ── Chart that hides during sidebar transition ──
const TransitionAwareChart = ({ children }) => {
  const [isTransitioning, setIsTransitioning] = useState(
    document.body.classList.contains("sidebar-transitioning"),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsTransitioning(
        document.body.classList.contains("sidebar-transitioning"),
      );
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  if (isTransitioning) {
    return (
      <div
        style={{
          height: "300px",
          background: "#f9fafb",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9ca3af",
        }}
      >
        <TrendingUp size={32} style={{ opacity: 0.4 }} />
      </div>
    );
  }
  return children;
};

// ── Dashboard ──
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

  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [sending, setSending] = useState(false);

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

  useEffect(() => {
    fetchRegistrations(regPeriod);
  }, [regPeriod, fetchRegistrations]);

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

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div>
          <div
            style={{
              width: "120px",
              height: "32px",
              background: "#e5e7eb",
              borderRadius: "6px",
              marginBottom: "8px",
            }}
          />
          <div
            style={{
              width: "200px",
              height: "16px",
              background: "#e5e7eb",
              borderRadius: "6px",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "24px",
          }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ flex: "1 1 0", minWidth: "180px" }}>
              <SkeletonCard />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const deployedModel = modelStats?.current_model;
  const modelsWithAccuracy = (allModels || [])
    .filter((m) => m.accuracy != null)
    .slice(0, 8);

  // Compose recent activity from registrations and word actions
  const recentActivity = (() => {
    const activities = [];

    registrations.slice(0, 10).forEach((r) => {
      activities.push({
        id: `reg-${r.date}`,
        label: "New User Registration",
        description: `${r.count} user(s) registered`,
        badge: "ready",
        badgeText: "registered",
        date: r.date,
      });
    });

    pendingWords.forEach((word) => {
      activities.push({
        id: `word-${word.id}`,
        label: word.label,
        description: `${word.total_samples || 0} sample(s) submitted for review`,
        badge: "pending",
        badgeText: "pending",
        date: word.created_at || word.updated_at || Date.now(),
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
    <div>
      {/* Welcome Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 700,
            color: C.text,
            margin: 0,
          }}
        >
          Admin Dashboard
        </h1>
        <p style={{ fontSize: "0.9rem", color: "#6b7280", margin: "4px 0 0" }}>
          Welcome back! Here's what's happening today.
        </p>
      </div>

      {/* Quick Stats Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 280px",
          gridTemplateRows: "auto auto",
          gap: "24px",
          marginBottom: "32px",
        }}
      >
        <StatCard
          title="Total Users"
          value={userStats?.total}
          icon={Users}
          trend={12}
          color="bg-blue-900"
        />
        <StatCard
          title="Total Words"
          value={wordStats?.total}
          icon={BookOpen}
          trend={8}
          color="bg-blue-800"
        />
        <StatCard
          title="Pending Submissions"
          value={wordStats?.pending}
          icon={ClipboardList}
          trend={-3}
          color="bg-yellow-500"
        />
        <StatCard
          title="Gesture Samples"
          value={wordStats?.total_samples}
          icon={Database}
          color="bg-blue-700"
        />
        {/* Tall card on right — Model Version */}
        <div style={{ gridRow: "1 / 3" }}>
          <div
            className="dash-stat-card"
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                justifyContent: "center",
              }}
            >
              <div className="p-3 rounded-full bg-green-500">
                <Cpu size={20} className="text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Model Version</p>
                <p className="text-2xl font-bold text-gray-800">{deployedModel?.version_number ?? "None"}</p>
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "#16a34a",
              }}
            >
              <ArrowUpRight size={14} />
              <span>5%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: Charts Row */}
      <div
        style={{
          display: "flex",
          gap: "24px",
          marginBottom: "24px",
          alignItems: "stretch",
        }}
      >
        {/* Chart */}
        <div className="dash-card" style={{ flex: 1 }}>
          <div className="dash-card-header">
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 600,
                color: C.text,
                margin: "0 0 4px",
              }}
            >
              New User Registrations
            </h2>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>
              User signups over time
            </p>
          </div>
          <div
            className="dash-card-body"
            style={{
              display: "flex",
              maxHeight: "300px",
              flexDirection: "column",
            }}
          >
            {/* Period toggle */}
            <div
              style={{
                display: "flex",
                gap: "8px",
                marginBottom: "16px",
                alignSelf: "flex-end",
              }}
            >
              {["week", "month", "year"].map((p) => (
                <button
                  key={p}
                  onClick={() => setRegPeriod(p)}
                  style={{
                    padding: "6px 12px",
                    fontSize: "0.75rem",
                    borderRadius: "8px",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    background: regPeriod === p ? C.primary : "#f3f4f6",
                    color: regPeriod === p ? "white" : "#6b7280",
                    transition: "all 0.2s ease",
                    fontFamily: "inherit",
                  }}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ height: "300px" }}>
              {chartData.length === 0 ? (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#9ca3af",
                    textAlign: "center",
                  }}
                >
                  <TrendingUp
                    size={48}
                    style={{ marginBottom: "12px", opacity: 0.4 }}
                  />
                  <p style={{ fontSize: "0.9rem", fontWeight: 500 }}>
                    No registration data for this period
                  </p>
                </div>
              ) : (
                <TransitionAwareChart>
                  <ResponsiveContainer width="100%" height="100%">
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
                        fill={C.primary}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </TransitionAwareChart>
              )}
            </div>
          </div>
        </div>

        {/* Model Accuracy */}
        <div className="dash-card" style={{ width: "280px", minHeight: 0 }}>
          <div className="dash-card-header">
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 600,
                color: C.text,
                margin: "0 0 4px",
              }}
            >
              Model Accuracy
            </h2>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>
              By version
            </p>
          </div>
          <div
            className="dash-card-body"
            style={{ maxHeight: "300px", overflowY: "auto" }}
          >
            {modelsWithAccuracy.length === 0 ? (
              <p
                style={{
                  color: "#9ca3af",
                  fontSize: "0.85rem",
                  textAlign: "center",
                  padding: "24px",
                }}
              >
                No trained models yet
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                {modelsWithAccuracy.map((m) => {
                  const pct = (m.accuracy * 100).toFixed(1);
                  const isDeployed = m.status === "deployed";
                  return (
                    <div key={m.id}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginBottom: "4px",
                        }}
                      >
                        <p
                          style={{
                            fontSize: "0.8rem",
                            fontWeight: 500,
                            color: C.text,
                            margin: 0,
                          }}
                        >
                          v{m.version_number}
                        </p>
                        {isDeployed && (
                          <span
                            style={{
                              fontSize: "0.65rem",
                              background: "#dcfce7",
                              color: "#16a34a",
                              padding: "2px 6px",
                              borderRadius: "10px",
                              fontWeight: 600,
                            }}
                          >
                            deployed
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          width: "100%",
                          background: "#f3f4f6",
                          borderRadius: "4px",
                          height: "6px",
                        }}
                      >
                        <div
                          style={{
                            height: "6px",
                            borderRadius: "4px",
                            background: isDeployed ? "#22c55e" : C.accent,
                            width: `${Math.min(parseFloat(pct), 100)}%`,
                            transition: "width 0.5s ease",
                          }}
                        />
                      </div>
                      <p
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: "#6b7280",
                          marginTop: "2px",
                          textAlign: "right",
                          margin: 0,
                        }}
                      >
                        {pct}%
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content: Activity Row */}
      <div
        style={{
          display: "flex",
          gap: "24px",
          marginBottom: "24px",
          alignItems: "stretch",
        }}
      >
        {/* Recent Activity */}
        <div className="dash-card" style={{ flex: 1 }}>
          <div className="dash-card-header">
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 600,
                color: C.text,
                margin: "0 0 4px",
              }}
            >
              Recent Activity
            </h2>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>
              Latest actions in the system
            </p>
          </div>
          <div
            className="dash-card-body"
            style={{ maxHeight: "300px", overflowY: "auto" }}
          >
            {recentActivity.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  color: "#9ca3af",
                  padding: "32px 16px",
                }}
              >
                <TrendingUp
                  size={40}
                  style={{ marginBottom: "8px", opacity: 0.4 }}
                />
                <p style={{ fontSize: "0.9rem", fontWeight: 500 }}>
                  No recent activity
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {recentActivity.map((item) => (
                  <div key={item.id} className="dash-request-item">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "16px",
                          marginBottom: "4px",
                        }}
                      >
                        <h4
                          style={{
                            fontSize: "0.95rem",
                            fontWeight: 600,
                            color: C.text,
                            margin: 0,
                            flex: 1,
                          }}
                        >
                          {item.label}
                        </h4>
                        <span
                          className={
                            item.badge ? `badge-${item.badge}` : "badge-pending"
                          }
                          style={{
                            padding: "4px 8px",
                            borderRadius: "12px",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                          }}
                        >
                          {item.badgeText ?? item.badge ?? "pending"}
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: "0.85rem",
                          color: "#6b7280",
                          marginBottom: "4px",
                        }}
                      >
                        {item.description}
                      </p>
                      <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                        {formatActivityDate(item.date)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pending Words */}
        <div className="dash-card" style={{ width: "280px", minHeight: 0 }}>
          <div className="dash-card-header">
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 600,
                color: C.text,
                margin: "0 0 4px",
              }}
            >
              Pending Reviews
            </h2>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>
              Word submissions awaiting review
            </p>
          </div>
          <div
            className="dash-card-body"
            style={{ maxHeight: "300px", overflowY: "auto" }}
          >
            {pendingWords.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  color: "#9ca3af",
                  padding: "32px 16px",
                }}
              >
                <BookOpen
                  size={40}
                  style={{ marginBottom: "8px", opacity: 0.4 }}
                />
                <p style={{ fontSize: "0.9rem", fontWeight: 500 }}>
                  No pending reviews
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {pendingWords.map((word) => (
                  <div key={word.id} className="dash-request-item">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "16px",
                          marginBottom: "4px",
                        }}
                      >
                        <h4
                          style={{
                            fontSize: "0.95rem",
                            fontWeight: 600,
                            color: C.text,
                            margin: 0,
                            flex: 1,
                          }}
                        >
                          {word.label}
                        </h4>
                        <span
                          className="badge-pending"
                          style={{
                            padding: "4px 8px",
                            borderRadius: "12px",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                          }}
                        >
                          pending
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: "0.85rem",
                          color: "#6b7280",
                          marginBottom: "4px",
                        }}
                      >
                        {word.submitter?.username || "—"} ·{" "}
                        {word.total_samples || 0} samples
                      </p>
                      <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                        {formatActivityDate(
                          word.created_at || word.updated_at || Date.now(),
                        )}
                      </span>
                    </div>
                    <button
                      onClick={() => navigate("/word_bank")}
                      style={{
                        background: "none",
                        border: `2px solid ${C.primary}`,
                        color: C.primary,
                        padding: "4px 12px",
                        borderRadius: "6px",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        cursor: "pointer",
                        transition: "0.3s",
                        fontFamily: "inherit",
                        whiteSpace: "nowrap",
                      }}
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

      {/* Send Announcement */}
      <div className="dash-card" style={{ marginTop: "24px" }}>
        <div className="dash-card-header">
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              color: C.text,
              margin: "0 0 4px",
            }}
          >
            Send Announcement
          </h2>
          <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>
            Broadcast a notification to all active users
          </p>
        </div>
        <div className="dash-card-body">
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  color: "#4b5563",
                  marginBottom: "4px",
                }}
              >
                Title
              </label>
              <input
                type="text"
                value={announcementTitle}
                onChange={(e) => setAnnouncementTitle(e.target.value)}
                placeholder="e.g. Scheduled Maintenance"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  border: `2px solid #e5e7eb`,
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  color: C.text,
                  outline: "none",
                  transition: "border-color 0.3s",
                  fontFamily: "inherit",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.primary;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#e5e7eb";
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  color: "#4b5563",
                  marginBottom: "4px",
                }}
              >
                Message
              </label>
              <textarea
                value={announcementMessage}
                onChange={(e) => setAnnouncementMessage(e.target.value)}
                placeholder="Write your announcement here..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  border: `2px solid #e5e7eb`,
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  color: C.text,
                  outline: "none",
                  transition: "border-color 0.3s",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.primary;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#e5e7eb";
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={handleSendAnnouncement}
                disabled={
                  sending ||
                  !announcementTitle.trim() ||
                  !announcementMessage.trim()
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 20px",
                  background:
                    sending ||
                    !announcementTitle.trim() ||
                    !announcementMessage.trim()
                      ? "#9ca3af"
                      : C.primary,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  cursor:
                    sending ||
                    !announcementTitle.trim() ||
                    !announcementMessage.trim()
                      ? "not-allowed"
                      : "pointer",
                  transition: "0.3s",
                  fontFamily: "inherit",
                }}
              >
                <Send size={16} />
                {sending ? "Sending..." : "Send to All Users"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(Dashboard);
