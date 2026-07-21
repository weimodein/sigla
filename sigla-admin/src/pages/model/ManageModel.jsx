import { useState, useEffect, useRef } from "react";
import AppModal from "../../components/AppModal.jsx";
import {
  getAllModels,
  getModelStats,
  trainModel,
  getModelStatus,
  testModel,
  deployModel,
  revertModel,
  deleteModel,
} from "../../api/modelApi.js";
import { getWordStats } from "../../api/wordApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import {
  Cpu,
  CheckCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

// ── Color Palette ──
const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
  muted: "#9ca3af",
  border: "#e5e7eb",
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
  orange: "#f97316",
};

// ── Stat Card ─────────────────────────────────────────────────
const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="dash-stat-card flex items-center gap-4">
    <div className={`p-3 rounded-full ${color}`}>
      <Icon size={20} className="text-white" />
    </div>
    <div>
      <p className="text-xs text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value ?? "—"}</p>
    </div>
  </div>
);

// ── Skeleton Components ───────────────────────────────────────
const SkeletonCard = () => (
  <div className="dash-stat-card flex items-center gap-4">
    <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
      <div className="h-7 w-10 bg-gray-200 rounded animate-pulse" />
    </div>
  </div>
);

// ── Badge ─────────────────────────────────────────────────────
const Badge = ({ value }) => {
  const map = {
    deployed: "#16a34a",
    trained: "#d97706",
    inactive: "#6b7280",
  };
  const bg = map[value] || C.muted;
  return (
    <span
      className="px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: bg + "18", color: bg }}
    >
      {value}
    </span>
  );
};

// ── MetricBox (for expanded row) ──────────────────────────────
const MetricBox = ({ label, value, color }) => (
  <div style={{ background: "#f3f4f6", borderRadius: "8px", padding: "12px" }}>
    <p className="text-xs" style={{ color: "#6b7280" }}>
      {label}
    </p>
    <p className="text-lg font-bold" style={{ color }}>
      {value}
    </p>
  </div>
);

// ── SortableHeader ────────────────────────────────────────────
const SortableHeader = ({ label, sortKey, sortField, sortDir, onSort }) => {
  const active = sortField === sortKey;
  return (
    <th
      className="px-4 py-3 cursor-pointer select-none hover:bg-gray-100"
      style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6b7280" }}
      onClick={() => onSort && onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp size={14} className="text-blue-900" />
          ) : (
            <ChevronDown size={14} className="text-blue-900" />
          )
        ) : (
          <ChevronUp size={14} className="opacity-20" />
        )}
      </div>
    </th>
  );
};


// ── Main Component ────────────────────────────────────────────
const ManageModel = () => {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [wordStats, setWordStats] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Sorting
  const [sortField, setSortField] = useState("trained_at");
  const [sortDir, setSortDir] = useState("desc");

  // Modal state
  const [trainModal, setTrainModal] = useState(false);
  const [testModal, setTestModal] = useState(null);
  const [deployModal, setDeployModal] = useState(null);
  const [revertModal, setRevertModal] = useState(null);
  const [resultModal, setResultModal] = useState(null);

  // Train form
  const [trainForm, setTrainForm] = useState({ version_number: "", notes: "" });

  // Async training poll state
  const [trainingModelId, setTrainingModelId] = useState(null);
  const [trainingVersion, setTrainingVersion] = useState("");
  const pollingRef = useRef(null);

  // ── Fetch data ──────────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsData, modelsData, wordStatsData] = await Promise.all([
        getModelStats(),
        getAllModels(),
        getWordStats(),
      ]);
      setStats(statsData);
      setModels(modelsData.models || []);
      setWordStats(wordStatsData);
    } catch (err) {
      toast.error("Failed to load model data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Poll training status every 5 seconds when a training job is in progress
  useEffect(() => {
    if (!trainingModelId) return;
    pollingRef.current = setInterval(async () => {
      try {
        const { model } = await getModelStatus(trainingModelId);
        if (model.status === "trained") {
          clearInterval(pollingRef.current);
          setTrainingModelId(null);
          setTrainingVersion("");
          showSuccess(`Model ${model.version_number} trained successfully`);
          const trainedNote = `Model trained on ${model.total_classes ?? "—"} gesture class(es).`;
          setResultModal({ title: "Training Results", data: { message: trainedNote, model } });
          fetchData();
        } else if (model.status === "failed") {
          clearInterval(pollingRef.current);
          setTrainingModelId(null);
          setTrainingVersion("");
          showError(`Training failed: ${model.training_error || "Unknown error"}`);
          fetchData();
        }
      } catch {
        // Network hiccup — keep polling
      }
    }, 5000);
    return () => clearInterval(pollingRef.current);
  }, [trainingModelId]);

  // ── Sort ────────────────────────────────────────────────────
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortedModels = [...models].sort((a, b) => {
    let va = a[sortField] ?? "";
    let vb = b[sortField] ?? "";
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // ── Search filter ───────────────────────────────────────────
  const filteredModels = searchTerm
    ? sortedModels.filter(
        (m) =>
          m.version_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
          m.trainer?.username?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : [...sortedModels];

  // ── Paginate ────────────────────────────────────────────────
  const totalPages = Math.ceil(filteredModels.length / pageSize);
  const paginatedModels = filteredModels.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  // ── Actions ─────────────────────────────────────────────────
  const showSuccess = (msg) => toast.success(msg);
  const showError = (msg) => toast.error(msg);

  // ── Train ─────────────────────────────────────────────────
  const handleTrain = async () => {
    if (!trainForm.version_number) {
      showError("Version number is required");
      return;
    }
    if (!/^[a-zA-Z0-9._\-]+$/.test(trainForm.version_number)) {
      showError("Version number can only contain letters, numbers, dots, dashes, and underscores (e.g. v1.0, v2.1-beta)");
      return;
    }
    setActionLoading(true);
    try {
      const result = await trainModel(trainForm.version_number, trainForm.notes);
      // Backend returns 202 — training is running in background, start polling
      setTrainingModelId(result.model.id);
      setTrainingVersion(result.model.version_number);
      setTrainModal(false);
      setTrainForm({ version_number: "", notes: "" });
      fetchData();
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.detail ||
          "Training failed",
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ── Test ──────────────────────────────────────────────────
  const handleTest = async () => {
    setActionLoading(true);
    try {
      const result = await testModel(testModal.id);
      showSuccess("Model evaluation complete");
      setTestModal(null);
      setResultModal({ title: "Test Results", data: result });
      fetchData();
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.detail ||
          "Test failed",
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ── Deploy ────────────────────────────────────────────────
  const handleDeploy = async () => {
    setActionLoading(true);
    try {
      await deployModel(deployModal.id);
      showSuccess(`Model ${deployModal.version_number} deployed successfully`);
      setDeployModal(null);
      fetchData();
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.detail ||
          "Deployment failed",
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ── Revert ────────────────────────────────────────────────
  const handleRevert = async () => {
    setActionLoading(true);
    try {
      await revertModel(revertModal.id);
      showSuccess(`Reverted to model ${revertModal.version_number}`);
      setRevertModal(null);
      fetchData();
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.detail ||
          "Revert failed",
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────
  const handleDelete = async (model) => {
    if (
      !window.confirm(
        `Delete model ${model.version_number}? This cannot be undone.`,
      )
    )
      return;
    setActionLoading(true);
    try {
      await deleteModel(model.id);
      showSuccess("Model deleted successfully");
      fetchData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to delete model");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Format metric ─────────────────────────────────────────
  const fmt = (val) => (val != null ? `${(val * 100).toFixed(1)}%` : "—");

  // ── Format metric (for inline use) ──────────────────────────
  const getMetricColor = (val) => {
    if (val == null) return "#9ca3af";
    const pct = val * 100;
    if (pct >= 80) return "#16a34a";
    if (pct >= 60) return "#ca8a04";
    return "#dc2626";
  };

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div
        style={{
          marginBottom: "24px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: C.text,
              margin: 0,
            }}
          >
            Manage Model
          </h1>
          <p
            style={{
              fontSize: "0.9rem",
              color: "#6b7280",
              margin: "4px 0 0",
            }}
          >
            Train, test, and deploy sign language models
          </p>
        </div>
        <button
          onClick={() => setTrainModal(true)}
          disabled={!!trainingModelId}
          className="bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          title={trainingModelId ? "Training in progress…" : undefined}
        >
          + Train New Model
        </button>
      </div>

      {/* Training in progress banner */}
      {trainingModelId && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-800">
              Training <span className="font-mono">{trainingVersion}</span> in progress…
            </p>
            <p className="text-xs text-blue-500">This may take several minutes. You can safely navigate away — this page will update automatically.</p>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <StatCard
            title="Total Versions"
            value={stats?.total}
            icon={Cpu}
            color="bg-blue-900"
          />
          <StatCard
            title="Deployed"
            value={stats?.deployed}
            icon={CheckCircle}
            color="bg-green-500"
          />
          <StatCard
            title="Trained (pending)"
            value={stats?.trained}
            icon={Clock}
            color="bg-yellow-500"
          />
        </div>
      )}

      {/* Current Deployed Model */}
      {stats?.current_model && (
        <div
          style={{
            background: `linear-gradient(135deg, ${C.primary}, ${C.secondary})`,
            borderRadius: "12px",
            padding: "20px 24px",
            marginBottom: "20px",
            color: "#fff",
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            Currently Deployed
          </p>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-4"
            style={{ fontSize: "0.9rem" }}
          >
            <div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Version
              </p>
              <p className="font-bold text-lg">
                {stats.current_model.version_number}
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Accuracy
              </p>
              <p className="font-semibold">
                {fmt(stats.current_model.accuracy)}
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Classes
              </p>
              <p className="font-semibold">
                {stats.current_model.total_classes ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Deployed At
              </p>
              <p className="font-semibold">
                {stats.current_model.deployed_at
                  ? new Date(
                      stats.current_model.deployed_at,
                    ).toLocaleDateString()
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Models Table ────────────────────────────────────────── */}
      <div className="dash-card">
        <div
          className="dash-card-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <h3
            className="text-base font-semibold text-gray-800"
            style={{ margin: 0 }}
          >
            All Model Versions
          </h3>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            {/* Search */}
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              placeholder="Search models..."
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              style={{ width: "180px" }}
            />
            <span className="text-xs text-gray-500">
              {filteredModels.length} version
              {filteredModels.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {loading ? (
          <table className="w-full text-left">
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                <th className="px-4 py-3">
                  <span className="text-xs font-semibold text-gray-500">
                    Version
                  </span>
                </th>
                <th className="px-4 py-3">
                  <span className="text-xs font-semibold text-gray-500">
                    Status
                  </span>
                </th>
                <th className="px-4 py-3">
                  <span className="text-xs font-semibold text-gray-500">
                    Accuracy
                  </span>
                </th>
                <th className="px-4 py-3">
                  <span className="text-xs font-semibold text-gray-500">
                    Classes
                  </span>
                </th>
                <th className="px-4 py-3">
                  <span className="text-xs font-semibold text-gray-500">
                    Trained By
                  </span>
                </th>
                <th className="px-4 py-3">
                  <span className="text-xs font-semibold text-gray-500">
                    Trained At
                  </span>
                </th>
                <th className="px-4 py-3">
                  <span className="text-xs font-semibold text-gray-500">
                    Actions
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t">
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-gray-200 rounded animate-pulse w-2/3" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            {/* Table header row */}
            <table className="w-full text-left">
              <thead style={{ background: "#f9fafb" }}>
                <tr>
                  <th className="px-4 py-3" style={{ width: "36px" }} />
                  <SortableHeader label="Version" sortKey="version_number" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Status" sortKey="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Accuracy" sortKey="accuracy" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500">
                    Trained By
                  </th>
                  <SortableHeader label="Trained At" sortKey="trained_at" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <th
                    className="px-4 py-3"
                    style={{ minWidth: "160px" }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedModels.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="text-center py-10"
                      style={{ color: C.muted, fontSize: "0.85rem" }}
                    >
                      {searchTerm
                        ? "No models match your search."
                        : "No models found. Train your first model to get started."}
                    </td>
                  </tr>
                ) : (
                  paginatedModels.map((model) => (
                    <>
                      {/* Main row */}
                      <tr
                        key={model.id}
                        className="border-t hover:bg-gray-50 text-sm"
                        style={{
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          setExpandedRow(
                            expandedRow === model.id ? null : model.id,
                          )
                        }
                      >
                        <td className="px-4 py-3">
                          <ChevronDown
                            size={16}
                            className={`transition-transform duration-200 ${
                              expandedRow === model.id ? "rotate-180" : ""
                            }`}
                            style={{ color: C.muted }}
                          />
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800">
                          {model.version_number}
                        </td>
                        <td className="px-4 py-3">
                          <Badge value={model.status} />
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <span style={{ color: getMetricColor(model.accuracy) }}>
                            {fmt(model.accuracy)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {model.trainer?.username || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {model.trained_at
                            ? new Date(model.trained_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td
                          className="px-4 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex gap-1.5 flex-wrap">
                            {model.status === "trained" && (
                              <>
                                <button
                                  onClick={() => setTestModal(model)}
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition"
                                  style={{
                                    background: "#fde68a",
                                    color: "#92400e",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                      "#fcd34d")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background =
                                      "#fde68a")
                                  }
                                >
                                  Test
                                </button>
                                <button
                                  onClick={() => setDeployModal(model)}
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition"
                                  style={{
                                    background: "#bbf7d0",
                                    color: "#14532d",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                      "#86efac")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background =
                                      "#bbf7d0")
                                  }
                                >
                                  Deploy
                                </button>
                                <button
                                  onClick={() => handleDelete(model)}
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition"
                                  style={{
                                    background: "#fecaca",
                                    color: "#991b1b",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                      "#fca5a5")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background =
                                      "#fecaca")
                                  }
                                >
                                  Delete
                                </button>
                              </>
                            )}
                            {model.status === "inactive" && (
                              <>
                                <button
                                  onClick={() => setRevertModal(model)}
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition"
                                  style={{
                                    background: "#bfdbfe",
                                    color: "#1e3a8a",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                      "#93c5fd")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background =
                                      "#bfdbfe")
                                  }
                                >
                                  Revert
                                </button>
                                <button
                                  onClick={() => handleDelete(model)}
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition"
                                  style={{
                                    background: "#fecaca",
                                    color: "#991b1b",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                      "#fca5a5")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background =
                                      "#fecaca")
                                  }
                                >
                                  Delete
                                </button>
                              </>
                            )}
                            {model.status === "deployed" && (
                              <span
                                className="text-xs font-medium px-3 py-1.5 rounded-full"
                                style={{
                                  background: "#bbf7d0",
                                  color: "#16a34a",
                                }}
                              >
                                Currently Active
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded details row */}
                      {expandedRow === model.id && (
                        <tr
                          style={{ background: "#fafafa" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <td colSpan={4} className="px-4 py-4">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                              <MetricBox
                                label="Total Classes"
                                value={model.total_classes ?? "—"}
                                color={C.text}
                              />
                            </div>
                            {model.notes && (
                              <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
                                <p className="text-xs font-medium text-gray-500 mb-1">
                                  Notes
                                </p>
                                <p className="text-sm text-gray-600">{model.notes}</p>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {filteredModels.length > pageSize && (
              <div
                className="dash-card-footer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "0.8rem",
                  color: "#6b7280",
                  paddingTop: "12px",
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>
                    {filteredModels.length} result
                    {filteredModels.length !== 1 ? "s" : ""}
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-900"
                  >
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="text-xs">
                    {page} / {totalPages || 1}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Train Modal */}
      {trainModal && (
        <AppModal title="Train New Model" onClose={() => setTrainModal(false)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              This will fetch all approved gesture samples from Supabase and
              train a new model. Training may take several minutes.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Version Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={trainForm.version_number}
                onChange={(e) =>
                  setTrainForm({ ...trainForm, version_number: e.target.value.replace(/[^a-zA-Z0-9._\-]/g, "") })
                }
                placeholder="e.g. v1.0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
              <p className="text-xs text-gray-400 mt-1">
                Only letters, numbers, dots, dashes, and underscores allowed (e.g. v1.0, v2.1-beta).
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Notes (optional)
              </label>
              <textarea
                value={trainForm.notes}
                onChange={(e) =>
                  setTrainForm({ ...trainForm, notes: e.target.value })
                }
                rows={3}
                placeholder="Describe what changed in this version..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleTrain}
                disabled={actionLoading}
                className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading
                  ? "Training... (this may take a while)"
                  : "Start Training"}
              </button>
              <button
                onClick={() => setTrainModal(false)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {/* Test Modal */}
      {testModal && (
        <AppModal
          title={`Test Model: ${testModal.version_number}`}
          onClose={() => setTestModal(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              This will evaluate <strong>{testModal.version_number}</strong>{" "}
              against the approved dataset and return accuracy metrics.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleTest}
                disabled={actionLoading}
                className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Evaluating..." : "Run Evaluation"}
              </button>
              <button
                onClick={() => setTestModal(null)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {/* Deploy Modal */}
      {deployModal && (
        <AppModal
          title={`Deploy Model: ${deployModal.version_number}`}
          onClose={() => setDeployModal(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Deploying <strong>{deployModal.version_number}</strong> will make
              it the active model. All users will be notified to update.
            </p>
            {stats?.current_model && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
                Current deployed model{" "}
                <strong>{stats.current_model.version_number}</strong> will
                become inactive.
              </div>
            )}
            {wordStats?.ready_to_activate > 0 && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700">
                <strong>{wordStats.ready_to_activate}</strong> word{wordStats.ready_to_activate !== 1 ? "s" : ""} with
                enough approved samples will become visible in the mobile app after this deploy.
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleDeploy}
                disabled={actionLoading}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Deploying..." : "Confirm Deploy"}
              </button>
              <button
                onClick={() => setDeployModal(null)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {/* Revert Modal */}
      {revertModal && (
        <AppModal
          title={`Revert to: ${revertModal.version_number}`}
          onClose={() => setRevertModal(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              This will revert the active model back to{" "}
              <strong>{revertModal.version_number}</strong>. The current
              deployed model will become inactive.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleRevert}
                disabled={actionLoading}
                className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Reverting..." : "Confirm Revert"}
              </button>
              <button
                onClick={() => setRevertModal(null)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {/* Results Modal */}
      {resultModal && (
        <AppModal title={resultModal.title} onClose={() => setResultModal(null)}>
          <div className="space-y-3 text-sm">
            {resultModal.data?.accuracy && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Accuracy</p>
                  <p className="font-bold text-lg text-blue-900">
                    {fmt(resultModal.data.accuracy)}
                  </p>
                </div>
              </div>
            )}
            {resultModal.data?.result?.total_classes && (
              <p className="text-gray-600">
                Total classes trained:{" "}
                <strong>{resultModal.data.result.total_classes}</strong>
              </p>
            )}
            <button
              onClick={() => setResultModal(null)}
              className="w-full bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition mt-2"
            >
              Close
            </button>
          </div>
        </AppModal>
      )}
    </div>
  );
};

export default ManageModel;
