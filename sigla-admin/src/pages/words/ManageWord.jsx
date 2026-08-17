import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppModal from "../../components/AppModal.jsx";
import Button from "../../components/Button.jsx";
import {
  getAllWords,
  getWordStats,
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
  Database,
  Check,
  Clock,
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

const SkeletonCard = () => (
  <div className="dash-stat-card flex items-center gap-4">
    <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
      <div className="h-7 w-10 bg-gray-200 rounded animate-pulse" />
    </div>
  </div>
);

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
    <AppModal
      title={isEdit ? `Edit Word — ${word?.label}` : "Add New Word"}
      onClose={onClose}
      onEnter={() => { if (!saving && form.label) handleSubmit(); }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving} disabled={!form.label}>
            {isEdit ? "Save Changes" : "Add Word"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
        <div>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Label *</label>
          {/* maxLength matches Word.label's VARCHAR(100) — an over-long paste
              previously reached Postgres and returned a bare 500. Enter-to-submit
              is handled modal-wide by AppModal's onEnter. */}
          <input
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value.toUpperCase() }))}
            maxLength={100}
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
            onChange={e => setForm(f => ({ ...f, filipino_translation: e.target.value.toUpperCase() }))}
            placeholder="e.g. MAGANDANG UMAGA"
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
    <AppModal
      title={`Upload Files — ${word?.label}`}
      onClose={onClose}
      onEnter={() => {
        if (results) { onClose(); return; }
        if (!uploading && files.length) handleUpload();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {results ? "Close" : "Cancel"}
          </Button>
          {/* Once results are in, the upload is done and only Close remains —
              ModalFooter then promotes that lone button to primary. */}
          {!results && (
            <Button
              onClick={handleUpload}
              loading={uploading}
              disabled={!files.length}
            >
              Upload &amp; Extract
            </Button>
          )}
        </>
      }
    >
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
              <Loader2 size={14} className="animate-spin" style={{ flexShrink: 0 }} />
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

    </AppModal>
  );
};

// ── Demo Video Modal (single demonstration clip for the mobile app) ──
// This endpoint sends the file as base64 inside a JSON body, so the binding
// limit is express.json({ limit: "50mb" }) in server.js — NOT multer's 100 MB,
// which only applies to the multipart sample-upload route. Base64 inflates by
// ~4/3, so a 50 MB body caps the source file at ~37 MB. Checked here with a
// margin so an oversized file fails instantly and legibly, instead of after a
// long encode + upload that ends in an opaque 413.
const MAX_VIDEO_BYTES = 35 * 1024 * 1024;
const ACCEPTED_VIDEO_EXTS = ["mp4", "mov", "webm"];

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const DemoVideoModal = ({ word, open, onClose, onSuccess }) => {
  const { success, error: errorToast } = useToast();
  const fileRef = useRef();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState(null);
  // Object URL for the chosen file, so the admin can watch what they are about
  // to upload before replacing a live video.
  const [previewUrl, setPreviewUrl] = useState(null);

  const currentUrl = word?.video_url
    ? word.video_url.startsWith("/")
      ? `${(import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace("/api", "")}${word.video_url}`
      : word.video_url
    : null;

  // Revoke the previous object URL whenever the selection changes, and on close
  // — otherwise each pick leaks a blob for the lifetime of the page.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Reset per-open so a previous selection or error never leaks into the next
  // word's modal.
  useEffect(() => {
    if (!open) {
      setFile(null);
      setFileError(null);
      setDragOver(false);
    }
  }, [open]);

  const acceptFile = (picked) => {
    if (!picked) return;
    const ext = picked.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_VIDEO_EXTS.includes(ext)) {
      setFile(null);
      setFileError(`"${ext ?? "unknown"}" is not a supported video format.`);
      return;
    }
    if (picked.size > MAX_VIDEO_BYTES) {
      setFile(null);
      setFileError(
        `That file is ${formatBytes(picked.size)}. The limit is ${formatBytes(MAX_VIDEO_BYTES)}.`,
      );
      return;
    }
    setFileError(null);
    setFile(picked);
  };

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

  const selectedExt = file?.name.split(".").pop()?.toLowerCase();

  return (
    <AppModal
      title={`Demo Video — ${word?.label}`}
      onClose={onClose}
      onEnter={() => { if (!uploading && file) handleUpload(); }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={handleUpload} loading={uploading} disabled={!file}>
            {uploading
              ? "Uploading…"
              : word?.video_url
                ? "Replace Video"
                : "Upload Video"}
          </Button>
        </>
      }
    >
      {/* Current clip. Plays inline — this used to be a link to the storage URL,
          which the browser downloaded instead of playing. */}
      {currentUrl && (
        <div style={{ marginBottom: "18px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "6px" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#374151" }}>
              Current video
            </p>
            <a
              href={currentUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: "0.75rem", color: C.secondary, textDecoration: "underline" }}
            >
              Open in new tab ↗
            </a>
          </div>
          <video
            key={currentUrl}
            src={currentUrl}
            controls
            preload="metadata"
            playsInline
            style={{
              width: "100%", maxHeight: "220px", borderRadius: "10px",
              background: "#000", display: "block",
            }}
          />
        </div>
      )}

      {/* Drop zone — hidden once a file is chosen, so the preview below takes its
          place rather than stacking two large blocks in one modal. */}
      {!file && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            acceptFile(e.dataTransfer.files?.[0]);
          }}
          style={{
            border: `2px dashed ${dragOver ? C.secondary : fileError ? C.red : C.border}`,
            borderRadius: "10px", padding: "28px 20px", textAlign: "center",
            cursor: "pointer", marginBottom: "12px",
            background: dragOver ? "#eff6ff" : "#f9fafb",
            transition: "border-color .15s, background .15s",
          }}
        >
          <Film size={26} style={{ color: dragOver ? C.secondary : C.muted, margin: "0 auto 8px" }} />
          <p style={{ fontSize: "0.875rem", color: "#374151", fontWeight: 500 }}>
            {dragOver ? "Drop to select this video" : "Drag a video here, or click to browse"}
          </p>
          <p style={{ fontSize: "0.75rem", color: C.muted, marginTop: "4px" }}>
            MP4, MOV or WEBM · up to {formatBytes(MAX_VIDEO_BYTES)}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            style={{ display: "none" }}
            onChange={(e) => acceptFile(e.target.files?.[0] || null)}
          />
        </div>
      )}

      {fileError && (
        <p
          style={{
            fontSize: "0.8rem", color: "#b91c1c", background: "#fef2f2",
            border: "1px solid #fecaca", borderRadius: "8px",
            padding: "8px 12px", marginBottom: "12px",
          }}
        >
          {fileError}
        </p>
      )}

      {/* Chosen file: preview it before overwriting a live video. */}
      {file && (
        <div
          style={{
            border: `1px solid ${C.border}`, borderRadius: "10px",
            padding: "12px", marginBottom: "12px", background: "#f9fafb",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
            <Film size={16} style={{ color: C.secondary, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p
                style={{
                  fontSize: "0.85rem", fontWeight: 600, color: "#374151",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
                title={file.name}
              >
                {file.name}
              </p>
              <p style={{ fontSize: "0.75rem", color: C.muted }}>
                {formatBytes(file.size)} · replaces the current video
              </p>
            </div>
            <button
              onClick={() => { setFile(null); setFileError(null); }}
              disabled={uploading}
              style={{
                background: "none", border: "none", cursor: uploading ? "not-allowed" : "pointer",
                color: C.muted, fontSize: "0.75rem", textDecoration: "underline", flexShrink: 0,
              }}
            >
              Remove
            </button>
          </div>

          {previewUrl && (
            <video
              key={previewUrl}
              src={previewUrl}
              controls
              preload="metadata"
              playsInline
              style={{
                width: "100%", maxHeight: "200px", borderRadius: "8px",
                background: "#000", display: "block",
              }}
            />
          )}

          {/* Chrome and Firefox cannot play QuickTime inline. Say so here rather
              than letting a blank player read as a broken upload. */}
          {selectedExt === "mov" && (
            <p style={{ fontSize: "0.72rem", color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "6px 8px", marginTop: "8px" }}>
              MOV files may not preview in this browser. The upload still works.
            </p>
          )}
        </div>
      )}

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
  // Trails `search` by 400ms; the fetch keys off this so typing does not fire a
  // request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editWord, setEditWord] = useState(null);
  const [uploadWord, setUploadWord] = useState(null);
  const [demoVideoWord, setDemoVideoWord] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [stats, setStats] = useState(null);
  // Full category list for the filter dropdown. Derived from the words on the
  // current page it could only ever offer the ~10 categories visible, and
  // selecting one narrowed `words`, which then dropped the selected value from
  // its own dropdown.
  const [allCategories, setAllCategories] = useState([]);
  // Guards against out-of-order responses: only the newest request may write to
  // state. Without this a slow earlier fetch can land after a newer one and
  // repopulate the table with results for a filter the user already changed.
  const fetchIdRef = useRef(0);

  // Summary-card counts come from a separate endpoint than the table, so they
  // are refreshed here — every mutation already routes through fetchWords().
  const fetchStats = async () => {
    try {
      setStats(await getWordStats());
    } catch {
      // Non-blocking: the table still renders if only the cards fail.
      setStats(null);
    }
  };

  const fetchWords = async () => {
    const requestId = ++fetchIdRef.current;
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterCategory) params.category = filterCategory;
      const data = await getAllWords(params);
      // A newer request has started since this one — discard the result.
      if (requestId !== fetchIdRef.current) return;
      setWords(data.words || []);
      setTotal(data.total || 0);
      fetchStats();
    } catch {
      if (requestId !== fetchIdRef.current) return;
      errorToast("Failed to load words");
    } finally {
      if (requestId === fetchIdRef.current) setLoading(false);
    }
  };

  // ONE effect owns loading the table, and the page is reset by the SETTERS
  // below rather than by a second effect.
  //
  // History: this was two effects, one on [page] and one on [search,
  // filterCategory] that called setPage(1) AND fetchWords(). That fetched twice
  // on mount, and a filter change raced a stale-page fetch against the page-1
  // fetch. Collapsing to one effect plus a page-reset effect still fired twice
  // whenever the filter changed while page !== 1 — the effect ran once with the
  // old page, then again after setPage committed. Resetting the page in the same
  // event as the filter change means only one render, so only one request.
  // The fetch keys off the DEBOUNCED search, so typing "hello" issues one
  // request instead of five. `search` still updates on every keystroke, keeping
  // the input responsive, and the page reset below stays on the raw keystroke so
  // a filter change remains a single render.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchWords();
  }, [page, debouncedSearch, filterCategory]);

  // Filter setters that also return to page 1, so a filter change is a single
  // state update and therefore a single fetch.
  const applySearch = (value) => {
    setSearch(value);
    setPage(1);
  };

  const applyCategoryFilter = (value) => {
    setFilterCategory(value);
    setPage(1);
  };

  // Filter options come from the full category list, not the current page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getCategories();
        if (!cancelled) setAllCategories(data.categories || []);
      } catch {
        // Non-blocking: the table still works, the filter just has no options.
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  // Floored at 1, and clamped below. Deleting the only word on the last page used
  // to leave `page` past the end: the table showed "No words found" while the
  // footer read "Showing 21–20 of 20" and Next stayed enabled, recoverable only
  // by clicking Prev.
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Every category, so the filter is stable regardless of which words are on the
  // current page. Falls back to the categories present in the loaded rows if the
  // category request failed.
  const categoryOptions = allCategories.length
    ? allCategories.map((c) => c.name).filter(Boolean)
    : [...new Set(words.map((w) => w.category).filter(Boolean))];

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
            Add words and upload gesture samples for recognition
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

      {/* ── Summary cards ── */}
      {!stats ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="Total Words"
            value={stats.total}
            icon={Database}
            color="bg-blue-900"
          />
          <StatCard
            title="Active"
            value={stats.active}
            icon={Check}
            color="bg-green-500"
          />
          <StatCard
            title="Ready to Activate"
            value={stats.ready_to_activate}
            icon={Clock}
            color="bg-yellow-500"
          />
          <StatCard
            title="Gesture Samples"
            value={stats.total_samples}
            icon={Film}
            color="bg-blue-700"
          />
        </div>
      )}

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
            onChange={e => applySearch(e.target.value)}
            style={{ width: "100%", padding: "8px 8px 8px 32px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", boxSizing: "border-box" }}
          />
        </div>
        <select value={filterCategory} onChange={e => applyCategoryFilter(e.target.value)}
          style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", minWidth: "140px" }}>
          <option value="">All Categories</option>
          {categoryOptions.map(c => <option key={c} value={c.toLowerCase()}>{c}</option>)}
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
        <AppModal
          title="Delete Word"
          onClose={() => setDeleteConfirm(null)}
          onEnter={() => handleDelete(deleteConfirm)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => handleDelete(deleteConfirm)}>
                Delete
              </Button>
            </>
          }
        >
          <p style={{ fontSize: "0.9rem", color: "#374151" }}>
            Are you sure you want to delete <strong>"{deleteConfirm.label}"</strong>? This will also remove all its gesture samples.
          </p>
        </AppModal>
      )}
    </div>
  );
};

export default ManageWord;
