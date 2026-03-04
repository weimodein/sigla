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
import { Cpu, CheckCircle, Clock, Archive, X } from "lucide-react";

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
const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-800">{title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────
const ManageModel = () => {
  const [stats, setStats] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

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
    setError("");
    try {
      const [statsData, modelsData] = await Promise.all([
        getModelStats(),
        getAllModels(),
      ]);
      setStats(statsData);
      setModels(modelsData.models);
    } catch (err) {
      setError("Failed to load model data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 4000);
  };

  // ── Train ─────────────────────────────────────────────────
  const handleTrain = async () => {
    if (!trainForm.version_number) {
      setError("Version number is required");
      return;
    }
    setActionLoading(true);
    setError("");
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
      setError(
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
    setError("");
    try {
      const result = await testModel(testModal.id);
      showSuccess("Model evaluation complete");
      setTestModal(null);
      setResultModal({ title: "Test Results", data: result });
      fetchData();
    } catch (err) {
      setError(
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
    setError("");
    try {
      await deployModel(deployModal.id);
      showSuccess(`Model ${deployModal.version_number} deployed successfully`);
      setDeployModal(null);
      fetchData();
    } catch (err) {
      setError(
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
    setError("");
    try {
      await revertModel(revertModal.id);
      showSuccess(`Reverted to model ${revertModal.version_number}`);
      setRevertModal(null);
      fetchData();
    } catch (err) {
      setError(
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
      setError(err.response?.data?.message || "Failed to delete model");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Format metric ─────────────────────────────────────────
  const fmt = (val) => (val != null ? `${(val * 100).toFixed(1)}%` : "—");

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Manage Model</h2>
          <p className="text-gray-500 text-sm mt-1">
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

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">
          {success}
        </div>
      )}

      {/* Stat Cards */}
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
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-900" />
          </div>
        ) : (
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
              {models.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="text-center py-8 text-gray-400 text-sm"
                  >
                    No models found. Train your first model to get started.
                  </td>
                </tr>
              ) : (
                models.map((model) => (
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
                            ✓ Active
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
                  setTrainForm({ ...trainForm, version_number: e.target.value })
                }
                placeholder="e.g. v1.0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
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
