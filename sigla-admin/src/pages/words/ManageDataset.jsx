import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppModal from "../../components/AppModal.jsx";
import {
  getAllWords,
  adminAddWord,
  activateWord,
  deleteWord,
  uploadVideos,
} from "../../api/wordApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import {
  Database,
  Plus,
  Upload,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ChevronLeft,
  ChevronRight,
  Search,
  Loader2,
  Brain,
} from "lucide-react";

const C = {
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  border: "#e5e7eb",
  muted: "#9ca3af",
  green: "#22c55e",
  red: "#ef4444",
};

const PAGE_SIZE = 10;

// ── Add Word Modal ────────────────────────────────────────────
const AddWordModal = ({ open, onClose, onSuccess }) => {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    label: "",
    description: "",
    category: "",
    gesture_type: "static",
    hands_count: 1,
    sign_type: "FSL",
    filipino_translation: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.label) return showToast("Label is required", "error");
    setSaving(true);
    try {
      await adminAddWord({ ...form });
      showToast(`Word "${form.label}" added successfully`, "success");
      onSuccess();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to add word", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <AppModal title="Add New Word" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
        <div>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Label *</label>
          <input
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value.toUpperCase() }))}
            placeholder="e.g. HELLO, BANANA, GOOD MORNING"
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Category</label>
          <input
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            placeholder="e.g. greeting, food, color..."
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Filipino Translation</label>
          <input
            value={form.filipino_translation}
            onChange={e => setForm(f => ({ ...f, filipino_translation: e.target.value }))}
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Description</label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", resize: "vertical", boxSizing: "border-box" }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Gesture Type</label>
          <select value={form.gesture_type} onChange={e => setForm(f => ({ ...f, gesture_type: e.target.value }))}
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px" }}>
            <option value="static">Static</option>
            <option value="motion">Motion</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Hands</label>
          <select value={form.hands_count} onChange={e => setForm(f => ({ ...f, hands_count: Number(e.target.value) }))}
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px" }}>
            <option value={1}>One Hand</option>
            <option value={2}>Both Hands</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: "0.875rem" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving || !form.label}
          style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: C.primary, color: "white", cursor: saving || !form.label ? "not-allowed" : "pointer", fontSize: "0.875rem", fontWeight: 600, opacity: saving || !form.label ? 0.7 : 1, display: "flex", alignItems: "center", gap: "6px" }}>
          {saving && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
          Add Word
        </button>
      </div>
    </AppModal>
  );
};

// ── Upload Videos Modal ───────────────────────────────────────
const UploadVideosModal = ({ word, open, onClose, onSuccess }) => {
  const { showToast } = useToast();
  const fileRef = useRef();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  const handleFiles = (e) => {
    setFiles(Array.from(e.target.files));
    setResults(null);
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    setProgress(0);
    try {
      const data = await uploadVideos(word.id, files, (e) => {
        if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
      });
      setResults(data.results);
      showToast(`${files.length} video(s) processed`, "success");
      onSuccess();
    } catch (err) {
      showToast(err.response?.data?.message || "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return (
    <AppModal title={`Upload Videos — ${word?.label}`} onClose={onClose}>
      <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "16px" }}>
        Upload video clips for this word. Landmarks will be extracted automatically using MediaPipe.
      </p>
      <p style={{ fontSize: "0.8rem", color: "#374151", marginBottom: "12px" }}>
        Gesture type: <strong>{word?.gesture_type}</strong> &nbsp;|&nbsp; Hands: <strong>{word?.hands_count === 1 ? "One" : "Both"}</strong>
      </p>

      <div
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${C.border}`, borderRadius: "10px", padding: "32px", textAlign: "center",
          cursor: "pointer", marginBottom: "16px", background: "#f9fafb",
        }}
      >
        <Upload size={28} style={{ color: C.muted, margin: "0 auto 8px" }} />
        <p style={{ fontSize: "0.875rem", color: "#374151" }}>Click to select video files (.MOV, .MP4)</p>
        <p style={{ fontSize: "0.75rem", color: C.muted }}>Up to 50 files at once</p>
        <input ref={fileRef} type="file" accept="video/*,.mov" multiple style={{ display: "none" }} onChange={handleFiles} />
      </div>

      {files.length > 0 && !results && (
        <p style={{ fontSize: "0.875rem", color: "#374151", marginBottom: "12px" }}>
          {files.length} file(s) selected
        </p>
      )}

      {uploading && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>
            <span>Uploading & extracting landmarks...</span>
            <span>{progress}%</span>
          </div>
          <div style={{ background: C.border, borderRadius: "4px", height: "6px" }}>
            <div style={{ height: "6px", borderRadius: "4px", background: C.primary, width: `${progress}%`, transition: "width 0.2s" }} />
          </div>
        </div>
      )}

      {results && (
        <div style={{ maxHeight: "160px", overflowY: "auto", marginBottom: "16px", border: `1px solid ${C.border}`, borderRadius: "8px" }}>
          {results.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "0.8rem" }}>
              <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{r.file}</span>
              <span style={{ color: r.status === "ok" ? C.green : C.red, fontWeight: 600 }}>{r.status === "ok" ? "OK" : "Failed"}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: "0.875rem" }}>
          {results ? "Close" : "Cancel"}
        </button>
        {!results && (
          <button onClick={handleUpload} disabled={!files.length || uploading}
            style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: C.primary, color: "white", cursor: !files.length || uploading ? "not-allowed" : "pointer", fontSize: "0.875rem", fontWeight: 600, opacity: !files.length || uploading ? 0.7 : 1, display: "flex", alignItems: "center", gap: "6px" }}>
            {uploading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
            Upload & Extract
          </button>
        )}
      </div>
    </AppModal>
  );
};

// ── Main Page ─────────────────────────────────────────────────
const ManageDataset = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [words, setWords] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterGesture, setFilterGesture] = useState("");
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [uploadWord, setUploadWord] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchWords = async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (search) params.search = search;
      if (filterCategory) params.category = filterCategory;
      if (filterGesture) params.gesture_type = filterGesture;
      const data = await getAllWords(params);
      setWords(data.words || []);
      setTotal(data.total || 0);
    } catch {
      showToast("Failed to load words", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWords(); }, [page]);
  useEffect(() => { setPage(1); fetchWords(); }, [search, filterCategory, filterGesture]);

  const handleActivate = async (word) => {
    try {
      await activateWord(word.id);
      showToast(`"${word.label}" ${word.is_active ? "deactivated" : "activated"}`, "success");
      fetchWords();
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to update", "error");
    }
  };

  const handleDelete = async (word) => {
    try {
      await deleteWord(word.id);
      showToast(`"${word.label}" deleted`, "success");
      setDeleteConfirm(null);
      fetchWords();
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to delete", "error");
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const categories = [...new Set(words.map(w => w.category).filter(Boolean))];

  return (
    <div style={{ padding: "24px" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Database size={24} color={C.primary} />
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1f2937", margin: 0 }}>Manage Dataset</h1>
            <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>{total} word(s) in database</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => navigate("/model")} style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "10px 18px",
            background: "white", color: C.primary, border: `1px solid ${C.primary}`, borderRadius: "10px",
            fontWeight: 600, cursor: "pointer", fontSize: "0.875rem",
          }}>
            <Brain size={16} /> Train Model
          </button>
          <button onClick={() => setAddOpen(true)} style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "10px 18px",
            background: C.primary, color: "white", border: "none", borderRadius: "10px",
            fontWeight: 600, cursor: "pointer", fontSize: "0.875rem",
          }}>
            <Plus size={16} /> Add Word
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="dash-card" style={{ marginBottom: "16px", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: C.muted }} />
          <input
            placeholder="Search words..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", padding: "8px 8px 8px 32px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", boxSizing: "border-box" }}
          />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", minWidth: "140px" }}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c.toLowerCase()}>{c}</option>)}
        </select>
        <select value={filterGesture} onChange={e => setFilterGesture(e.target.value)}
          style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem" }}>
          <option value="">All Gestures</option>
          <option value="static">Static</option>
          <option value="motion">Motion</option>
        </select>
      </div>

      {/* Table */}
      <div className="dash-card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.border}` }}>
              {["Label", "Category", "Gesture", "Hands", "Samples", "Status", "Actions"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={{ padding: "10px 12px" }}>
                      <div style={{ height: "14px", background: "#f3f4f6", borderRadius: "4px", animation: "pulse 1.5s infinite" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : words.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "40px", color: C.muted }}>
                  No words found. Add your first word using the button above.
                </td>
              </tr>
            ) : words.map(word => (
              <tr key={word.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1f2937" }}>{word.label}</td>
                <td style={{ padding: "10px 12px", color: "#6b7280", textTransform: "capitalize" }}>{word.category || "—"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 600,
                    background: word.gesture_type === "motion" ? "#fef3c7" : "#eff6ff",
                    color: word.gesture_type === "motion" ? "#92400e" : "#1e40af" }}>
                    {word.gesture_type}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", color: "#6b7280" }}>{word.hands_count === 1 ? "One" : "Both"}</td>
                <td style={{ padding: "10px 12px", color: "#374151" }}>{word.approved_sample_count ?? 0}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 600,
                    background: word.is_active ? "#dcfce7" : "#f3f4f6",
                    color: word.is_active ? "#166534" : "#6b7280" }}>
                    {word.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <button title="Upload videos" onClick={() => setUploadWord(word)}
                      style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 10px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: "0.8rem", color: "#374151" }}>
                      <Upload size={14} /> Videos
                    </button>
                    <button title={word.is_active ? "Deactivate" : "Activate"} onClick={() => handleActivate(word)}
                      style={{ padding: "6px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", display: "flex", alignItems: "center" }}>
                      {word.is_active
                        ? <ToggleRight size={18} color={C.green} />
                        : <ToggleLeft size={18} color={C.muted} />}
                    </button>
                    <button title="Delete" onClick={() => setDeleteConfirm(word)}
                      style={{ padding: "6px", borderRadius: "6px", border: `1px solid #fecaca`, background: "#fff5f5", cursor: "pointer", display: "flex", alignItems: "center" }}>
                      <Trash2 size={14} color={C.red} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {total > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 12px", borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ padding: "6px 12px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.5 : 1, display: "flex", alignItems: "center" }}>
                <ChevronLeft size={16} />
              </button>
              <span style={{ padding: "6px 12px", fontSize: "0.875rem", color: "#374151" }}>{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                style={{ padding: "6px 12px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: page === totalPages ? "not-allowed" : "pointer", opacity: page === totalPages ? 0.5 : 1, display: "flex", alignItems: "center" }}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <AddWordModal open={addOpen} onClose={() => setAddOpen(false)} onSuccess={fetchWords} />

      {uploadWord && (
        <UploadVideosModal
          word={uploadWord}
          open={!!uploadWord}
          onClose={() => setUploadWord(null)}
          onSuccess={fetchWords}
        />
      )}

      {deleteConfirm && (
        <AppModal title="Delete Word" onClose={() => setDeleteConfirm(null)}>
          <p style={{ fontSize: "0.9rem", color: "#374151", marginBottom: "24px" }}>
            Are you sure you want to delete <strong>"{deleteConfirm.label}"</strong>? This will also remove all its gesture samples.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button onClick={() => setDeleteConfirm(null)} style={{ padding: "8px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: "0.875rem" }}>Cancel</button>
            <button onClick={() => handleDelete(deleteConfirm)}
              style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: C.red, color: "white", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}>
              Delete
            </button>
          </div>
        </AppModal>
      )}
    </div>
  );
};

export default ManageDataset;
