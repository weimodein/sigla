import { useState, useEffect } from "react";
import {
  getAllWords,
  getWordStats,
  getWordById,
  approveWord,
  rejectWord,
  updateWord,
  deleteWord,
  getWordSamples,
} from "../../api/wordApi.js";
import { BookOpen, CheckCircle, XCircle, Clock, Search, X } from "lucide-react";

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
const Badge = ({ value, type = "status" }) => {
  const statusStyles = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    FSL: "bg-blue-100 text-blue-700",
    ASL: "bg-purple-100 text-purple-700",
    word: "bg-gray-100 text-gray-600",
    alphabet: "bg-orange-100 text-orange-700",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[value] || "bg-gray-100 text-gray-600"}`}
    >
      {value}
    </span>
  );
};

// ── Modal ─────────────────────────────────────────────────────
const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
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
const ManageWordBank = () => {
  const [activeTab, setActiveTab] = useState("all");
  const [stats, setStats] = useState(null);
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [filterSign, setFilterSign] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Modal state
  const [viewModal, setViewModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [samples, setSamples] = useState([]);

  // Edit form
  const [editForm, setEditForm] = useState({
    label: "",
    description: "",
    hands_count: 1,
    sign_type: "FSL",
    category: "word",
  });

  // Reject reason
  const [rejectReason, setRejectReason] = useState("");

  // ── Fetch data ──────────────────────────────────────────────
  const fetchStats = async () => {
    try {
      const data = await getWordStats();
      setStats(data);
    } catch (err) {
      console.error("Failed to load word stats");
    }
  };

  const fetchWords = async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (activeTab !== "all") params.status = activeTab;
      if (search) params.search = search;
      if (filterSign) params.sign_type = filterSign;
      if (filterCat) params.category = filterCat;

      const data = await getAllWords(params);
      setWords(data.words);
    } catch (err) {
      setError("Failed to load words");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);
  useEffect(() => {
    fetchWords();
  }, [activeTab, search, filterSign, filterCat]);

  const showSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 3000);
  };

  // ── View word details + samples ───────────────────────────
  const handleView = async (word) => {
    setViewModal(word);
    try {
      const data = await getWordSamples(word.id);
      setSamples(data.samples || []);
    } catch {
      setSamples([]);
    }
  };

  // ── Approve ───────────────────────────────────────────────
  const handleApprove = async (id) => {
    setActionLoading(true);
    try {
      await approveWord(id);
      showSuccess("Word approved and added to dictionary");
      fetchStats();
      fetchWords();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to approve word");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Reject ────────────────────────────────────────────────
  const handleRejectOpen = (word) => {
    setRejectReason("");
    setRejectModal(word);
  };

  const handleRejectConfirm = async () => {
    setActionLoading(true);
    try {
      await rejectWord(rejectModal.id, rejectReason);
      showSuccess("Word rejected");
      setRejectModal(null);
      fetchStats();
      fetchWords();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to reject word");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Edit ──────────────────────────────────────────────────
  const handleEditOpen = (word) => {
    setEditForm({
      label: word.label || "",
      description: word.description || "",
      hands_count: word.hands_count || 1,
      sign_type: word.sign_type || "FSL",
      category: word.category || "word",
    });
    setEditModal(word);
  };

  const handleEditSave = async () => {
    setActionLoading(true);
    try {
      await updateWord(editModal.id, editForm);
      showSuccess("Word updated successfully");
      setEditModal(null);
      fetchWords();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update word");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this word? This cannot be undone.")) return;
    setActionLoading(true);
    try {
      await deleteWord(id);
      showSuccess("Word deleted successfully");
      fetchStats();
      fetchWords();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete word");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Tabs ──────────────────────────────────────────────────
  const tabs = [
    { key: "all", label: "All Words" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Manage Words</h2>
        <p className="text-gray-500 text-sm mt-1">
          Review and manage gesture word submissions
        </p>
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Words"
          value={stats?.total}
          icon={BookOpen}
          color="bg-blue-900"
        />
        <StatCard
          title="Pending"
          value={stats?.pending}
          icon={Clock}
          color="bg-yellow-500"
        />
        <StatCard
          title="Approved"
          value={stats?.approved}
          icon={CheckCircle}
          color="bg-green-500"
        />
        <StatCard
          title="Rejected"
          value={stats?.rejected}
          icon={XCircle}
          color="bg-red-500"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition
              ${
                activeTab === tab.key
                  ? "border-blue-900 text-blue-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search words..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
          />
        </div>
        <select
          value={filterSign}
          onChange={(e) => setFilterSign(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
        >
          <option value="">All Sign Types</option>
          <option value="FSL">FSL</option>
          <option value="ASL">ASL</option>
        </select>
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
        >
          <option value="">All Categories</option>
          <option value="word">Word</option>
          <option value="alphabet">Alphabet</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-900" />
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Sign Type</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Samples</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted By</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {words.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="text-center py-8 text-gray-400 text-sm"
                  >
                    No words found
                  </td>
                </tr>
              ) : (
                words.map((word) => (
                  <tr
                    key={word.id}
                    className="border-t hover:bg-gray-50 text-sm"
                  >
                    <td className="px-4 py-3 text-gray-500">{word.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {word.label}
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={word.sign_type} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={word.category} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {word.total_samples}
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={word.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {word.submitter?.username || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => handleView(word)}
                          className="text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 px-3 py-1 rounded-lg"
                        >
                          View
                        </button>
                        {word.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleApprove(word.id)}
                              className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1 rounded-lg"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleRejectOpen(word)}
                              className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleEditOpen(word)}
                          className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1 rounded-lg"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(word.id)}
                          className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* View Modal */}
      {viewModal && (
        <Modal
          title={`Word: ${viewModal.label}`}
          onClose={() => setViewModal(null)}
        >
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500">Label</p>
                <p className="font-medium">{viewModal.label}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <Badge value={viewModal.status} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Sign Type</p>
                <Badge value={viewModal.sign_type} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Category</p>
                <Badge value={viewModal.category} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Hands</p>
                <p className="font-medium">{viewModal.hands_count}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Samples</p>
                <p className="font-medium">{viewModal.total_samples}</p>
              </div>
            </div>
            {viewModal.description && (
              <div>
                <p className="text-xs text-gray-500">Description</p>
                <p className="text-gray-700">{viewModal.description}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 mb-2">
                Gesture Samples ({samples.length})
              </p>
              {samples.length === 0 ? (
                <p className="text-gray-400 text-xs">No samples uploaded yet</p>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {samples.map((s) => (
                    <div
                      key={s.id}
                      className="text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded"
                    >
                      {s.sample_count} samples — uploaded by{" "}
                      {s.submitter?.username || "unknown"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editModal && (
        <Modal title="Edit Word" onClose={() => setEditModal(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Label
              </label>
              <input
                type="text"
                value={editForm.label}
                onChange={(e) =>
                  setEditForm({ ...editForm, label: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Description
              </label>
              <textarea
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Sign Type
                </label>
                <select
                  value={editForm.sign_type}
                  onChange={(e) =>
                    setEditForm({ ...editForm, sign_type: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                >
                  <option value="FSL">FSL</option>
                  <option value="ASL">ASL</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Category
                </label>
                <select
                  value={editForm.category}
                  onChange={(e) =>
                    setEditForm({ ...editForm, category: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                >
                  <option value="word">Word</option>
                  <option value="alphabet">Alphabet</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Hands Count
              </label>
              <select
                value={editForm.hands_count}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    hands_count: parseInt(e.target.value),
                  })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              >
                <option value={1}>1 Hand</option>
                <option value={2}>2 Hands</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleEditSave}
                disabled={actionLoading}
                className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Saving..." : "Save Changes"}
              </button>
              <button
                onClick={() => setEditModal(null)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <Modal title="Reject Word" onClose={() => setRejectModal(null)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Rejecting <strong>{rejectModal.label}</strong>. Optionally provide
              a reason:
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Reason for rejection (optional)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
            />
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleRejectConfirm}
                disabled={actionLoading}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Rejecting..." : "Confirm Reject"}
              </button>
              <button
                onClick={() => setRejectModal(null)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ManageWordBank;
