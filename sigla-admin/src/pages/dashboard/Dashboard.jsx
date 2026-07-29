import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAdministratorStats } from "../../api/administratorApi.js";
import { getWordStats } from "../../api/wordApi.js";
import { getAllModels, getModelStats } from "../../api/modelApi.js";
import { getCategories } from "../../api/categoryApi.js";
import { getActivityLogs } from "../../api/activityLogApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import {
  Users,
  BookOpen,
  Cpu,
  Tag,
  Database,
  Activity,
  CalendarDays,
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

// Humanize an audit-log action key, e.g. "deployed_model" -> "Deployed Model"
const humanizeAction = (a) =>
  (a || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Format an account creation date for the admin summary card
const formatDate = (dateStr) =>
  dateStr
    ? new Date(dateStr).toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

// ── Stat Card ── colored icon circle (left) + label + value, matching the
// Manage Administrators cards.
const StatCard = ({ title, value, icon: Icon, color, onClick }) => (
  <div
    className="dash-stat-card flex items-center gap-4 min-w-0"
    onClick={onClick}
    style={onClick ? { cursor: "pointer" } : undefined}
  >
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

// ── Activity badge ── colour-coded by the audit action's intent
const ActivityBadge = ({ action }) => {
  const a = action || "";
  let cls = "bg-gray-100 text-gray-600";
  if (/(approved|deployed|created|added|activated|reactivated|signed_in)/.test(a))
    cls = "bg-green-100 text-green-700";
  else if (/(rejected|deleted|deactivated|reverted)/.test(a))
    cls = "bg-red-100 text-red-700";
  else if (/(updated|tested|trained|uploaded)/.test(a))
    cls = "bg-blue-100 text-blue-700";
  return (
    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${cls}`}>
      {humanizeAction(a)}
    </span>
  );
};

// ── Dashboard ──
const Dashboard = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isSuper } = useAuth();

  const [userStats, setUserStats]   = useState(null);
  const [wordStats, setWordStats]   = useState(null);
  const [modelStats, setModelStats] = useState(null);
  const [allModels, setAllModels]   = useState([]);
  const [myActivity, setMyActivity] = useState([]);
  const [categoryCount, setCategoryCount] = useState(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [users, words, models, modelsAll, cats, activity] = await Promise.all([
          getAdministratorStats(),
          getWordStats(),
          getModelStats(),
          getAllModels(),
          getCategories(),
          getActivityLogs({ mine: true, limit: 10 }),
        ]);
        setUserStats(users);
        setWordStats(words);
        setModelStats(models);
        setAllModels(modelsAll.models || []);
        setCategoryCount((cats.categories || []).length);
        setMyActivity(activity.logs || []);
      } catch {
        toast.error("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [toast]);

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

  // Recent activity = the logged-in account's own audit-log entries
  const recentActivity = (myActivity || []).map((log) => ({
    id: log.id,
    action: log.action,
    label: humanizeAction(log.action),
    description: log.details || "—",
    date: log.created_at,
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
          <div
            className="dash-stat-card h-full flex flex-col items-center justify-center gap-3"
            onClick={() => navigate("/model")}
            style={{ cursor: "pointer" }}
          >
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
        {/* First card differs by account type (scope): super → total admins, admin → own account creation date */}
        {isSuper ? (
          <StatCard title="Total Administrators" value={userStats?.total} icon={Users} color="bg-blue-900" onClick={() => navigate("/administrators")} />
        ) : (
          <StatCard title="Account Created" value={formatDate(user?.created_at)} icon={CalendarDays} color="bg-blue-900" />
        )}
        <StatCard title="Total Words"         value={wordStats?.total}         icon={BookOpen}      color="bg-blue-800"   onClick={() => navigate("/dataset")} />
        <StatCard title="Gesture Samples"     value={wordStats?.total_samples} icon={Database}      color="bg-blue-700"   onClick={() => navigate("/dataset")} />
        <StatCard title="Total Categories"    value={categoryCount}            icon={Tag}           color="bg-yellow-500" onClick={() => navigate("/categories")} />
      </div>

      {/* ── Model accuracy by version ── */}
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

      {/* ── Recent activity ── */}
      <div className="dash-card">
        <div className="dash-card-header flex items-center gap-2">
          <Activity size={18} className="text-gray-400 shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Recent Activity</h2>
            <p className="text-sm text-gray-500 mt-0.5">Your latest actions in the system</p>
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
                      <ActivityBadge action={item.action} />
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

    </div>
  );
};

export default React.memo(Dashboard);
