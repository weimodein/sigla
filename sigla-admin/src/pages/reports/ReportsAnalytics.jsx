import { useState, useEffect, useMemo, memo } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useNavigate } from "react-router-dom";
import { getAdministratorStats, getAllAdministrators } from "../../api/administratorApi.js";
import { getWordStats, getAllWords } from "../../api/wordApi.js";
import { getModelVersions } from "../../api/modelApi.js";
import { getCategories } from "../../api/categoryApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
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
  BookOpen,
  Database,
  Tag,
  Cpu,
  Download,
} from "lucide-react";

// ── Stat Card ─────────────────────────────────────────────────
const StatCard = ({ title, value, icon: Icon, color, onClick }) => (
  <div
    className="dash-stat-card flex items-center gap-4"
    onClick={onClick}
    style={onClick ? { cursor: "pointer" } : undefined}
  >
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
  const navigate = useNavigate();
  const { isSuper } = useAuth();
  const [filter, setFilter] = useState("month");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [userStats, setUserStats] = useState(null);
  const [wordStats, setWordStats] = useState(null);
  const [deactivatedUsers, setDeactivatedUsers] = useState([]);
  const [deletedUsers, setDeletedUsers] = useState([]);
  const [words, setWords] = useState([]);
  const [models, setModels] = useState([]);
  const [categoryCount, setCategoryCount] = useState(null);

  // Report sections per scope §20: word statistics, gesture sample counts, model accuracy.
  const [reportSections, setReportSections] = useState({
    word_stats: true,
    sample_counts: true,
    model_accuracy: true,
  });

  const [deactivatedPage, setDeactivatedPage] = useState(1);
  const [deletedPage, setDeletedPage] = useState(1);
  const PAGE_SIZE = 5;

  // ── Fetch ───────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    try {
      // The admin roster (GET /administrators) is super-only. Regular admins skip it
      // and simply don't see the per-admin deactivated/deleted tables.
      const [uStats, wStats, usersData, wordsData, catsData] = await Promise.all([
        getAdministratorStats(),
        getWordStats(),
        isSuper ? getAllAdministrators({ limit: 500 }) : Promise.resolve({ administrators: [] }),
        getAllWords({ limit: 500 }),
        getCategories(),
      ]);

      setUserStats(uStats);
      setWordStats(wStats);
      setCategoryCount((catsData.categories || []).length);

      const users = usersData.administrators || [];
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
    setDeactivatedPage(1);
    setDeletedPage(1);
  }, [filter, isSuper]);

  // ── Chart data helpers ──────────────────────────────────────
  const submissionTrend = useMemo(() => {
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
  }, [words, filter]);

  const modelAccuracyData = useMemo(
    () =>
      models.map((m) => ({
        name: m.version_number,
        accuracy: m.accuracy ? parseFloat((m.accuracy * 100).toFixed(1)) : 0,
      })),
    [models]
  );

  const samplesPerWord = useMemo(
    () =>
      words
        .filter((w) => (w.total_samples || 0) > 0)
        .sort((a, b) => (b.total_samples || 0) - (a.total_samples || 0))
        .slice(0, 10)
        .map((w) => ({
          name: w.label.length > 10 ? w.label.slice(0, 10) + "…" : w.label,
          samples: w.total_samples || 0,
          approved: w.approved_sample_count || 0,
        })),
    [words]
  );

  // Current model accuracy = the deployed model's accuracy (fallback: best model)
  const currentModelAccuracy = useMemo(() => {
    if (!models.length) return "—";
    const deployed = models.find((m) => m.status === "deployed");
    const best = [...models].sort((a, b) => (b.accuracy || 0) - (a.accuracy || 0))[0];
    const m = deployed || best;
    return m?.accuracy != null ? `${(m.accuracy * 100).toFixed(1)}%` : "—";
  }, [models]);

  const toggleSection = (key) =>
    setReportSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Generate PDF report ─────────────────────────────────────
  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const doc = new jsPDF();
      const dateStr = new Date().toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      });
      const filterLabel = filter.charAt(0).toUpperCase() + filter.slice(1);

      // ── Header ───────────────────────────────────────────────
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("SigLa System Report", 14, 20);
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text(`Filter: ${filterLabel}   |   Generated: ${dateStr}`, 14, 28);
      doc.setLineWidth(0.5);
      doc.line(14, 32, 196, 32);

      let y = 40;
      const sectionGap = 10;

      const addSectionTitle = (title) => {
        if (y > 265) { doc.addPage(); y = 20; }
        doc.setFontSize(13);
        doc.setFont("helvetica", "bold");
        doc.text(title, 14, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
      };

      if (reportSections.word_stats) {
        addSectionTitle("Word Statistics");
        autoTable(doc, {
          startY: y,
          head: [["Metric", "Count"]],
          body: [
            ["Total Words", wordStats?.total ?? 0],
            ["Active Words", wordStats?.active ?? 0],
            ["Total Categories", categoryCount ?? 0],
            ["Total Gesture Samples", wordStats?.total_samples ?? 0],
          ],
          theme: "striped",
          headStyles: { fillColor: [59, 130, 246] },
          margin: { left: 14, right: 14 },
        });
        y = doc.lastAutoTable.finalY + sectionGap;
      }

      if (reportSections.sample_counts) {
        addSectionTitle("Gesture Samples per Word");
        autoTable(doc, {
          startY: y,
          head: [["Word", "Total Samples", "Approved Samples"]],
          body: words.map((w) => [w.label, w.total_samples || 0, w.approved_sample_count || 0]),
          theme: "striped",
          headStyles: { fillColor: [59, 130, 246] },
          margin: { left: 14, right: 14 },
        });
        y = doc.lastAutoTable.finalY + sectionGap;
      }

      if (reportSections.model_accuracy) {
        addSectionTitle("Model Accuracy per Version");
        autoTable(doc, {
          startY: y,
          head: [["Version", "Accuracy", "Status"]],
          body: models.map((m) => [
            m.version_number,
            m.accuracy ? `${(m.accuracy * 100).toFixed(1)}%` : "N/A",
            m.status === "deployed" ? "Deployed" : (m.status || "—"),
          ]),
          theme: "striped",
          headStyles: { fillColor: [59, 130, 246] },
          margin: { left: 14, right: 14 },
        });
        y = doc.lastAutoTable.finalY + sectionGap;
      }

      const filename = `sigla_report_${filter}_${new Date().toISOString().split("T")[0]}.pdf`;
      doc.save(filename);
      toast.success("Report downloaded successfully");
    } catch (err) {
      toast.error("Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  // ── Skeleton components ───────────────────────────────────
  const SkeletonCard = () => (
    <div className="dash-stat-card flex items-center gap-4 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-gray-200" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-20 bg-gray-200 rounded" />
        <div className="h-7 w-16 bg-gray-200 rounded" />
      </div>
    </div>
  );

  const SkeletonChart = () => (
    <div className="dash-card animate-pulse">
      <div className="dash-card-header">
        <div className="h-4 w-32 bg-gray-200 rounded" />
      </div>
      <div className="dash-card-body">
        <div className="h-[220px] bg-gray-100 rounded" />
      </div>
    </div>
  );

  const SkeletonTable = () => (
    <div className="dash-card animate-pulse">
      <div className="dash-card-header">
        <div className="h-4 w-28 bg-gray-200 rounded" />
      </div>
      <div className="rounded-lg border border-gray-200 overflow-hidden mx-6 mb-6">
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
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonChart key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonTable key={i} />
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5 animate-pulse">
          <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-52 bg-gray-100 rounded mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1f2937", margin: 0 }}>
            Reports & Analytics
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: 4 }}>
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

      {/* Summary Cards (scope §20): words, gesture samples, categories, model accuracy */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Words"
          value={wordStats?.total}
          icon={BookOpen}
          color="bg-blue-900"
          onClick={() => navigate("/dataset")}
        />
        <StatCard
          title="Gesture Samples"
          value={wordStats?.total_samples}
          icon={Database}
          color="bg-blue-700"
          onClick={() => navigate("/dataset")}
        />
        <StatCard
          title="Total Categories"
          value={categoryCount}
          icon={Tag}
          color="bg-green-600"
          onClick={() => navigate("/categories")}
        />
        <StatCard
          title="Current Model Accuracy"
          value={currentModelAccuracy}
          icon={Cpu}
          color="bg-purple-600"
          onClick={() => navigate("/model")}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="dash-card">
          <div className="dash-card-header">
            <SectionHeader title="Word Submission Trend" />
          </div>
          <div className="dash-card-body">
            <ResponsiveContainer width="100%" height={220} debounce={200}>
              <LineChart data={submissionTrend}>
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
        </div>

        <div className="dash-card">
          <div className="dash-card-header">
            <SectionHeader title="Model Accuracy per Version" />
          </div>
          <div className="dash-card-body">
            {models.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-10">
                No model versions available
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220} debounce={200}>
                <LineChart data={modelAccuracyData}>
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
        </div>

        <div className="dash-card lg:col-span-2">
          <div className="dash-card-header">
            <SectionHeader title="Gesture Samples per Word (Top 10)" />
          </div>
          <div className="dash-card-body">
            {words.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-10">
                No words available
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220} debounce={200}>
                <BarChart data={samplesPerWord} layout="vertical">
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
      </div>

      {/* Administrator Lists — super admin only (per-admin data from /users) */}
      {isSuper && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="dash-card">
          <div className="dash-card-header">
            <SectionHeader
              title="Deactivated Administrators"
              count={deactivatedUsers.length}
            />
          </div>
          <div className="dash-card-body">
            <SimpleTable
              headers={["Username", "Email", "Since"]}
              rows={deactivatedUsers
                .slice(
                  (deactivatedPage - 1) * PAGE_SIZE,
                  deactivatedPage * PAGE_SIZE,
                )
                .map((u) => [
                  u.username,
                  u.email || "—",
                  u.deactivated_at
                    ? new Date(u.deactivated_at).toLocaleDateString("en-PH")
                    : "—",
                ])}
              emptyMessage="No deactivated administrators"
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
        </div>
        <div className="dash-card">
          <div className="dash-card-header">
            <SectionHeader title="Deleted Accounts" count={deletedUsers.length} />
          </div>
          <div className="dash-card-body">
            <SimpleTable
              headers={["Username", "Email"]}
              rows={deletedUsers
                .slice(
                  (deletedPage - 1) * PAGE_SIZE,
                  deletedPage * PAGE_SIZE,
                )
                .map((u) => [u.username, u.email || "—"])}
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
      </div>
      )}

      {/* Generate Report */}
      <div className="dash-card">
        <div className="dash-card-header flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Generate Report
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Select sections to include in the exported PDF
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
        <div className="dash-card-body">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { key: "word_stats", label: "Word Statistics" },
              { key: "sample_counts", label: "Gesture Sample Counts" },
              { key: "model_accuracy", label: "Model Accuracy" },
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
            {" · "}Exported as PDF
          </p>
        </div>
      </div>
    </div>
  );
};

export default memo(ReportsAnalytics);
