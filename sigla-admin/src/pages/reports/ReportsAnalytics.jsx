import { useState, useEffect } from "react";
import { getUserStats, getAllUsers } from "../../api/userApi.js";
import { getWordStats, getAllWords } from "../../api/wordApi.js";
import { getModelVersions } from "../../api/modelApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Users,
  BookOpen,
  Clock,
  AlertTriangle,
  UserX,
  Trash2,
  Download,
} from "lucide-react";

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

// ── Section Header ────────────────────────────────────────────
const SectionHeader = ({ title, count }) => (
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
    {count !== undefined && (
      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
        {count} total
      </span>
    )}
  </div>
);

// ── Simple Table ──────────────────────────────────────────────
const SimpleTable = ({ headers, rows, emptyMessage }) => (
  <div className="overflow-x-auto rounded-lg border border-gray-200">
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
        <tr>
          {headers.map((h) => (
            <th key={h} className="px-4 py-3">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={headers.length}
              className="text-center py-6 text-gray-400 text-xs"
            >
              {emptyMessage || "No records found"}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr key={i} className="border-t hover:bg-gray-50">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-gray-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

// ── Main Component ────────────────────────────────────────────
const ReportsAnalytics = () => {
  const toast = useToast();
  const [filter, setFilter] = useState("month");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [userStats, setUserStats] = useState(null);
  const [wordStats, setWordStats] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [warnedUsers, setWarnedUsers] = useState([]);
  const [deactivatedUsers, setDeactivatedUsers] = useState([]);
  const [deletedUsers, setDeletedUsers] = useState([]);
  const [words, setWords] = useState([]);
  const [models, setModels] = useState([]);

  const [reportSections, setReportSections] = useState({
    user_stats: true,
    word_submissions: true,
    sample_counts: true,
    registration_trends: true,
    model_accuracy: true,
    warned_users: true,
    deactivated_users: true,
    deleted_users: true,
  });

  const [warnedPage, setWarnedPage] = useState(1);
  const [deactivatedPage, setDeactivatedPage] = useState(1);
  const [deletedPage, setDeletedPage] = useState(1);
  const PAGE_SIZE = 5;

  // ── Fetch ───────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    try {
      const [uStats, wStats, usersData, wordsData] = await Promise.all([
        getUserStats(),
        getWordStats(),
        getAllUsers({ limit: 500 }),
        getAllWords({ limit: 500 }),
      ]);

      setUserStats(uStats);
      setWordStats(wStats);

      const users = usersData.users || [];
      setAllUsers(users);
      setWarnedUsers(users.filter((u) => (u.warning_count || 0) > 0));
      setDeactivatedUsers(users.filter((u) => u.status === "deactivated"));
      setDeletedUsers(users.filter((u) => u.status === "deleted"));
      setWords(wordsData.words || []);

      try {
        const mData = await getModelVersions();
        setModels(mData.models || []);
      } catch {
        setModels([]);
      }
    } catch (err) {
      toast.error("Failed to load reports data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    setWarnedPage(1);
    setDeactivatedPage(1);
    setDeletedPage(1);
  }, [filter]);

  // ── Chart data helpers ──────────────────────────────────────
  const getRegistrationTrend = () => {
    const counts = {};
    allUsers.forEach((u) => {
      const date = new Date(u.created_at);
      let key;
      if (filter === "week")
        key = date.toLocaleDateString("en-PH", { weekday: "short" });
      else if (filter === "month")
        key = date.toLocaleDateString("en-PH", {
          month: "short",
          day: "numeric",
        });
      else
        key = date.toLocaleDateString("en-PH", {
          month: "short",
          year: "numeric",
        });
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).map(([name, users]) => ({ name, users }));
  };

  const getSubmissionTrend = () => {
    const counts = {};
    words.forEach((w) => {
      const date = new Date(w.created_at);
      let key;
      if (filter === "week")
        key = date.toLocaleDateString("en-PH", { weekday: "short" });
      else if (filter === "month")
        key = date.toLocaleDateString("en-PH", {
          month: "short",
          day: "numeric",
        });
      else
        key = date.toLocaleDateString("en-PH", {
          month: "short",
          year: "numeric",
        });
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).map(([name, submissions]) => ({
      name,
      submissions,
    }));
  };

  const getModelAccuracyData = () =>
    models.map((m) => ({
      name: m.version_number,
      accuracy: m.accuracy ? parseFloat((m.accuracy * 100).toFixed(1)) : 0,
    }));

  const getSamplesPerWord = () =>
    words
      .filter((w) => (w.total_samples || 0) > 0)
      .sort((a, b) => (b.total_samples || 0) - (a.total_samples || 0))
      .slice(0, 10)
      .map((w) => ({
        name: w.label.length > 10 ? w.label.slice(0, 10) + "…" : w.label,
        samples: w.total_samples || 0,
        approved: w.approved_sample_count || 0,
      }));

  const toggleSection = (key) =>
    setReportSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Generate CSV report ─────────────────────────────────────
  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const lines = [
        `SIGLA System Report — Filter: ${filter.toUpperCase()}`,
        "",
      ];

      if (reportSections.user_stats) {
        lines.push("=== USER STATISTICS ===");
        lines.push(`Total Users,${userStats?.total ?? 0}`);
        lines.push(`Active,${userStats?.active ?? 0}`);
        lines.push(`Pending,${userStats?.pending ?? 0}`);
        lines.push(`Deactivated,${userStats?.deactivated ?? 0}`);
        lines.push(`Warned,${userStats?.warned ?? 0}`);
        lines.push("");
      }
      if (reportSections.word_submissions) {
        lines.push("=== WORD SUBMISSIONS ===");
        lines.push(`Total Words,${wordStats?.total ?? 0}`);
        lines.push(`Pending,${wordStats?.pending ?? 0}`);
        lines.push(`Approved,${wordStats?.approved ?? 0}`);
        lines.push(`Rejected,${wordStats?.rejected ?? 0}`);
        lines.push("");
      }
      if (reportSections.sample_counts) {
        lines.push("=== GESTURE SAMPLES PER WORD ===");
        lines.push("Word,Total Samples,Approved Samples");
        words.forEach((w) =>
          lines.push(
            `${w.label},${w.total_samples || 0},${w.approved_sample_count || 0}`,
          ),
        );
        lines.push("");
      }
      if (reportSections.registration_trends) {
        lines.push("=== REGISTRATION TRENDS ===");
        lines.push("Period,New Users");
        getRegistrationTrend().forEach((r) =>
          lines.push(`${r.name},${r.users}`),
        );
        lines.push("");
      }
      if (reportSections.model_accuracy) {
        lines.push("=== MODEL ACCURACY PER VERSION ===");
        lines.push("Version,Accuracy");
        models.forEach((m) =>
          lines.push(
            `${m.version_number},${m.accuracy ? (m.accuracy * 100).toFixed(1) + "%" : "N/A"}`,
          ),
        );
        lines.push("");
      }
      if (reportSections.warned_users) {
        lines.push("=== WARNED USERS ===");
        lines.push("Username,Email,Warnings");
        warnedUsers.forEach((u) =>
          lines.push(`${u.username},${u.email},${u.warning_count}/2`),
        );
        lines.push("");
      }
      if (reportSections.deactivated_users) {
        lines.push("=== DEACTIVATED USERS ===");
        lines.push("Username,Email,Deactivated At");
        deactivatedUsers.forEach((u) =>
          lines.push(
            `${u.username},${u.email},${u.deactivated_at ? new Date(u.deactivated_at).toLocaleDateString() : "—"}`,
          ),
        );
        lines.push("");
      }
      if (reportSections.deleted_users) {
        lines.push("=== DELETED USERS ===");
        lines.push("Username,Email");
        deletedUsers.forEach((u) => lines.push(`${u.username},${u.email}`));
        lines.push("");
      }

      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sigla_report_${filter}_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Report downloaded successfully");
    } catch (err) {
      toast.error("Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  // ── Skeleton components ───────────────────────────────────
  const SkeletonCard = () => (
    <div className="bg-white rounded-xl shadow-sm p-5 flex items-center gap-4 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-gray-200" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-20 bg-gray-200 rounded" />
        <div className="h-7 w-16 bg-gray-200 rounded" />
      </div>
    </div>
  );

  const SkeletonChart = () => (
    <div className="bg-white rounded-xl shadow-sm p-5 animate-pulse">
      <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
      <div className="h-[220px] bg-gray-100 rounded" />
    </div>
  );

  const SkeletonTable = () => (
    <div className="bg-white rounded-xl shadow-sm p-5 animate-pulse">
      <div className="h-4 w-28 bg-gray-200 rounded mb-3" />
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <div className="h-10 bg-gray-50" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 border-t px-4 py-3 flex gap-4">
            <div className="h-4 flex-1 bg-gray-100 rounded" />
            <div className="h-4 flex-1 bg-gray-100 rounded" />
            <div className="h-4 w-12 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  );

  // ── JSX ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {["week", "month", "year"].map((f) => (
              <div
                key={f}
                className="w-14 h-7 bg-gray-200 rounded-md animate-pulse"
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonChart key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonTable key={i} />
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5 animate-pulse">
          <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-52 bg-gray-100 rounded mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-4 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            Reports & Analytics
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            System activity overview and data exports
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {["week", "month", "year"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition capitalize ${
                filter === f
                  ? "bg-white text-blue-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
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
          color="bg-green-600"
        />
        <StatCard
          title="Pending Reviews"
          value={wordStats?.pending}
          icon={Clock}
          color="bg-yellow-500"
        />
        <StatCard
          title="Warned Users"
          value={userStats?.warned}
          icon={AlertTriangle}
          color="bg-orange-500"
        />
        <StatCard
          title="Deactivated"
          value={userStats?.deactivated}
          icon={UserX}
          color="bg-red-500"
        />
        <StatCard
          title="Deleted Accounts"
          value={deletedUsers.length}
          icon={Trash2}
          color="bg-gray-600"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <SectionHeader title="User Registration Trend" />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={getRegistrationTrend()}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="users" fill="#1e3a8a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <SectionHeader title="Word Submission Trend" />
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={getSubmissionTrend()}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="submissions"
                stroke="#16a34a"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <SectionHeader title="Model Accuracy per Version" />
          {models.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">
              No model versions available
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={getModelAccuracyData()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip formatter={(v) => `${v}%`} />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <SectionHeader title="Gesture Samples per Word (Top 10)" />
          {words.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">
              No words available
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={getSamplesPerWord()} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fontSize: 11 }}
                  width={65}
                />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="samples"
                  fill="#bfdbfe"
                  radius={[0, 4, 4, 0]}
                  name="Total"
                />
                <Bar
                  dataKey="approved"
                  fill="#1e3a8a"
                  radius={[0, 4, 4, 0]}
                  name="Approved"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* User Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <SectionHeader title="Warned Users" count={warnedUsers.length} />
          <SimpleTable
            headers={["Username", "Email", "Warnings"]}
            rows={warnedUsers
              .slice(
                (warnedPage - 1) * PAGE_SIZE,
                warnedPage * PAGE_SIZE,
              )
              .map((u) => [
                u.username,
                u.email,
                `${u.warning_count}/2`,
              ])}
            emptyMessage="No warned users"
          />
          {warnedUsers.length > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
              <span>
                Page {warnedPage} of{" "}
                {Math.ceil(warnedUsers.length / PAGE_SIZE)}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setWarnedPage((p) => Math.max(1, p - 1))}
                  disabled={warnedPage === 1}
                  className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                >
                  Prev
                </button>
                <button
                  onClick={() =>
                    setWarnedPage((p) =>
                      Math.min(
                        Math.ceil(warnedUsers.length / PAGE_SIZE),
                        p + 1,
                      ),
                    )
                  }
                  disabled={
                    warnedPage >= Math.ceil(warnedUsers.length / PAGE_SIZE)
                  }
                  className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5">
          <SectionHeader
            title="Deactivated Users"
            count={deactivatedUsers.length}
          />
          <SimpleTable
            headers={["Username", "Email", "Since"]}
            rows={deactivatedUsers
              .slice(
                (deactivatedPage - 1) * PAGE_SIZE,
                deactivatedPage * PAGE_SIZE,
              )
              .map((u) => [
                u.username,
                u.email,
                u.deactivated_at
                  ? new Date(u.deactivated_at).toLocaleDateString("en-PH")
                  : "—",
              ])}
            emptyMessage="No deactivated users"
          />
          {deactivatedUsers.length > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
              <span>
                Page {deactivatedPage} of{" "}
                {Math.ceil(deactivatedUsers.length / PAGE_SIZE)}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() =>
                    setDeactivatedPage((p) => Math.max(1, p - 1))
                  }
                  disabled={deactivatedPage === 1}
                  className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                >
                  Prev
                </button>
                <button
                  onClick={() =>
                    setDeactivatedPage((p) =>
                      Math.min(
                        Math.ceil(deactivatedUsers.length / PAGE_SIZE),
                        p + 1,
                      ),
                    )
                  }
                  disabled={
                    deactivatedPage >=
                    Math.ceil(deactivatedUsers.length / PAGE_SIZE)
                  }
                  className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5">
          <SectionHeader title="Deleted Accounts" count={deletedUsers.length} />
          <SimpleTable
            headers={["Username", "Email"]}
            rows={deletedUsers
              .slice(
                (deletedPage - 1) * PAGE_SIZE,
                deletedPage * PAGE_SIZE,
              )
              .map((u) => [u.username, u.email])}
            emptyMessage="No deleted accounts"
          />
          {deletedUsers.length > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
              <span>
                Page {deletedPage} of{" "}
                {Math.ceil(deletedUsers.length / PAGE_SIZE)}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setDeletedPage((p) => Math.max(1, p - 1))}
                  disabled={deletedPage === 1}
                  className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                >
                  Prev
                </button>
                <button
                  onClick={() =>
                    setDeletedPage((p) =>
                      Math.min(
                        Math.ceil(deletedUsers.length / PAGE_SIZE),
                        p + 1,
                      ),
                    )
                  }
                  disabled={
                    deletedPage >=
                    Math.ceil(deletedUsers.length / PAGE_SIZE)
                  }
                  className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Generate Report */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Generate Report
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Select sections to include in the exported CSV
            </p>
          </div>
          <button
            onClick={handleGenerateReport}
            disabled={
              generating || !Object.values(reportSections).some(Boolean)
            }
            className="flex items-center gap-2 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
          >
            <Download size={16} />
            {generating ? "Generating..." : "Generate Report"}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { key: "user_stats", label: "User Statistics" },
            { key: "word_submissions", label: "Word Submissions" },
            { key: "sample_counts", label: "Sample Counts" },
            { key: "registration_trends", label: "Registration Trends" },
            { key: "model_accuracy", label: "Model Accuracy" },
            { key: "warned_users", label: "Warned Users" },
            { key: "deactivated_users", label: "Deactivated Users" },
            { key: "deleted_users", label: "Deleted Accounts" },
          ].map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={reportSections[key]}
                onChange={() => toggleSection(key)}
                className="w-4 h-4 accent-blue-900 cursor-pointer"
              />
              <span className="text-xs text-gray-600 group-hover:text-gray-800">
                {label}
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Filtered by:{" "}
          <strong className="text-gray-600 capitalize">{filter}</strong>
          {" · "}Exported as CSV
        </p>
      </div>
    </div>
  );
};

export default ReportsAnalytics;
