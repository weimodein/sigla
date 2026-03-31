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
  approveAllSamplesForWord,
  rejectAllSamplesForWord,
  approveSubmission,
  rejectSubmission,
  lockWord,
  unlockWord,
  adminAddWord,
  adminUploadSamples,
  setWordThumbnail,
  setWordVideo,
} from "../../api/wordApi.js";
import {
  BookOpen,
  CheckCircle,
  Clock,
  Search,
  X,
  Lock,
  Unlock,
  Image,
  Plus,
  Upload,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────
const FSL_CATEGORIES = [
  { value: "introducing oneself", label: "Introducing Oneself" },
  { value: "ordering food", label: "Ordering Food" },
  { value: "buying items", label: "Buying Items" },
  { value: "asking for prices", label: "Asking for Prices" },
  { value: "giving numbers", label: "Giving Numbers" },
  { value: "requesting assistance", label: "Requesting Assistance" },
  { value: "asking for directions", label: "Asking for Directions" },
  { value: "confirming information", label: "Confirming Information" },
  { value: "communicating basic needs", label: "Communicating Basic Needs" },
  { value: "alphabets", label: "Alphabets" },
  { value: "numbers", label: "Numbers" },
  { value: "additional words", label: "Additional Words" },
];

// ── Helpers ───────────────────────────────────────────────────
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

const Badge = ({ value }) => {
  const styles = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    FSL: "bg-blue-100 text-blue-700",
    ASL: "bg-purple-100 text-purple-700",
    static: "bg-gray-100 text-gray-600",
    motion: "bg-indigo-100 text-indigo-700",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[value] || "bg-gray-100 text-gray-600"}`}
    >
      {value}
    </span>
  );
};

const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4 py-6 overflow-y-auto">
    <div
      className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-4xl" : "max-w-lg"} p-6 my-auto`}
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
  const [galleryModal, setGalleryModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [addModal, setAddModal] = useState(false);
  const [uploadModal, setUploadModal] = useState(null); // word object
  const [samples, setSamples] = useState([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [videoInput, setVideoInput] = useState("");
  const [videoLoading, setVideoLoading] = useState(false);

  // ── Fetch ───────────────────────────────────────────────────
  const fetchStats = async () => {
    try {
      const data = await getWordStats();
      setStats(data);
    } catch {
      // non-blocking
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
    } catch {
      setError("Failed to load words");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => { fetchWords(); }, [activeTab, search, filterSign, filterCat]);

  const showSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 3000);
  };
  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(""), 4000);
  };

  // ── Reload samples helper ───────────────────────────────────
  const reloadSamples = async (wordId) => {
    const data = await getWordSamples(wordId);
    setSamples(data.samples || []);
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
      await reloadSamples(wordId);
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
      await reloadSamples(wordId);
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
      await reloadSamples(wordId);
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
      await reloadSamples(wordId);
    } catch (err) {
      showError(err.response?.data?.message || "Failed to reject all by user");
    }
  };

  // ── Word-level approve/reject all samples ───────────────────
  const handleApproveAllForWord = async (word) => {
    if (!window.confirm(`Approve ALL pending samples for "${word.label}"? This applies to every submitter.`)) return;
    setActionLoading(true);
    try {
      const res = await approveAllSamplesForWord(word.id);
      showSuccess(res.message);
      await reloadSamples(word.id);
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to approve all samples");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectAllForWord = async (word) => {
    if (!window.confirm(`Reject ALL pending samples for "${word.label}"? This applies to every submitter.`)) return;
    setActionLoading(true);
    try {
      const res = await rejectAllSamplesForWord(word.id);
      showSuccess(res.message);
      await reloadSamples(word.id);
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to reject all samples");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Submission level approve/reject (per user) ──────────────
  const handleApproveSubmission = async (wordId, userId, username) => {
    if (!window.confirm(`Approve entire submission from ${username}? User will be notified.`)) return;
    setActionLoading(true);
    try {
      await approveSubmission(wordId, { user_id: userId });
      showSuccess(`Submission from ${username} approved. User notified.`);
      await reloadSamples(wordId);
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to approve submission");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSubmission = async (wordId, userId, username) => {
    if (!window.confirm(`Reject entire submission from ${username}? User will be notified.`)) return;
    setActionLoading(true);
    try {
      await rejectSubmission(wordId, { user_id: userId });
      showSuccess(`Submission from ${username} rejected. User notified.`);
      await reloadSamples(wordId);
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
    if (!window.confirm("Lock this word? Users will no longer be able to submit samples for it.")) return;
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

  // ── Approve/Reject word status ───────────────────────────────
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
    label: "", description: "", hands_count: 1,
    sign_type: "FSL", category: "additional words", gesture_type: "static",
    filipino_translation: "",
  });

  const handleEditOpen = (word) => {
    setEditForm({
      label: word.label || "",
      description: word.description || "",
      hands_count: word.hands_count || 1,
      sign_type: word.sign_type || "FSL",
      category: word.category || "additional words",
      gesture_type: word.gesture_type || "static",
      filipino_translation: word.filipino_translation || "",
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
    if (!window.confirm("Delete this word? All gesture samples will also be removed. This cannot be undone.")) return;
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

  // ── Add Word ─────────────────────────────────────────────────
  const [addForm, setAddForm] = useState({
    label: "", description: "", hands_count: 1,
    sign_type: "FSL", category: "additional words", gesture_type: "static",
    filipino_translation: "",
  });

  const handleAddWord = async () => {
    if (!addForm.label.trim()) { showError("Label is required"); return; }
    setActionLoading(true);
    try {
      await adminAddWord(addForm);
      showSuccess(`Word "${addForm.label}" added. Upload gesture samples to activate it.`);
      setAddModal(false);
      setAddForm({ label: "", description: "", hands_count: 1, sign_type: "FSL", category: "additional words", gesture_type: "static", filipino_translation: "" });
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to add word");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Admin Upload Samples ──────────────────────────────────────
  const [uploadForm, setUploadForm] = useState({ file_url: "", sample_count: 1 });

  const handleOpenUpload = (word) => {
    setUploadForm({ file_url: "", sample_count: 1 });
    setUploadModal(word);
  };

  const handleAdminUpload = async () => {
    if (!uploadForm.file_url.trim()) { showError("File URL is required"); return; }
    setActionLoading(true);
    try {
      const res = await adminUploadSamples(uploadModal.id, {
        file_url: uploadForm.file_url.trim(),
        sample_count: parseInt(uploadForm.sample_count) || 1,
      });
      showSuccess(res.message);
      setUploadModal(null);
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to upload samples");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Set word bank thumbnail (static words) ───────────────────
  const handleSetThumbnail = async (word, imageUrl) => {
    setActionLoading(true);
    try {
      await setWordThumbnail(word.id, imageUrl);
      setGalleryModal((prev) => prev ? { ...prev, thumbnail_url: imageUrl } : prev);
      fetchWords();
      showSuccess("Word bank image updated");
    } catch (err) {
      showError(err.response?.data?.message || "Failed to set thumbnail");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Set word bank video (motion words) ───────────────────────
  const handleSetVideo = async (videoUrl) => {
    if (!videoUrl.trim()) { showError("Please enter a video URL or upload a file"); return; }
    setVideoLoading(true);
    try {
      await setWordVideo(galleryModal.id, { video_url: videoUrl.trim() });
      setGalleryModal((prev) => prev ? { ...prev, video_url: videoUrl.trim() } : prev);
      setVideoInput("");
      fetchWords();
      showSuccess("Gesture video updated");
    } catch (err) {
      showError(err.response?.data?.message || "Failed to set video");
    } finally {
      setVideoLoading(false);
    }
  };

  const handleVideoFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      const ext = file.name.split(".").pop().toLowerCase();
      setVideoLoading(true);
      try {
        const res = await setWordVideo(galleryModal.id, { video_base64: base64, video_ext: ext });
        setGalleryModal((prev) => prev ? { ...prev, video_url: res.video_url } : prev);
        fetchWords();
        showSuccess("Gesture video uploaded");
      } catch (err) {
        showError(err.response?.data?.message || "Failed to upload video");
      } finally {
        setVideoLoading(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ── Group samples by user ────────────────────────────────────
  const groupSamplesByUser = (samples) => {
    const groups = {};
    samples.forEach((s) => {
      const key = s.submitter?.id || "admin";
      if (!groups[key]) {
        groups[key] = {
          userId: s.submitter?.id,
          username: s.submitter?.username || "Admin",
          samples: [],
        };
      }
      groups[key].samples.push(s);
    });
    return Object.values(groups);
  };

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Manage Word Bank</h2>
          <p className="text-gray-500 text-sm mt-1">
            Review and manage gesture word submissions
          </p>
        </div>
        <button
          onClick={() => setAddModal(true)}
          className="flex items-center gap-2 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          <Plus size={16} /> Add Word
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard title="Total Words" value={stats?.total} icon={BookOpen} color="bg-blue-900" />
        <StatCard title="Pending" value={stats?.pending} icon={Clock} color="bg-yellow-500" />
        <StatCard title="Approved" value={stats?.approved} icon={CheckCircle} color="bg-green-500" />
        <StatCard title="Locked" value={stats?.locked} icon={Lock} color="bg-gray-600" />
      </div>

      {/* Ready-to-activate banner */}
      {stats?.ready_to_activate > 0 && (
        <div className="mb-6 flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-indigo-800">
          <span className="text-lg">🧠</span>
          <span>
            <strong>{stats.ready_to_activate}</strong> word{stats.ready_to_activate !== 1 ? "s have" : " has"} enough
            approved samples and will become visible in the mobile app after the next model is trained and deployed.
          </span>
        </div>
      )}

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
          {FSL_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
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
                <th className="px-4 py-3">Gesture</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Filipino</th>
                <th className="px-4 py-3">Samples</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted By</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {words.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-gray-400 text-sm">
                    No words found
                  </td>
                </tr>
              ) : (
                words.map((word) => (
                  <tr key={word.id} className="border-t hover:bg-gray-50 text-sm">
                    <td className="px-4 py-3 text-gray-500">{word.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      <div className="flex items-center gap-1.5 flex-wrap">
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
                    <td className="px-4 py-3"><Badge value={word.sign_type} /></td>
                    <td className="px-4 py-3"><Badge value={word.gesture_type || "static"} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500 capitalize">{word.category || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{word.filipino_translation || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <span className="text-xs">
                        {word.approved_sample_count || 0}/{word.total_samples || 0} approved
                      </span>
                    </td>
                    <td className="px-4 py-3"><Badge value={word.status} /></td>
                    <td className="px-4 py-3 text-gray-600">{word.submitter?.username || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 flex-wrap">
                        <button
                          onClick={() => handleOpenGallery(word)}
                          className="text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-1 rounded-lg flex items-center gap-1"
                        >
                          <Image size={12} /> Gallery
                        </button>
                        <button
                          onClick={() => handleOpenUpload(word)}
                          className="text-xs bg-purple-50 text-purple-700 hover:bg-purple-100 px-2 py-1 rounded-lg flex items-center gap-1"
                        >
                          <Upload size={12} /> Upload
                        </button>

                        {word.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleApprove(word.id)}
                              className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded-lg"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleRejectOpen(word)}
                              className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-2 py-1 rounded-lg"
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {word.is_locked ? (
                          <button
                            onClick={() => handleUnlock(word.id)}
                            className="text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 px-2 py-1 rounded-lg flex items-center gap-1"
                          >
                            <Unlock size={12} /> Unlock
                          </button>
                        ) : (
                          <button
                            onClick={() => handleLock(word.id)}
                            className="text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 px-2 py-1 rounded-lg flex items-center gap-1"
                          >
                            <Lock size={12} /> Lock
                          </button>
                        )}

                        <button
                          onClick={() => handleEditOpen(word)}
                          className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded-lg"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(word.id)}
                          className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-2 py-1 rounded-lg"
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

      {/* ── Gallery Modal ──────────────────────────────────────── */}
      {galleryModal && (
        <Modal title={`Gesture Samples — ${galleryModal.label}`} onClose={() => setGalleryModal(null)} wide>
          <div className="space-y-4">
            {/* Word-level header: stats + approve/reject ALL */}
            <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  <span className="font-medium">{galleryModal.approved_sample_count || 0}</span> approved
                  {" / "}
                  <span className="font-medium">{galleryModal.total_samples || 0}</span> total
                  {galleryModal.is_active && (
                    <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                      Active in app
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApproveAllForWord(galleryModal)}
                    disabled={actionLoading}
                    className="text-xs bg-green-600 text-white hover:bg-green-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    Approve All Samples
                  </button>
                  <button
                    onClick={() => handleRejectAllForWord(galleryModal)}
                    disabled={actionLoading}
                    className="text-xs bg-red-600 text-white hover:bg-red-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    Reject All Samples
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                "Approve/Reject All Samples" applies to every submitter's pending samples for this word.
                Use "Approve/Reject Submission" per submitter below to notify individual users.
              </p>
            </div>

            {/* ── Word Bank Media Controls ──────────────────────── */}
            {galleryModal.gesture_type === "motion" ? (
              <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-indigo-800">Gesture Video</span>
                  {galleryModal.video_url && (
                    <a
                      href={galleryModal.video_url.startsWith("/")
                        ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${galleryModal.video_url}`
                        : galleryModal.video_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-600 underline"
                    >
                      View current video ↗
                    </a>
                  )}
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="url"
                    value={videoInput}
                    onChange={(e) => setVideoInput(e.target.value)}
                    placeholder="Paste video URL…"
                    className="flex-1 border border-indigo-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <button
                    onClick={() => handleSetVideo(videoInput)}
                    disabled={videoLoading || !videoInput.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-2 rounded-lg disabled:opacity-50 whitespace-nowrap"
                  >
                    {videoLoading ? "Saving…" : "Set URL"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-indigo-600">or upload a video file:</span>
                  <label className="cursor-pointer bg-white border border-indigo-300 hover:bg-indigo-50 text-indigo-700 text-xs px-3 py-1.5 rounded-lg">
                    {videoLoading ? "Uploading…" : "Choose File"}
                    <input type="file" accept="video/*" className="hidden" onChange={handleVideoFileUpload} disabled={videoLoading} />
                  </label>
                </div>
              </div>
            ) : (
              galleryModal.thumbnail_url && (
                <div className="border border-green-200 rounded-lg p-3 bg-green-50 flex items-center gap-3">
                  <img
                    src={galleryModal.thumbnail_url.startsWith("/")
                      ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${galleryModal.thumbnail_url}`
                      : galleryModal.thumbnail_url}
                    alt="current thumbnail"
                    className="w-16 h-16 object-cover rounded-lg border border-green-300"
                    onError={(e) => { e.target.onerror = null; e.target.src = "https://via.placeholder.com/64?text=?"; }}
                  />
                  <div>
                    <p className="text-sm font-semibold text-green-800">Current Word Bank Image</p>
                    <p className="text-xs text-green-600">Hover a sample below and click "Use" to change it.</p>
                  </div>
                </div>
              )
            )}

            {samplesLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-900" />
              </div>
            ) : samples.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">
                No gesture samples uploaded yet
              </p>
            ) : (
              groupSamplesByUser(samples).map((group) => (
                <div key={group.userId ?? "admin"} className="border border-gray-200 rounded-xl overflow-hidden">
                  {/* Per-user header */}
                  <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5 flex-wrap gap-2">
                    <div className="text-sm font-medium text-gray-700">
                      {group.username}
                      <span className="ml-2 text-xs text-gray-400">
                        ({group.samples.length} samples)
                      </span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {group.userId && (
                        <>
                          <button
                            onClick={() => handleApproveSubmission(galleryModal.id, group.userId, group.username)}
                            disabled={actionLoading}
                            className="text-xs bg-green-600 text-white hover:bg-green-700 px-2 py-1 rounded disabled:opacity-50"
                          >
                            Approve Submission
                          </button>
                          <button
                            onClick={() => handleRejectSubmission(galleryModal.id, group.userId, group.username)}
                            disabled={actionLoading}
                            className="text-xs bg-red-600 text-white hover:bg-red-700 px-2 py-1 rounded disabled:opacity-50"
                          >
                            Reject Submission
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleApproveAllByUser(galleryModal.id, group.userId, group.username)}
                        className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded"
                      >
                        Approve All
                      </button>
                      <button
                        onClick={() => handleRejectAllByUser(galleryModal.id, group.userId, group.username)}
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
                        {sample.file_url && sample.file_url.startsWith("landmark_direct_") ? (
                          <div
                            className={`w-full aspect-square rounded-lg border-2 flex flex-col items-center justify-center bg-indigo-50 ${
                              sample.status === "approved"
                                ? "border-green-400"
                                : sample.status === "rejected"
                                  ? "border-red-400"
                                  : "border-gray-200"
                            }`}
                          >
                            <span className="text-2xl">🖐</span>
                            <span className="text-xs text-indigo-500 font-medium mt-1 text-center leading-tight px-1">
                              Landmark only
                            </span>
                          </div>
                        ) : (
                          <img
                            src={`${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${sample.file_url}`}
                            alt={`sample-${sample.id}`}
                            className={`w-full aspect-square object-cover rounded-lg border-2 ${
                              sample.status === "approved"
                                ? "border-green-400"
                                : sample.status === "rejected"
                                  ? "border-red-400"
                                  : "border-gray-200"
                            }`}
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = "https://via.placeholder.com/80?text=No+Image";
                            }}
                          />
                        )}
                        <div
                          className={`absolute top-1 right-1 w-3 h-3 rounded-full ${
                            sample.status === "approved"
                              ? "bg-green-500"
                              : sample.status === "rejected"
                                ? "bg-red-500"
                                : "bg-yellow-400"
                          }`}
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 rounded-lg transition flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 p-1">
                          <div className="flex gap-1">
                            {sample.status !== "approved" && (
                              <button
                                onClick={() => handleApproveSample(galleryModal.id, sample.id)}
                                className="bg-green-500 text-white text-xs px-1.5 py-0.5 rounded"
                              >
                                ✓
                              </button>
                            )}
                            {sample.status !== "rejected" && (
                              <button
                                onClick={() => handleRejectSample(galleryModal.id, sample.id)}
                                className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          {galleryModal.gesture_type !== "motion" &&
                            !sample.file_url?.startsWith("landmark_direct_") && (
                            <button
                              onClick={() => handleSetThumbnail(galleryModal, sample.file_url)}
                              disabled={actionLoading}
                              title="Set as Word Bank image"
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-2 py-0.5 rounded disabled:opacity-50"
                            >
                              Use
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
                <span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Approved
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Rejected
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" /> Pending
              </span>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add Word Modal ─────────────────────────────────────── */}
      {addModal && (
        <Modal title="Add Word" onClose={() => setAddModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Label *</label>
              <input
                type="text"
                value={addForm.label}
                onChange={(e) => setAddForm({ ...addForm, label: e.target.value })}
                placeholder="e.g. Hello"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <textarea
                value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                rows={2}
                placeholder="Brief description of the gesture"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Gesture Type</label>
                <select
                  value={addForm.gesture_type}
                  onChange={(e) => setAddForm({ ...addForm, gesture_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="static">Static</option>
                  <option value="motion">Motion</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Hands</label>
                <select
                  value={addForm.hands_count}
                  onChange={(e) => setAddForm({ ...addForm, hands_count: parseInt(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                >
                  <option value={1}>1 Hand</option>
                  <option value={2}>2 Hands</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select
                value={addForm.category}
                onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                {FSL_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Filipino Translation</label>
              <input
                type="text"
                value={addForm.filipino_translation}
                onChange={(e) => setAddForm({ ...addForm, filipino_translation: e.target.value })}
                placeholder="e.g. Kumusta"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <p className="text-xs text-gray-400 bg-blue-50 rounded-lg px-3 py-2">
              The word will be added as <strong>approved but inactive</strong>. Upload gesture samples afterwards to activate it in the mobile app.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleAddWord}
                disabled={actionLoading || !addForm.label.trim()}
                className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Adding..." : "Add Word"}
              </button>
              <button
                onClick={() => setAddModal(false)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Admin Upload Samples Modal ─────────────────────────── */}
      {uploadModal && (
        <Modal title={`Upload Samples — ${uploadModal.label}`} onClose={() => setUploadModal(null)}>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Uploaded samples are automatically marked as approved and count toward the activation threshold
              ({uploadModal.gesture_type === "motion" ? 150 : 100} samples required).
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Gesture Sample File URL *</label>
              <input
                type="url"
                value={uploadForm.file_url}
                onChange={(e) => setUploadForm({ ...uploadForm, file_url: e.target.value })}
                placeholder="https://..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
              <p className="text-xs text-gray-400 mt-1">
                Upload the image to Supabase storage first and paste the public URL here.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sample Count</label>
              <input
                type="number"
                min={1}
                value={uploadForm.sample_count}
                onChange={(e) => setUploadForm({ ...uploadForm, sample_count: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleAdminUpload}
                disabled={actionLoading || !uploadForm.file_url.trim()}
                className="flex-1 bg-purple-700 hover:bg-purple-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Uploading..." : "Upload Samples"}
              </button>
              <button
                onClick={() => setUploadModal(null)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit Modal ─────────────────────────────────────────── */}
      {editModal && (
        <Modal title="Edit Word" onClose={() => setEditModal(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
              <input
                type="text"
                value={editForm.label}
                onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Gesture Type</label>
                <select
                  value={editForm.gesture_type}
                  onChange={(e) => setEditForm({ ...editForm, gesture_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="static">Static</option>
                  <option value="motion">Motion</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Hands</label>
                <select
                  value={editForm.hands_count}
                  onChange={(e) => setEditForm({ ...editForm, hands_count: parseInt(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                >
                  <option value={1}>1 Hand</option>
                  <option value={2}>2 Hands</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select
                value={editForm.category}
                onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                {FSL_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Filipino Translation</label>
              <input
                type="text"
                value={editForm.filipino_translation}
                onChange={(e) => setEditForm({ ...editForm, filipino_translation: e.target.value })}
                placeholder="e.g. Kumusta"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
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

      {/* ── Reject Word Modal ──────────────────────────────────── */}
      {rejectModal && (
        <Modal title="Reject Word" onClose={() => setRejectModal(null)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Rejecting <strong>{rejectModal.label}</strong>. Optionally provide a reason:
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
