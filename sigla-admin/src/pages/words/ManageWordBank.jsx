import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
  adminAddWord,
  adminUploadSamples,
  setWordThumbnail,
  setWordVideo,
  getMotionSequences,
  generateVideoFromSequence,
  activateWord,
} from "../../api/wordApi.js";
import { warnUser } from "../../api/userApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import AppModal from "../../components/AppModal.jsx";
import {
  BookOpen,
  CheckCircle,
  Clock,
  Search,
  Image,
  Plus,
  Upload,
  AlertTriangle,
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

const Badge = ({ value }) => {
  const styles = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    FSL: "bg-blue-100 text-blue-700",
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


// ── Main Component ────────────────────────────────────────────
const ManageWordBank = () => {
  const [searchParams] = useSearchParams();
  const wordIdRef = useRef(searchParams.get("wordId"));
  const [activeTab, setActiveTab] = useState("all");
  const [stats, setStats] = useState(null);
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const [search, setSearch] = useState("");

  const [filterCat, setFilterCat] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Modal state — single object to prevent concurrent conflicts
  const [modal, setModal] = useState({ type: null, data: null });
  const closeModal = () => setModal({ type: null, data: null });
  const galleryModal  = modal.type === "gallery" ? modal.data : null;
  const editModal     = modal.type === "edit"    ? modal.data : null;
  const rejectModal   = modal.type === "reject"  ? modal.data : null;
  const addModal      = modal.type === "add";
  const uploadModal   = modal.type === "upload"  ? modal.data : null;
  const [samples, setSamples] = useState([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [videoInput, setVideoInput] = useState("");
  const [videoLoading, setVideoLoading] = useState(false);
  const [motionSequences, setMotionSequences] = useState([]);
  const [motionSequencesLoading, setMotionSequencesLoading] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [perSeqVideos, setPerSeqVideos] = useState({}); // sample_id -> video_url
  const [perSeqSpeeds, setPerSeqSpeeds] = useState({}); // sample_id -> playback speed
  const [galleryWarnModal, setGalleryWarnModal] = useState(null); // { userId, username }
  const [galleryWarnReason, setGalleryWarnReason] = useState("");
  const [showCriteria, setShowCriteria] = useState(false);

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
    try {
      const params = {};
      if (activeTab !== "all") params.status = activeTab;
      if (search) params.search = search;
      if (filterCat) params.category = filterCat;
      const data = await getAllWords(params);
      setWords(data.words || []);
    } catch {
      toast.error("Failed to load words");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => { fetchWords(); }, [activeTab, search, filterCat]);

  // Open gallery for wordId from URL query param (e.g. from Dashboard pending reviews)
  useEffect(() => {
    if (wordIdRef.current && words.length > 0 && !galleryModal) {
      const word = words.find((w) => String(w.id) === wordIdRef.current);
      if (word) {
        handleOpenGallery(word);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [words, galleryModal]);

  const showSuccess = (msg) => toast.success(msg);
  const showError = (msg) => toast.error(msg);

  // ── Reload samples helper ───────────────────────────────────
  const reloadSamples = async (wordId) => {
    const data = await getWordSamples(wordId);
    setSamples(data.samples || []);
  };

  // ── Open image gallery ──────────────────────────────────────
  const handleOpenGallery = async (word) => {
    setModal({ type: "gallery", data: word });
    setSamplesLoading(true);
    setSamples([]);
    setMotionSequences([]);
    setPerSeqVideos({});
    setPerSeqSpeeds({});
    try {
      const data = await getWordSamples(word.id);
      setSamples(data.samples || []);
      // Fetch motion sequences if this is a motion gesture
      if (word.gesture_type === "motion") {
        setMotionSequencesLoading(true);
        try {
          const seqData = await getMotionSequences(word.id);
          setMotionSequences(seqData.sequences || []);
        } catch (err) {
          console.error("Failed to load motion sequences:", err);
        } finally {
          setMotionSequencesLoading(false);
        }
      }
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
      fetchStats();
      fetchWords();
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

  // ── Warn user from gallery review ──────────────────────────
  const handleWarnFromGallery = async () => {
    if (!galleryWarnModal) return;
    try {
      const res = await warnUser(galleryWarnModal.userId, { reason: galleryWarnReason });
      showSuccess(`Warning issued to ${galleryWarnModal.username}. They now have ${res.warning_count}/2 warnings.`);
      setGalleryWarnModal(null);
      setGalleryWarnReason("");
    } catch (err) {
      showError(err.response?.data?.message || "Failed to issue warning");
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
      showSuccess(`Submission from ${username} approved. User notified with approval details.`);
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
      showSuccess(`Submission from ${username} rejected. User notified to review terms and resubmission instructions.`);
      await reloadSamples(wordId);
      fetchStats();
      fetchWords();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to reject submission");
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
    setModal({ type: "reject", data: word });
  };

  const handleRejectConfirm = async () => {
    setActionLoading(true);
    try {
      await rejectWord(rejectModal.id, rejectReason);
      showSuccess("Word rejected. User will be notified.");
      closeModal();
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
    filipino_translation: "", sample_limit: "",
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
      sample_limit: word.sample_limit != null ? String(word.sample_limit) : "",
    });
    setModal({ type: "edit", data: word });
  };

  const handleEditSave = async () => {
    const limitVal = editForm.sample_limit.trim();
    if (limitVal !== "" && (isNaN(parseInt(limitVal)) || parseInt(limitVal) < 1)) {
      showError("Sample limit must be a positive number or left blank for default");
      return;
    }
    setActionLoading(true);
    try {
      await updateWord(editModal.id, {
        ...editForm,
        sample_limit: limitVal === "" ? null : parseInt(limitVal),
      });
      showSuccess("Word updated successfully");
      closeModal();
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
      closeModal();
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
  const [uploadForm, setUploadForm] = useState({ files: [] });

  const handleOpenUpload = (word) => {
    setUploadForm({ files: [] });
    setModal({ type: "upload", data: word });
  };

  const handleAdminUpload = async () => {
    if (!uploadForm.files.length) { showError("Please select at least one image"); return; }
    setActionLoading(true);
    try {
      const toBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const images = await Promise.all(uploadForm.files.map(toBase64));
      const res = await adminUploadSamples(uploadModal.id, { images });
      showSuccess(res.message || `${uploadForm.files.length} sample(s) uploaded successfully`);
      closeModal();
      fetchStats();
      fetchWords();
      if (galleryModal) await reloadSamples(galleryModal.id);
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
      setModal((prev) => prev.type === "gallery" ? { type: "gallery", data: { ...prev.data, thumbnail_url: imageUrl } } : prev);
      fetchWords();
      showSuccess("Word bank image updated");
    } catch (err) {
      showError(err.response?.data?.message || "Failed to set thumbnail");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Activate static word ──────────────────────────────────────
  const handleActivateStaticWord = async () => {
    setActionLoading(true);
    try {
      await activateWord(galleryModal.id);
      setModal((prev) => prev.type === "gallery" ? { type: "gallery", data: { ...prev.data, is_active: true } } : prev);
      fetchWords();
      showSuccess("Word activated and now visible in the mobile app");
    } catch (err) {
      showError(err.response?.data?.message || "Failed to activate word");
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
      setModal((prev) => prev.type === "gallery" ? { type: "gallery", data: { ...prev.data, video_url: videoUrl.trim() } } : prev);
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
        setModal((prev) => prev.type === "gallery" ? { type: "gallery", data: { ...prev.data, video_url: res.video_url } } : prev);
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

  // ── Gallery threshold helpers ────────────────────────────────
  const motionThreshold = 25;
  const approvedCount = galleryModal?.approved_sample_count || 0;
  const thresholdMet = approvedCount >= motionThreshold;
  const remaining = motionThreshold - approvedCount;

  // ── JSX ─────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1f2937", margin: 0 }}>Manage Word Bank</h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: 4 }}>
            Review and manage gesture word submissions
          </p>
        </div>
        <button
          onClick={() => setModal({ type: "add", data: null })}
          className="flex items-center gap-2 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          <Plus size={16} /> Add Word
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <StatCard title="Total Words" value={stats?.total} icon={BookOpen} color="bg-blue-900" />
        <StatCard title="Pending" value={stats?.pending} icon={Clock} color="bg-yellow-500" />
        <StatCard title="Approved" value={stats?.approved} icon={CheckCircle} color="bg-green-500" />
      </div>

      {/* Ready-to-activate banner */}
      {stats?.ready_to_activate > 0 && (
        <div className="mb-6 flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-indigo-800">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="shrink-0"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/></svg>
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
      <div className="dash-card overflow-x-auto">
        <div className="dash-card-header flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">Word List</h3>
          <span className="text-xs text-gray-500">{words.length} word{words.length !== 1 ? "s" : ""}</span>
        </div>
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
                      {(() => {
                        const defaultCap = 25;
                        const limit = word.sample_limit != null ? word.sample_limit : defaultCap;
                        const total = word.total_samples || 0;
                        const reached = total >= limit;
                        return (
                          <span className={`block text-xs mt-0.5 ${reached ? "text-red-600 font-medium" : "text-gray-400"}`}>
                            {total}/{limit} collected{reached ? " — full" : ""}
                          </span>
                        );
                      })()}
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
                          disabled={(word.total_samples || 0) > 0}
                          title={(word.total_samples || 0) > 0 ? "Samples already collected for this word" : "Upload gesture samples"}
                          className={`text-xs px-2 py-1 rounded-lg flex items-center gap-1 ${(word.total_samples || 0) > 0 ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-purple-50 text-purple-700 hover:bg-purple-100"}`}
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
        <AppModal title={`Gesture Samples — ${galleryModal.label}`} onClose={closeModal} wide>
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

            {/* ── Review Criteria ──────────────────────────────── */}
            <div className="border border-yellow-200 rounded-lg bg-yellow-50">
              <button
                onClick={() => setShowCriteria((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-yellow-800 hover:bg-yellow-100 rounded-lg transition"
              >
                <span>Review Criteria</span>
                <span>{showCriteria ? "▲" : "▾"}</span>
              </button>
              {showCriteria && (
                <ol className="px-5 pb-3 pt-1 text-xs text-yellow-900 space-y-1 list-decimal list-inside">
                  <li>The hand gesture is clearly visible</li>
                  <li>The gesture formation is correct</li>
                  <li>The hand is fully visible and not cut off</li>
                  <li>The camera framing is appropriate</li>
                  <li>The image does not contain unrelated or inappropriate content</li>
                </ol>
              )}
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
                    <p className="text-xs text-green-600">Hover an approved sample below and click <strong>Use</strong>, or click <strong>Set as Word Bank Image</strong> to change it.</p>
                  </div>
                </div>
              )
            )}

            {/* Activate button - Static words only */}
            {galleryModal.gesture_type === "static" && !galleryModal.is_active && galleryModal.thumbnail_url && (
              <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-blue-800">Ready to Activate</p>
                  <p className="text-xs text-blue-600">A display image is set. Click Activate to publish this word to the mobile app.</p>
                </div>
                <button
                  onClick={handleActivateStaticWord}
                  disabled={actionLoading}
                  className="shrink-0 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  Activate Word
                </button>
              </div>
            )}

            {/* Motion Sequences Section - Only for motion gestures */}
            {galleryModal.gesture_type === "motion" && !thresholdMet && (
              <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                {approvedCount}/{motionThreshold} approved samples — activation requires {remaining} more approved sample{remaining !== 1 ? "s" : ""}.
              </div>
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
                          <button
                            onClick={() => { setGalleryWarnReason(""); setGalleryWarnModal({ userId: group.userId, username: group.username }); }}
                            className="text-xs bg-orange-50 text-orange-700 hover:bg-orange-100 px-2 py-1 rounded flex items-center gap-1"
                          >
                            <AlertTriangle size={11} /> Warn User
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

                  {/* Motion samples: grouped by sequence */}
                  <div className="p-3 space-y-3">
                    {group.samples.map((sample) => {
                      const frameUrls = sample.file_url?.split("|").filter(Boolean) || [];
                      const isMotionSequence = frameUrls.length > 1;

                      return (
                        <div key={sample.id} className="border border-gray-100 rounded-lg overflow-hidden bg-white">
                          {/* Sequence header */}
                          <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
                            <div className="text-xs font-medium text-gray-600">
                              Sequence
                              <span className="ml-1.5 text-[10px] text-gray-400">
                                #{sample.id} · {frameUrls.length} frames · {new Date(sample.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge value={sample.status} />
                              {isMotionSequence && sample.status === "approved" && (
                                <button
                                  onClick={async () => {
                                    setGeneratingVideo(true);
                                    try {
                                      const res = await generateVideoFromSequence(galleryModal.id, [sample.id]);
                                      setPerSeqVideos(prev => ({ ...prev, [sample.id]: res.video_url }));
                                      showSuccess("Video generated — watch it below");
                                    } catch (err) {
                                      showError(err.response?.data?.message || "Failed to generate video");
                                    } finally {
                                      setGeneratingVideo(false);
                                    }
                                  }}
                                  disabled={generatingVideo}
                                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-0.5 rounded-lg flex items-center gap-1 disabled:opacity-50"
                                >
                                  {generatingVideo ? (
                                    <>
                                      <div className="animate-spin rounded-full h-2.5 w-2.5 border-b-2 border-white" />
                                      Generating...
                                    </>
                                  ) : (
                                    <>
                                      <Upload size={10} />
                                      Generate Video
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Generated video preview — approved motion sequences only */}
                          {isMotionSequence && sample.status === "approved" && perSeqVideos[sample.id] && (
                            <div className="border-t border-indigo-200 bg-indigo-50 p-3">
                              <video
                                id={`gen-video-${sample.id}`}
                                src={
                                  perSeqVideos[sample.id].startsWith("/")
                                    ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${perSeqVideos[sample.id]}`
                                    : perSeqVideos[sample.id]
                                }
                                controls
                                className="w-full max-w-md rounded-lg border border-indigo-300 bg-black"
                                autoPlay
                                loop
                              />
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs text-indigo-700 font-medium">Speed:</span>
                                <select
                                  value={perSeqSpeeds[sample.id] ?? 1}
                                  onChange={(e) => {
                                    const speed = parseFloat(e.target.value);
                                    setPerSeqSpeeds(prev => ({ ...prev, [sample.id]: speed }));
                                    const el = document.getElementById(`gen-video-${sample.id}`);
                                    if (el) el.playbackRate = speed;
                                  }}
                                  className="text-xs border border-indigo-300 rounded px-2 py-1 bg-white"
                                >
                                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map(s => (
                                    <option key={s} value={s}>{s}×</option>
                                  ))}
                                </select>
                              </div>
                              <div className="mt-2 flex gap-2">
                                <button
                                  onClick={async () => {
                                    try {
                                      await setWordVideo(galleryModal.id, {
                                        video_url: perSeqVideos[sample.id],
                                        playback_speed: perSeqSpeeds[sample.id] ?? 1,
                                      });
                                      await activateWord(galleryModal.id);
                                      setModal((prev) => prev.type === "gallery" ? { type: "gallery", data: { ...prev.data, video_url: perSeqVideos[sample.id], is_active: true } } : prev);
                                      fetchWords();
                                      showSuccess("Video set and word activated");
                                    } catch (err) {
                                      showError(err.response?.data?.message || "Failed to set video");
                                    }
                                  }}
                                  disabled={!thresholdMet}
                                  title={!thresholdMet ? `Requires ${motionThreshold} approved samples (${remaining} more needed)` : undefined}
                                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Set as Word Bank Video
                                </button>
                                <a
                                  href={
                                    perSeqVideos[sample.id].startsWith("/")
                                      ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${perSeqVideos[sample.id]}`
                                      : perSeqVideos[sample.id]
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs bg-white border border-indigo-300 hover:bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg"
                                >
                                  Download
                                </a>
                              </div>
                            </div>
                          )}

                          {/* Frame grid */}
                          {isMotionSequence ? (
                            <div className="flex gap-1 p-2 overflow-x-auto">
                              {frameUrls.map((url, frameIdx) => {
                                const fullUrl = url.startsWith("/")
                                  ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${url}`
                                  : url;
                                return (
                                  <div
                                    key={frameIdx}
                                    className="flex-shrink-0 w-16 h-16 relative group rounded overflow-hidden border border-gray-200"
                                  >
                                    <img
                                      src={fullUrl}
                                      alt={`frame-${frameIdx}`}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        e.target.onerror = null;
                                        e.target.src = `https://via.placeholder.com/64?text=F${frameIdx + 1}`;
                                      }}
                                    />
                                    <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-[8px] text-center">
                                      F{frameIdx + 1}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : frameUrls.length === 1 ? (
                            <div className="p-2 flex flex-col gap-1.5">
                              <div className="w-20 h-20 relative group rounded-lg overflow-hidden border border-gray-200">
                                <img
                                  src={frameUrls[0].startsWith("/")
                                    ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${frameUrls[0]}`
                                    : frameUrls[0]}
                                  alt={`sample-${sample.id}`}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src = "https://via.placeholder.com/80?text=No+Image";
                                  }}
                                />
                                {sample.status === "approved" && (
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => {
                                        const imgUrl = frameUrls[0].startsWith("/")
                                          ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${frameUrls[0]}`
                                          : frameUrls[0];
                                        handleSetThumbnail(galleryModal, imgUrl);
                                      }}
                                      disabled={actionLoading}
                                      className="text-white text-[9px] font-bold bg-green-600 hover:bg-green-700 px-2 py-1 rounded leading-tight"
                                    >
                                      Use
                                    </button>
                                  </div>
                                )}
                              </div>
                              {sample.status === "approved" && (
                                <button
                                  onClick={() => {
                                    const imgUrl = frameUrls[0].startsWith("/")
                                      ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${frameUrls[0]}`
                                      : frameUrls[0];
                                    handleSetThumbnail(galleryModal, imgUrl);
                                  }}
                                  disabled={actionLoading}
                                  className="text-[10px] bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded-md whitespace-nowrap disabled:opacity-50"
                                >
                                  Set as Word Bank Image
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="w-16 h-16 m-2 flex flex-col items-center justify-center bg-indigo-50 rounded-lg border-2 border-gray-200">
                              <span className="text-2xl">🖐</span>
                              <span className="text-[10px] text-indigo-500">Landmark only</span>
                            </div>
                          )}
                          {/* Approve/Reject buttons per sequence */}
                          <div className="flex gap-1 px-3 pb-2">
                            {sample.status !== "approved" && (
                              <button
                                onClick={() => handleApproveSample(galleryModal.id, sample.id)}
                                className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-0.5 rounded"
                              >
                                ✓ Approve
                              </button>
                            )}
                            {sample.status !== "rejected" && (
                              <button
                                onClick={() => handleRejectSample(galleryModal.id, sample.id)}
                                className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-2 py-0.5 rounded"
                              >
                                ✕ Reject
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
        </AppModal>
      )}

      {/* ── Add Word Modal ─────────────────────────────────────── */}
      {addModal && (
        <AppModal title="Add Word" onClose={closeModal}>
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
                onClick={closeModal}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {/* ── Admin Upload Samples Modal ─────────────────────────── */}
      {uploadModal && (
        <AppModal title={`Upload Samples — ${uploadModal.label}`} onClose={closeModal}>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Select gesture images from your device. The system will automatically extract hand landmark
              coordinates from each image using MediaPipe. Uploaded samples are automatically marked as
              approved and count toward the activation threshold
              (25 samples required).
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Gesture Images *</label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(e) => setUploadForm({ files: Array.from(e.target.files) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
              />
              {uploadForm.files.length > 0 && (
                <p className="text-xs text-green-600 mt-1">
                  {uploadForm.files.length} image(s) selected
                </p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleAdminUpload}
                disabled={actionLoading || !uploadForm.files.length}
                className="flex-1 bg-purple-700 hover:bg-purple-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Uploading..." : "Upload Samples"}
              </button>
              <button
                onClick={closeModal}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {/* ── Edit Modal ─────────────────────────────────────────── */}
      {editModal && (
        <AppModal title="Edit Word" onClose={closeModal}>
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
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sample Limit</label>
              <input
                type="number"
                min="1"
                value={editForm.sample_limit}
                onChange={(e) => setEditForm({ ...editForm, sample_limit: e.target.value })}
                placeholder={`Default: 25`}
className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
              <p className="text-xs text-gray-400 mt-1">
                Total gesture samples to collect across all users. Each user can contribute up to 25 samples individually. Leave blank to use the default (25).
              </p>
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
                onClick={closeModal}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {/* ── Warn User from Gallery Modal ──────────────────────── */}
      {galleryWarnModal && (
        <AppModal title={`Issue Warning to ${galleryWarnModal.username}`} onClose={() => setGalleryWarnModal(null)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600 leading-relaxed">
              Issue a warning to <strong>{galleryWarnModal.username}</strong> for submitting
              inappropriate or non-compliant gesture samples. After 2 warnings their account can be deactivated.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Reason <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={galleryWarnReason}
                onChange={(e) => setGalleryWarnReason(e.target.value)}
                placeholder="Describe the reason for this warning..."
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleWarnFromGallery}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 rounded-lg transition"
              >
                Issue Warning
              </button>
              <button
                onClick={() => setGalleryWarnModal(null)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {/* ── Reject Word Modal ──────────────────────────────────── */}
      {rejectModal && (
        <AppModal title="Reject Word" onClose={closeModal}>
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
                onClick={closeModal}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
};

export default ManageWordBank;
