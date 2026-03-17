import { useState, useEffect } from "react";
import {
  getAllWords,
  getWordStats,
  approveWord,
  rejectWord,
  updateWord,
  deleteWord,
  getWordSamples,
  approveSample,
  rejectSample,
  approveAllSamplesByUser,
  rejectAllSamplesByUser,
  approveSubmission,
  rejectSubmission,
  lockWord,
  unlockWord,
} from "../../api/wordApi.js";
import {
  BookOpen,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  X,
  Lock,
  Unlock,
  Image,
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

// ── Badge ─────────────────────────────────────────────────────
const Badge = ({ value }) => {
  const styles = {
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
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[value] || "bg-gray-100 text-gray-600"}`}
    >
      {value}
    </span>
  );
};

// ── Modal ─────────────────────────────────────────────────────
const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4 py-6 overflow-y-auto">
    <div
      className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-4xl" : "max-w-lg"} p-6`}
    >
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
  const [galleryModal, setGalleryModal] = useState(null); // word object
  const [editModal, setEditModal] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [samples, setSamples] = useState([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // ── Fetch ───────────────────────────────────────────────────
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
  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(""), 4000);
  };

  // ── Open image gallery ──────────────────────────────────────
  const handleOpenGallery = async (word) => {
    setGalleryModal(word);
    setSamplesLoading(true);
    setSamples([]);
    try {
      const data = await getWordSamples(word.id);
      setSamples(data.samples || []);
    } catch {
      setSamples([]);
    } finally {
      setSamplesLoading(false);
    }
  };

  // ── Per-sample approve/reject ───────────────────────────────
  const handleApproveSample = async (wordId, sampleId) => {
    try {
      await approveSample(wordId, sampleId);
      showSuccess("Sample approved");
      const data = await getWordSamples(wordId);
      setSamples(data.samples || []);
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to approve sample");
    }
  };

  const handleRejectSample = async (wordId, sampleId) => {
    try {
      await rejectSample(wordId, sampleId);
      showSuccess("Sample rejected");
      const data = await getWordSamples(wordId);
      setSamples(data.samples || []);
    } catch (err) {
      showError(err.response?.data?.message || "Failed to reject sample");
    }
  };

  // ── Per-user approve/reject all ─────────────────────────────
  const handleApproveAllByUser = async (wordId, userId, username) => {
    if (!window.confirm(`Approve all samples from ${username}?`)) return;
    try {
      await approveAllSamplesByUser(wordId, userId);
      showSuccess(`All samples from ${username} approved`);
      const data = await getWordSamples(wordId);
      setSamples(data.samples || []);
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to approve all by user");
    }
  };

  const handleRejectAllByUser = async (wordId, userId, username) => {
    if (!window.confirm(`Reject all samples from ${username}?`)) return;
    try {
      await rejectAllSamplesByUser(wordId, userId);
      showSuccess(`All samples from ${username} rejected`);
      const data = await getWordSamples(wordId);
      setSamples(data.samples || []);
    } catch (err) {
      showError(err.response?.data?.message || "Failed to reject all by user");
    }
  };

  // ── Submission level approve/reject ─────────────────────────
  const handleApproveSubmission = async (wordId) => {
    if (!window.confirm("Approve entire submission?")) return;
    setActionLoading(true);
    try {
      await approveSubmission(wordId);
      showSuccess("Submission approved");
      setGalleryModal(null);
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to approve submission");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSubmission = async (wordId) => {
    if (!window.confirm("Reject entire submission? User will be notified."))
      return;
    setActionLoading(true);
    try {
      await rejectSubmission(wordId);
      showSuccess("Submission rejected. User notified.");
      setGalleryModal(null);
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to reject submission");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Lock/Unlock ─────────────────────────────────────────────
  const handleLock = async (id) => {
    if (
      !window.confirm(
        "Lock this word? Users will no longer be able to submit samples for it.",
      )
    )
      return;
    setActionLoading(true);
    try {
      await lockWord(id);
      showSuccess("Word locked. No further submissions allowed.");
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to lock word");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlock = async (id) => {
    setActionLoading(true);
    try {
      await unlockWord(id);
      showSuccess("Word unlocked. Submissions are now allowed.");
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to unlock word");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Approve/Reject word ──────────────────────────────────────
  const handleApprove = async (id) => {
    setActionLoading(true);
    try {
      await approveWord(id);
      showSuccess("Word approved and added to word bank");
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to approve word");
    } finally {
      setActionLoading(false);
    }
  };

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
      showError(err.response?.data?.message || "Failed to reject word");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Edit ────────────────────────────────────────────────────
  const [editForm, setEditForm] = useState({
    label: "",
    description: "",
    hands_count: 1,
    sign_type: "FSL",
    category: "word",
  });

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
      showError(err.response?.data?.message || "Failed to update word");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (
      !window.confirm(
        "Delete this word? All gesture samples will also be removed. This cannot be undone.",
      )
    )
      return;
    setActionLoading(true);
    try {
      await deleteWord(id);
      showSuccess("Word and all associated samples deleted");
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to delete word");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Group samples by user ────────────────────────────────────
  const groupSamplesByUser = (samples) => {
    const groups = {};
    samples.forEach((s) => {
      const key = s.submitter?.id || "unknown";
      if (!groups[key]) {
        groups[key] = {
          userId: s.submitter?.id,
          username: s.submitter?.username || "Unknown",
          samples: [],
        };
      }
      groups[key].samples.push(s);
    });
    return Object.values(groups);
  };

  // ── Tabs ────────────────────────────────────────────────────
  const tabs = [
    { key: "all", label: "All Words" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  // ── JSX ─────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Manage Word Bank</h2>
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
          title="Locked"
          value={stats?.locked}
          icon={Lock}
          color="bg-gray-600"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition
              ${activeTab === tab.key ? "border-blue-900 text-blue-900" : "border-transparent text-gray-500 hover:text-gray-700"}`}
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
                      <div className="flex items-center gap-2">
                        {word.label}
                        {word.is_locked && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            <Lock size={10} /> Locked
                          </span>
                        )}
                        {word.is_active && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            Active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={word.sign_type} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={word.category} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <span className="text-xs">
                        {word.approved_sample_count || 0}/
                        {word.total_samples || 0} approved
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={word.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {word.submitter?.username || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        {/* Image gallery button */}
                        <button
                          onClick={() => handleOpenGallery(word)}
                          className="text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1 rounded-lg flex items-center gap-1"
                        >
                          <Image size={12} /> Gallery
                        </button>

                        {/* Approve/Reject — pending words only */}
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

                        {/* Lock/Unlock */}
                        {word.is_locked ? (
                          <button
                            onClick={() => handleUnlock(word.id)}
                            className="text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 px-3 py-1 rounded-lg flex items-center gap-1"
                          >
                            <Unlock size={12} /> Unlock
                          </button>
                        ) : (
                          <button
                            onClick={() => handleLock(word.id)}
                            className="text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 px-3 py-1 rounded-lg flex items-center gap-1"
                          >
                            <Lock size={12} /> Lock
                          </button>
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

      {/* ── Image Gallery Modal ────────────────────────────── */}
      {galleryModal && (
        <Modal
          title={`Gesture Samples — ${galleryModal.label}`}
          onClose={() => setGalleryModal(null)}
          wide
        >
          <div className="space-y-4">
            {/* Submission level actions */}
            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
              <div className="text-sm text-gray-600">
                <span className="font-medium">
                  {galleryModal.approved_sample_count || 0}
                </span>{" "}
                approved
                {" / "}
                <span className="font-medium">
                  {galleryModal.total_samples || 0}
                </span>{" "}
                total samples
                {galleryModal.is_active && (
                  <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                    Active in app
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleApproveSubmission(galleryModal.id)}
                  disabled={actionLoading}
                  className="text-xs bg-green-600 text-white hover:bg-green-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  Approve Submission
                </button>
                <button
                  onClick={() => handleRejectSubmission(galleryModal.id)}
                  disabled={actionLoading}
                  className="text-xs bg-red-600 text-white hover:bg-red-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  Reject Submission
                </button>
              </div>
            </div>

            {samplesLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-900" />
              </div>
            ) : samples.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">
                No gesture samples uploaded yet
              </p>
            ) : (
              /* Group samples by user */
              groupSamplesByUser(samples).map((group) => (
                <div
                  key={group.userId}
                  className="border border-gray-200 rounded-xl overflow-hidden"
                >
                  {/* User header with approve/reject all */}
                  <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5">
                    <div className="text-sm font-medium text-gray-700">
                      {group.username}
                      <span className="ml-2 text-xs text-gray-400">
                        ({group.samples.length} samples)
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          handleApproveAllByUser(
                            galleryModal.id,
                            group.userId,
                            group.username,
                          )
                        }
                        className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded"
                      >
                        Approve All
                      </button>
                      <button
                        onClick={() =>
                          handleRejectAllByUser(
                            galleryModal.id,
                            group.userId,
                            group.username,
                          )
                        }
                        className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-2 py-1 rounded"
                      >
                        Reject All
                      </button>
                    </div>
                  </div>

                  {/* Sample images grid */}
                  <div className="p-3 grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {group.samples.map((sample) => (
                      <div key={sample.id} className="relative group">
                        <img
                          src={sample.file_url}
                          alt={`sample-${sample.id}`}
                          className={`w-full aspect-square object-cover rounded-lg border-2 ${
                            sample.status === "approved"
                              ? "border-green-400"
                              : sample.status === "rejected"
                                ? "border-red-400"
                                : "border-gray-200"
                          }`}
                          onError={(e) => {
                            e.target.src =
                              "https://via.placeholder.com/80?text=No+Image";
                          }}
                        />
                        {/* Status overlay */}
                        <div
                          className={`absolute top-1 right-1 w-3 h-3 rounded-full ${
                            sample.status === "approved"
                              ? "bg-green-500"
                              : sample.status === "rejected"
                                ? "bg-red-500"
                                : "bg-yellow-400"
                          }`}
                        />
                        {/* Hover actions */}
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 rounded-lg transition flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                          {sample.status !== "approved" && (
                            <button
                              onClick={() =>
                                handleApproveSample(galleryModal.id, sample.id)
                              }
                              className="bg-green-500 text-white text-xs px-1.5 py-0.5 rounded"
                            >
                              ✓
                            </button>
                          )}
                          {sample.status !== "rejected" && (
                            <button
                              onClick={() =>
                                handleRejectSample(galleryModal.id, sample.id)
                              }
                              className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}

            {/* Legend */}
            <div className="flex gap-4 text-xs text-gray-500 pt-1">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />{" "}
                Approved
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />{" "}
                Rejected
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" />{" "}
                Pending
              </span>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editModal && (
        <Modal title="Edit Word" onClose={() => setEditModal(null)}>
          <div className="space-y-3">
            {[{ key: "label", label: "Label", type: "text" }].map(
              ({ key, label, type }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {label}
                  </label>
                  <input
                    type={type}
                    value={editForm[key]}
                    onChange={(e) =>
                      setEditForm({ ...editForm, [key]: e.target.value })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                  />
                </div>
              ),
            )}
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
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
