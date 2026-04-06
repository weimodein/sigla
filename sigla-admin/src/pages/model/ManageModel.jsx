import { useState, useEffect } from "react";
import {
  getAllModels,
  getModelStats,
  trainModel,
  testModel,
  deployModel,
  revertModel,
  deleteModel,
} from "../../api/modelApi.js";
import { getWordStats } from "../../api/wordApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import { Cpu, CheckCircle, Clock, X, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

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

const SkeletonTableRows = ({ rows = 5 }) =>
  Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="border-t">
      {Array.from({ length: 10 }).map((_, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-2/3" />
        </td>
      ))}
    </tr>
  ));

// ── Badge ─────────────────────────────────────────────────────
const Badge = ({ value }) => {
  const styles = {
    deployed: "bg-green-100 text-green-700",
    trained: "bg-yellow-100 text-yellow-700",
    inactive: "bg-gray-100 text-gray-500",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[value] || "bg-gray-100 text-gray-600"}`}
    >
      {value}
    </span>
  );
};

// ── Modal ─────────────────────────────────────────────────────
const Modal = ({ title, onClose, children, wide = false }) => (
  <div
    className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4"
    onKeyDown={(e) => e.key === "Escape" && onClose()}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div
      className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-3xl" : "max-w-md"} p-6`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-800">{title}</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition"
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────
const ManageModel = () => {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [wordStats, setWordStats] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

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

  // ── Paginate ────────────────────────────────────────────────
  const totalPages = Math.ceil(sortedModels.length / pageSize);
  const paginatedModels = sortedModels.slice(
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
      const result = await trainModel(
        trainForm.version_number,
        trainForm.notes,
      );
      showSuccess(`Model ${trainForm.version_number} trained successfully`);
      setTrainModal(false);
      setTrainForm({ version_number: "", notes: "" });
      setResultModal({ title: "Training Results", data: result });
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

  // ── Sortable Header ───────────────────────────────────────
  const SortableHeader = ({ label, sortKey }) => {
    const active = sortField === sortKey;
    return (
      <th
        className="px-4 py-3 cursor-pointer select-none group hover:bg-gray-100"
        onClick={() => handleSort(sortKey)}
      >
        <div className="flex items-center gap-1">
          {label}
          <span className="text-gray-400">
            {active ? (
              sortDir === "asc" ? (
                <ChevronLeft size={14} className="rotate-[-90deg]" />
              ) : (
                <ChevronLeft size={14} className="rotate-90" />
              )
            ) : (
              <ChevronUp size={14} className="opacity-0 group-hover:opacity-50" />
            )}
          </span>
        </div>
      </th>
    );
  };

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1f2937", margin: 0 }}>Manage Model</h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: 4 }}>
            Train, test, and deploy sign language models
          </p>
        </div>
        <button
          onClick={() => setTrainModal(true)}
          className="bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + Train New Model
        </button>
      </div>

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
        <div className="bg-blue-900 text-white rounded-xl p-5 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-300 mb-3">
            Currently Deployed
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-blue-300 text-xs">Version</p>
              <p className="font-bold text-lg">
                {stats.current_model.version_number}
              </p>
            </div>
            <div>
              <p className="text-blue-300 text-xs">Accuracy</p>
              <p className="font-semibold">
                {fmt(stats.current_model.accuracy)}
              </p>
            </div>
            <div>
              <p className="text-blue-300 text-xs">Classes</p>
              <p className="font-semibold">
                {stats.current_model.total_classes ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-blue-300 text-xs">Deployed At</p>
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

      {/* Models Table */}
      <div className="dash-card overflow-x-auto">
        <div className="dash-card-header flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">All Model Versions</h3>
          <span className="text-xs text-gray-500">{models.length} version{models.length !== 1 ? "s" : ""}</span>
        </div>
        {loading ? (
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Accuracy</th>
                <th className="px-4 py-3">Precision</th>
                <th className="px-4 py-3">Recall</th>
                <th className="px-4 py-3">F1 Score</th>
                <th className="px-4 py-3">Classes</th>
                <th className="px-4 py-3">Trained By</th>
                <th className="px-4 py-3">Trained At</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              <SkeletonTableRows rows={5} />
            </tbody>
          </table>
        ) : (
          <>
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <SortableHeader label="Version" sortKey="version_number" />
                  <SortableHeader label="Status" sortKey="status" />
                  <SortableHeader label="Accuracy" sortKey="accuracy" />
                  <SortableHeader label="Precision" sortKey="precision" />
                  <SortableHeader label="Recall" sortKey="recall" />
                  <SortableHeader label="F1" sortKey="f1_score" />
                  <SortableHeader label="Classes" sortKey="total_classes" />
                  <th className="px-4 py-3">Trained By</th>
                  <SortableHeader label="Trained At" sortKey="trained_at" />
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedModels.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="text-center py-8 text-gray-400 text-sm"
                    >
                      No models found. Train your first model to get started.
                    </td>
                  </tr>
                ) : (
                  paginatedModels.map((model) => (
                    <tr
                      key={model.id}
                      className="border-t hover:bg-gray-50 text-sm"
                    >
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {model.version_number}
                      </td>
                      <td className="px-4 py-3">
                        <Badge value={model.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {fmt(model.accuracy)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {fmt(model.precision)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {fmt(model.recall)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {fmt(model.f1_score)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {model.total_classes ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {model.trainer?.username || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {model.trained_at
                          ? new Date(model.trained_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          {model.status === "trained" && (
                            <>
                              <button
                                onClick={() => setTestModal(model)}
                                className="text-xs bg-yellow-50 text-yellow-700 hover:bg-yellow-100 px-3 py-1 rounded-lg"
                              >
                                Test
                              </button>
                              <button
                                onClick={() => setDeployModal(model)}
                                className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1 rounded-lg"
                              >
                                Deploy
                              </button>
                              <button
                                onClick={() => handleDelete(model)}
                                className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg"
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {model.status === "inactive" && (
                            <>
                              <button
                                onClick={() => setRevertModal(model)}
                                className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1 rounded-lg"
                              >
                                Revert
                              </button>
                              <button
                                onClick={() => handleDelete(model)}
                                className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg"
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {model.status === "deployed" && (
                            <span className="text-xs text-green-600 font-medium px-3 py-1">
                              Active
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {/* Pagination */}
            {sortedModels.length > pageSize && (
              <div className="dash-card-footer flex items-center justify-between text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <span>
                    {sortedModels.length} result{sortedModels.length !== 1 ? "s" : ""}
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-900"
                  >
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs">
                    {page} / {totalPages || 1}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
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
        <Modal title="Train New Model" onClose={() => setTrainModal(false)}>
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
        </Modal>
      )}

      {/* Test Modal */}
      {testModal && (
        <Modal
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
        </Modal>
      )}

      {/* Deploy Modal */}
      {deployModal && (
        <Modal
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
        </Modal>
      )}

      {/* Revert Modal */}
      {revertModal && (
        <Modal
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
        </Modal>
      )}

      {/* Results Modal */}
      {resultModal && (
        <Modal title={resultModal.title} onClose={() => setResultModal(null)}>
          <div className="space-y-3 text-sm">
            {resultModal.data?.accuracy && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Accuracy</p>
                  <p className="font-bold text-lg text-blue-900">
                    {fmt(resultModal.data.accuracy)}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">F1 Score</p>
                  <p className="font-bold text-lg text-blue-900">
                    {fmt(resultModal.data.f1_score)}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Precision</p>
                  <p className="font-bold text-lg text-blue-900">
                    {fmt(resultModal.data.precision)}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Recall</p>
                  <p className="font-bold text-lg text-blue-900">
                    {fmt(resultModal.data.recall)}
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
        </Modal>
      )}
    </div>
  );
};

export default ManageModel;
