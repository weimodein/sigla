import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAdministratorStats } from "../../api/administratorApi.js";
import { getWordStats } from "../../api/wordApi.js";
import { getAllModels, getModelStats } from "../../api/modelApi.js";
import { getCategories } from "../../api/categoryApi.js";
import { getActivityLogs } from "../../api/activityLogApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { takeAuthMessage } from "../../utils/authMessage.js";
import { listStagger } from "../../utils/motion.js";
import { StatCard, SkeletonCard } from "../../components/StatCard.jsx";
import { PageHeaderSkeleton, SkeletonBlock } from "../../components/Skeleton.jsx";
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

  // The welcome greeting is parked by Login, which unmounts on navigate and so
  // cannot show it itself. Read-once, so a later visit here stays quiet.
  useEffect(() => {
    const message = takeAuthMessage();
    if (message) toast[message.type]?.(message.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
        <PageHeaderSkeleton />
        {/* Stat cards skeleton — 3-col spanning grid */}
        <div className="dash-hero-grid">
          <div className="dash-hero-tall">
            <div
              className="dash-stat-card list-item-in flex h-full flex-col items-center justify-center gap-3"
              style={listStagger(4)}
              aria-hidden="true"
            >
              <SkeletonBlock className="h-14 w-14 rounded-full" />
              <SkeletonBlock className="h-4 w-32 rounded" />
              <SkeletonBlock className="h-9 w-24 rounded-md" />
            </div>
          </div>
          <SkeletonCard index={0} />
          <SkeletonCard index={1} />
          <SkeletonCard index={2} />
          <SkeletonCard index={3} />
        </div>
        <div className="dash-card">
          <div className="dash-card-header space-y-2">
            <SkeletonBlock className="h-5 w-36 rounded" />
            <SkeletonBlock className="h-3 w-20 rounded" />
          </div>
          <div className="dash-card-body space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-2" aria-hidden="true">
                <div className="flex items-center justify-between gap-3">
                  <SkeletonBlock className="h-4 w-20 rounded" />
                  <SkeletonBlock className="h-4 w-12 rounded" />
                </div>
                <SkeletonBlock className="h-2 rounded-full" style={{ width: `${84 - index * 7}%` }} />
              </div>
            ))}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-header flex items-center gap-3">
            <SkeletonBlock className="h-5 w-5 shrink-0 rounded" />
            <div className="space-y-2">
              <SkeletonBlock className="h-5 w-32 rounded" />
              <SkeletonBlock className="h-3 w-52 rounded" />
            </div>
          </div>
          <div className="dash-card-body space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-lg border border-gray-100 p-4" aria-hidden="true">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <SkeletonBlock className="h-4 w-32 rounded" />
                  <SkeletonBlock className="h-6 w-20 rounded-full" />
                </div>
                <SkeletonBlock className="mb-2 h-3 w-3/4 rounded" />
                <SkeletonBlock className="h-3 w-14 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const deployedModel      = modelStats?.current_model;
  // Newest 8 tested versions, then re-sorted oldest→newest for display: the API
  // returns created_at DESC, so listing it as-is read backwards in time under a
  // "by version" heading. Slicing before the sort keeps this the 8 most RECENT
  // versions rather than the 8 oldest.
  // Words models only. A run also produces an alphabet model sharing the version
  // number, so an unfiltered list showed two "v1.7.0" bars — both flagged
  // deployed, indistinguishable — and the 8-item slice was half spent on
  // duplicates. The alphabet's accuracy is not comparable anyway (98% over 5
  // letters against 81% over 50 words); Manage Model shows it per version.
  const modelsWithAccuracy = (allModels || [])
    .filter((m) => m.accuracy != null && m.model_kind !== "letters")
    .slice(0, 8)
    .sort(
      (a, b) =>
        new Date(a.trained_at || a.created_at || 0) -
        new Date(b.trained_at || b.created_at || 0),
    );

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
        <h1 className="page-title">Admin Dashboard</h1>
        <p className="page-subtitle">Welcome back! Here's what's happening today.</p>
      </div>

      {/* ── Stat cards — 3-col grid, model version spans both rows on the right ── */}
      <div className="dash-hero-grid">
        {/* Col 3, rows 1–2 — placed first so auto-placement fills cols 1–2
            correctly. Placement is in CSS (.dash-hero-tall) so it can unpin at
            narrow widths; see index.css. */}
        <div className="dash-hero-tall">
          {/* Hand-rolled rather than a StatCard: it spans both rows and centres
              its content. It still takes the shared entrance, with an index that
              continues the sequence of the four cards beside it so the grid
              reads as one animation instead of four-plus-one. */}
          <div
            className="dash-stat-card list-item-in h-full flex flex-col items-center justify-center gap-3"
            onClick={() => navigate("/model")}
            style={{ ...listStagger(4), cursor: "pointer" }}
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
          <StatCard index={0} title="Total Administrators" value={userStats?.total} icon={Users} color="bg-blue-900" onClick={() => navigate("/administrators")} />
        ) : (
          <StatCard index={0} title="Account Created" value={formatDate(user?.created_at)} icon={CalendarDays} color="bg-blue-900" />
        )}
        <StatCard index={1} title="Total Words"         value={wordStats?.total}         icon={BookOpen}      color="bg-blue-800"   onClick={() => navigate("/dataset")} />
        <StatCard index={2} title="Gesture Samples"     value={wordStats?.total_samples} icon={Database}      color="bg-blue-700"   onClick={() => navigate("/dataset")} />
        <StatCard index={3} title="Total Categories"    value={categoryCount}            icon={Tag}           color="bg-yellow-500" onClick={() => navigate("/categories")} />
      </div>

      {/* ── Model accuracy by version ── */}
      <div className="dash-card">
        <div className="dash-card-header">
          <h2 className="section-title">Model Accuracy</h2>
          <p className="section-subtitle">By version</p>
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
            <h2 className="section-title">Recent Activity</h2>
            <p className="section-subtitle">Your latest actions in the system</p>
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
              {recentActivity.map((item, i) => (
                <div key={item.id} className="dash-request-item list-item-in" style={listStagger(i)}>
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
