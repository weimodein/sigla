import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppModal from "../../components/AppModal.jsx";
import {
  getAllWords,
  adminAddWord,
  updateWord,
  deleteWord,
  uploadVideos,
  setWordVideo,
} from "../../api/wordApi.js";
import { getCategories } from "../../api/categoryApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import {
  Plus,
  Upload,
  Film,
  Trash2,
  Pencil,
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

// ── Word Form Modal (Add or Edit) ─────────────────────────────
const WordFormModal = ({ open, mode, word, onClose, onSuccess }) => {
  const { success, error: errorToast } = useToast();
  const [form, setForm] = useState({
    label: "",
    description: "",
    category: "",
    sign_type: "FSL",
    filipino_translation: "",
  });
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);

  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;
    getCategories()
      .then(d => setCategories(d.categories || []))
      .catch(() => setCategories([]));
    if (isEdit && word) {
      setForm({
        label: word.label || "",
        description: word.description || "",
        category: word.category || "",
        sign_type: word.sign_type || "FSL",
        filipino_translation: word.filipino_translation || "",
      });
    } else {
      setForm({
        label: "",
        description: "",
        category: "",
        sign_type: "FSL",
        filipino_translation: "",
      });
    }
  }, [open, isEdit, word]);

  const handleSubmit = async () => {
    if (!form.label) return errorToast("Label is required");
    setSaving(true);
    try {
      if (isEdit) {
        await updateWord(word.id, form);
        success(`Word "${form.label}" updated`);
      } else {
        await adminAddWord({ ...form });
        success(`Word "${form.label}" added successfully`);
      }
      onClose();
      onSuccess();
    } catch (err) {
      errorToast(err.response?.data?.message || `Failed to ${isEdit ? "update" : "add"} word`);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <AppModal title={isEdit ? `Edit Word — ${word?.label}` : "Add New Word"} onClose={onClose}>
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
          <select
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", boxSizing: "border-box", background: "white" }}
          >
            <option value="">— Select category —</option>
            {categories.map(c => (
              <option key={c.id} value={c.name} style={{ textTransform: "capitalize" }}>{c.name}</option>
            ))}
            {/* If editing a word whose category is not in the list (e.g. legacy), still allow keeping it */}
            {form.category && !categories.some(c => c.name.toLowerCase() === form.category.toLowerCase()) && (
              <option value={form.category}>{form.category} (legacy)</option>
            )}
          </select>
          {categories.length === 0 && (
            <p style={{ fontSize: "0.75rem", color: C.muted, marginTop: "4px" }}>
              No categories yet. Create one in Manage Categories.
            </p>
          )}
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

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: "0.875rem" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving || !form.label}
          style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: C.primary, color: "white", cursor: saving || !form.label ? "not-allowed" : "pointer", fontSize: "0.875rem", fontWeight: 600, opacity: saving || !form.label ? 0.7 : 1, display: "flex", alignItems: "center", gap: "6px" }}>
          {saving && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
          {isEdit ? "Save Changes" : "Add Word"}
        </button>
      </div>
    </AppModal>
  );
};

// ── Upload Videos Modal ───────────────────────────────────────
const UploadVideosModal = ({ word, open, onClose, onSuccess }) => {
  const { success, error: errorToast } = useToast();
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
      success(`${files.length} file(s) processed`);
      onSuccess();
    } catch (err) {
      errorToast(err.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return (
    <AppModal title={`Upload Files — ${word?.label}`} onClose={onClose}>
      <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "16px" }}>
        Upload video clips (.MOV, .MP4). Landmarks are extracted automatically with MediaPipe.
      </p>

      <div
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${C.border}`, borderRadius: "10px", padding: "32px", textAlign: "center",
          cursor: "pointer", marginBottom: "16px", background: "#f9fafb",
        }}
      >
        <Upload size={28} style={{ color: C.muted, margin: "0 auto 8px" }} />
        <p style={{ fontSize: "0.875rem", color: "#374151" }}>
          Click to select video files (.MOV, .MP4)
        </p>
        <p style={{ fontSize: "0.75rem", color: C.muted }}>Up to 50 files at once</p>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.mov"
          multiple
          style={{ display: "none" }}
          onChange={handleFiles}
        />
      </div>

      {files.length > 0 && !results && (
        <p style={{ fontSize: "0.875rem", color: "#374151", marginBottom: "12px" }}>
          {files.length} file(s) selected
        </p>
      )}

      {uploading && (
        <div style={{ marginBottom: "16px" }}>
          {progress < 100 ? (
            // Phase 1: browser is uploading the video bytes — show real % progress.
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>
                <span>Uploading files...</span>
                <span>{progress}%</span>
              </div>
              <div style={{ background: C.border, borderRadius: "4px", height: "6px" }}>
                <div style={{ height: "6px", borderRadius: "4px", background: C.primary, width: `${progress}%`, transition: "width 0.2s" }} />
              </div>
            </>
          ) : (
            // Phase 2: upload done — the server is now extracting landmarks (MediaPipe,
            // ~a few seconds per clip). This has no measurable %, so show an indeterminate state.
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8rem", color: "#6b7280" }}>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
              <span>Extracting landmarks on server… this can take a moment for many clips.</span>
            </div>
          )}
        </div>
      )}

      {results && (
        <div style={{ maxHeight: "200px", overflowY: "auto", marginBottom: "16px", border: `1px solid ${C.border}`, borderRadius: "8px" }}>
          {results.map((r, i) => {
            const statusColor =
              r.status === "ok" ? C.green : r.status === "skipped" ? "#d97706" : C.red;
            const statusLabel =
              r.status === "ok" ? "OK" : r.status === "skipped" ? "Skipped" : "Failed";
            return (
              <div key={i} style={{ padding: "6px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "0.8rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                    {r.file}
                  </span>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                    {r.type && r.type !== "unknown" && (
                      <span style={{ padding: "1px 6px", borderRadius: "8px", fontSize: "0.65rem", fontWeight: 600, background: r.type === "image" ? "#fef3c7" : "#eff6ff", color: r.type === "image" ? "#92400e" : "#1e40af", textTransform: "uppercase" }}>
                        {r.type}
                      </span>
                    )}
                    <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                  </div>
                </div>
                {(r.reason || r.error) && (
                  <p style={{ marginTop: "2px", fontSize: "0.7rem", color: C.muted }}>
                    {r.reason || r.error}
                  </p>
                )}
              </div>
            );
          })}
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

// ── Demo Video Modal (single demonstration clip for the mobile app) ──
const DemoVideoModal = ({ word, open, onClose, onSuccess }) => {
  const { success, error: errorToast } = useToast();
  const fileRef = useRef();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const currentUrl = word?.video_url
    ? word.video_url.startsWith("/")
      ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${word.video_url}`
      : word.video_url
    : null;

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const ext = file.name.split(".").pop().toLowerCase();
      await setWordVideo(word.id, { video_base64: base64, video_ext: ext });
      success("Demo video updated");
      onSuccess();
      onClose();
    } catch (err) {
      errorToast(err.response?.data?.message || "Failed to set demo video");
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return (
    <AppModal title={`Demo Video — ${word?.label}`} onClose={onClose}>
      <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "16px" }}>
        This is the single demonstration video shown to learners in the mobile app.
        Uploading replaces any existing demo video. (This does not add training samples.)
      </p>

      {currentUrl && (
        <p style={{ fontSize: "0.8rem", marginBottom: "16px" }}>
          <a href={currentUrl} target="_blank" rel="noreferrer" style={{ color: C.secondary, textDecoration: "underline" }}>
            View current demo video ↗
          </a>
        </p>
      )}

      <div
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${C.border}`, borderRadius: "10px", padding: "32px", textAlign: "center",
          cursor: "pointer", marginBottom: "16px", background: "#f9fafb",
        }}
      >
        <Film size={28} style={{ color: C.muted, margin: "0 auto 8px" }} />
        <p style={{ fontSize: "0.875rem", color: "#374151" }}>
          Click to select one demo video (.MOV, .MP4)
        </p>
        <p style={{ fontSize: "0.75rem", color: C.muted }}>A single file — replaces the current demo video</p>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.mov"
          style={{ display: "none" }}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </div>

      {file && (
        <p style={{ fontSize: "0.875rem", color: "#374151", marginBottom: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Selected: {file.name}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: "0.875rem" }}>
          Cancel
        </button>
        <button onClick={handleUpload} disabled={!file || uploading}
          style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: C.primary, color: "white", cursor: !file || uploading ? "not-allowed" : "pointer", fontSize: "0.875rem", fontWeight: 600, opacity: !file || uploading ? 0.7 : 1, display: "flex", alignItems: "center", gap: "6px" }}>
          {uploading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
          {word?.video_url ? "Replace Video" : "Upload Video"}
        </button>
      </div>
    </AppModal>
  );
};

// ── Main Page ─────────────────────────────────────────────────
const ManageWord = () => {
  const { success, error: errorToast } = useToast();
  const navigate = useNavigate();
  const [words, setWords] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editWord, setEditWord] = useState(null);
  const [uploadWord, setUploadWord] = useState(null);
  const [demoVideoWord, setDemoVideoWord] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchWords = async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (search) params.search = search;
      if (filterCategory) params.category = filterCategory;
      const data = await getAllWords(params);
      setWords(data.words || []);
      setTotal(data.total || 0);
    } catch {
      errorToast("Failed to load words");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWords(); }, [page]);
  useEffect(() => { setPage(1); fetchWords(); }, [search, filterCategory]);

  const handleDelete = async (word) => {
    try {
      await deleteWord(word.id);
      success(`"${word.label}" deleted`);
      setDeleteConfirm(null);
      fetchWords();
    } catch (err) {
      errorToast(err.response?.data?.message || "Failed to delete");
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const categories = [...new Set(words.map(w => w.category).filter(Boolean))];

  return (
    <div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1f2937", margin: 0 }}>
            Manage Words
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#6b7280", margin: "4px 0 0" }}>
            {total} word(s) in database
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={() => navigate("/model")}
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "8px 16px", background: "white", color: C.primary,
              border: `1px solid ${C.primary}`, borderRadius: "8px",
              fontSize: "0.85rem", fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Brain size={16} /> Train Model
          </button>
          <button
            onClick={() => setAddOpen(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "8px 16px", background: C.primary, color: "white",
              border: "none", borderRadius: "8px",
              fontSize: "0.85rem", fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Plus size={16} /> Add Word
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        className="rounded-2xl"
        style={{
          background: "white",
          border: `1px solid ${C.border}`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          padding: "16px",
          marginBottom: "16px",
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
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
      </div>

      {/* Table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "white",
          border: `1px solid ${C.border}`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 760, fontSize: "0.875rem" }}>
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                {["Label", "Category", "Samples", "Status", "Actions"].map(h => (
                  <th key={h} className="px-5 py-3">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>{h}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-5 py-3">
                        <div style={{ height: "14px", background: "#f3f4f6", borderRadius: "4px", animation: "pulse 1.5s infinite" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : words.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "40px", color: C.muted }}>
                    No words found. Add your first word using the button above.
                  </td>
                </tr>
              ) : words.map(word => (
                <tr key={word.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td className="px-5 py-3" style={{ fontWeight: 600, color: "#1f2937" }}>{word.label}</td>
                  <td className="px-5 py-3" style={{ color: "#6b7280", textTransform: "capitalize" }}>{word.category || "—"}</td>
                  <td className="px-5 py-3" style={{ color: "#374151" }}>{word.approved_sample_count ?? 0}</td>
                  <td className="px-5 py-3">
                    <span title="Words become active automatically when a model is deployed" style={{ padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 600,
                      background: word.is_active ? "#dcfce7" : "#f3f4f6",
                      color: word.is_active ? "#166534" : "#6b7280" }}>
                      {word.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button title="Upload dataset clips for training" onClick={() => setUploadWord(word)}
                        style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 10px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: "0.8rem", color: "#374151" }}>
                        <Upload size={14} /> Dataset Clips
                      </button>
                      <button title="Set the single demonstration video shown in the mobile app" onClick={() => setDemoVideoWord(word)}
                        style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 10px", borderRadius: "6px", border: `1px solid ${word.video_url ? "#bbf7d0" : C.border}`, background: word.video_url ? "#f0fdf4" : "white", cursor: "pointer", fontSize: "0.8rem", color: word.video_url ? "#166534" : "#374151" }}>
                        <Film size={14} /> Demo Video
                      </button>
                      <button title="Edit word" onClick={() => setEditWord(word)}
                        style={{ padding: "6px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", display: "flex", alignItems: "center" }}>
                        <Pencil size={14} color="#374151" />
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
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderTop: `1px solid ${C.border}`, background: "#f9fafb" }}>
            <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ padding: "6px 12px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.5 : 1, display: "flex", alignItems: "center" }}>
                <ChevronLeft size={16} />
              </button>
              <span style={{ padding: "6px 12px", fontSize: "0.85rem", color: "#374151" }}>{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                style={{ padding: "6px 12px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: page === totalPages ? "not-allowed" : "pointer", opacity: page === totalPages ? 0.5 : 1, display: "flex", alignItems: "center" }}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <WordFormModal
        open={addOpen}
        mode="add"
        onClose={() => setAddOpen(false)}
        onSuccess={fetchWords}
      />

      <WordFormModal
        open={!!editWord}
        mode="edit"
        word={editWord}
        onClose={() => setEditWord(null)}
        onSuccess={fetchWords}
      />

      {uploadWord && (
        <UploadVideosModal
          word={uploadWord}
          open={!!uploadWord}
          onClose={() => setUploadWord(null)}
          onSuccess={fetchWords}
        />
      )}

      {demoVideoWord && (
        <DemoVideoModal
          word={demoVideoWord}
          open={!!demoVideoWord}
          onClose={() => setDemoVideoWord(null)}
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

export default ManageWord;
