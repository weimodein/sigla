import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppModal from "../../components/AppModal.jsx";
import Button from "../../components/Button.jsx";
import { StatCard, SkeletonCard } from "../../components/StatCard.jsx";
import { SkeletonBlock, TableSkeletonRows } from "../../components/Skeleton.jsx";
import { listStagger } from "../../utils/motion.js";
import { invalidate } from "../../utils/apiCache.js";
import {
  getAllWords,
  getWordStats,
  adminAddWord,
  updateWord,
  deleteWord,
  deleteAllWordSamples,
  uploadVideos,
  getUploadJob,
  getActiveUploadJob,
  setWordVideo,
} from "../../api/wordApi.js";
import { getCategories } from "../../api/categoryApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import {
  Plus,
  Upload,
  Film,
  Trash2,
  Eraser,
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
          <label style={{ fontSize: "var(--type-meta)", fontWeight: 600, color: "#374151" }}>Label *</label>
          {/* maxLength matches Word.label's VARCHAR(100) — an over-long paste
              previously reached Postgres and returned a bare 500. Enter-to-submit
              is handled modal-wide by AppModal's onEnter. */}
          <input
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value.toUpperCase() }))}
            maxLength={100}
            placeholder="e.g. HELLO, BANANA, GOOD MORNING"
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "var(--type-body)", marginTop: "4px", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "var(--type-meta)", fontWeight: 600, color: "#374151" }}>Category</label>
          <select
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "var(--type-body)", marginTop: "4px", boxSizing: "border-box", background: "white" }}
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
            <p style={{ fontSize: "var(--type-meta)", color: C.muted, marginTop: "4px" }}>
              No categories yet. Create one in Manage Categories.
            </p>
          )}
        </div>
        <div>
          <label style={{ fontSize: "var(--type-meta)", fontWeight: 600, color: "#374151" }}>Filipino Translation</label>
          <input
            value={form.filipino_translation}
            onChange={e => setForm(f => ({ ...f, filipino_translation: e.target.value.toUpperCase() }))}
            placeholder="e.g. MAGANDANG UMAGA"
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "var(--type-body)", marginTop: "4px", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "var(--type-meta)", fontWeight: 600, color: "#374151" }}>Description</label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "var(--type-body)", marginTop: "4px", resize: "vertical", boxSizing: "border-box" }}
          />
        </div>
      </div>
    </AppModal>
  );
};

// ── Upload Videos Modal ───────────────────────────────────────
// Per-clip outcomes from a finished batch. Shared by the upload modal and the
// page-level results modal, which is what the admin sees when a batch finishes
// after they already closed the upload modal.
const ClipResultsList = ({ results }) => (
  <div style={{ maxHeight: "260px", overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "8px" }}>
    {results.map((r, i) => {
      const statusColor =
        r.status === "ok" ? C.green : r.status === "skipped" ? "#d97706" : C.red;
      const statusLabel =
        r.status === "ok" ? "OK" : r.status === "skipped" ? "Skipped" : "Failed";
      return (
        <div key={i} style={{ padding: "6px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "var(--type-meta)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              {r.file}
            </span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
              {r.type && r.type !== "unknown" && (
                <span style={{ padding: "1px 6px", borderRadius: "8px", fontSize: "var(--type-meta)", fontWeight: 600, background: r.type === "image" ? "#fef3c7" : "#eff6ff", color: r.type === "image" ? "#92400e" : "#1e40af", textTransform: "uppercase" }}>
                  {r.type}
                </span>
              )}
              <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
            </div>
          </div>
          {(r.reason || r.error) && (
            <p style={{ marginTop: "2px", fontSize: "var(--type-meta)", color: C.muted }}>
              {r.reason || r.error}
            </p>
          )}
        </div>
      );
    })}
  </div>
);

const UploadVideosModal = ({ word, open, onClose, onStarted }) => {
  const { error: errorToast } = useToast();
  const fileRef = useRef();
  const [files, setFiles] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFiles = (e) => {
    setFiles(Array.from(e.target.files));
  };

  // Only sends the clips. Extraction is a background job on the server, so this
  // hands the job row to the page and closes — the page owns progress from here,
  // which is why closing the modal no longer loses the batch.
  const handleUpload = async () => {
    if (!files.length || !sessionId.trim()) return;
    setSending(true);
    setProgress(0);
    try {
      const data = await uploadVideos(word.id, files, sessionId, (e) => {
        if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
      });
      onStarted(data.job);
      onClose();
    } catch (err) {
      errorToast(err.response?.data?.message || "Upload failed");
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <AppModal
      title={`Upload Files — ${word?.label}`}
      onClose={onClose}
      onEnter={() => { if (!sending && files.length && sessionId.trim()) handleUpload(); }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleUpload} loading={sending} disabled={!files.length || !sessionId.trim()}>
            Upload &amp; Extract
          </Button>
        </>
      }
    >
      <div style={{ marginBottom: "16px" }}>
        <label style={{ fontSize: "var(--type-meta)", fontWeight: 600, color: "#374151" }}>
          Signer ID
        </label>
        <input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="e.g. signer-03"
          maxLength={100}
          disabled={sending}
          style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "var(--type-body)", marginTop: "4px", boxSizing: "border-box" }}
        />
        <p style={{ fontSize: "var(--type-meta)", color: C.muted, marginTop: "4px" }}>
          Reuse this ID across every word and batch from the same person. Never put
          clips from different people in one batch; signer-held-out evaluation depends on it.
        </p>
      </div>

      <div
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${C.border}`, borderRadius: "10px", padding: "32px", textAlign: "center",
          cursor: "pointer", marginBottom: "16px", background: "#f9fafb",
        }}
      >
        <Upload size={28} style={{ color: C.muted, margin: "0 auto 8px" }} />
        <p style={{ fontSize: "var(--type-body)", color: "#374151" }}>
          Click to select video files (.MOV, .MP4)
        </p>
        <p style={{ fontSize: "var(--type-meta)", color: C.muted }}>Up to 50 files at once</p>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.mov"
          multiple
          style={{ display: "none" }}
          onChange={handleFiles}
        />
      </div>

      {files.length > 0 && (
        <p style={{ fontSize: "var(--type-body)", color: "#374151", marginBottom: "12px" }}>
          {files.length} file(s) selected
        </p>
      )}

      {/* Byte transfer only. Once this reaches 100% the server has the clips and
          the modal closes — extraction progress is reported by the page banner,
          which reads the job row rather than guessing. */}
      {sending && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-meta)", color: "#6b7280", marginBottom: "4px" }}>
            <span>Uploading files...</span>
            <span>{progress}%</span>
          </div>
          <div style={{ background: C.border, borderRadius: "4px", height: "6px" }}>
            <div style={{ height: "6px", borderRadius: "4px", background: C.primary, width: `${progress}%`, transition: "width var(--dur-slow) var(--ease-standard)" }} />
          </div>
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
            <p style={{ fontSize: "var(--type-meta)", fontWeight: 600, color: "#374151" }}>
              Current video
            </p>
            <a
              href={currentUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: "var(--type-meta)", color: C.secondary, textDecoration: "underline" }}
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
            transition:
              "border-color var(--dur-fast) var(--ease-standard), background-color var(--dur-fast) var(--ease-standard)",
          }}
        >
          <Film size={26} style={{ color: dragOver ? C.secondary : C.muted, margin: "0 auto 8px" }} />
          <p style={{ fontSize: "var(--type-body)", color: "#374151", fontWeight: 500 }}>
            {dragOver ? "Drop to select this video" : "Drag a video here, or click to browse"}
          </p>
          <p style={{ fontSize: "var(--type-meta)", color: C.muted, marginTop: "4px" }}>
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
            fontSize: "var(--type-meta)", color: "#b91c1c", background: "#fef2f2",
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
                  fontSize: "var(--type-body)", fontWeight: 600, color: "#374151",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
                title={file.name}
              >
                {file.name}
              </p>
              <p style={{ fontSize: "var(--type-meta)", color: C.muted }}>
                {formatBytes(file.size)} · replaces the current video
              </p>
            </div>
            <button
              onClick={() => { setFile(null); setFileError(null); }}
              disabled={uploading}
              style={{
                background: "none", border: "none", cursor: uploading ? "not-allowed" : "pointer",
                color: C.muted, fontSize: "var(--type-meta)", textDecoration: "underline", flexShrink: 0,
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
            <p style={{ fontSize: "var(--type-meta)", color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "6px 8px", marginTop: "8px" }}>
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
  const [clearSamplesConfirm, setClearSamplesConfirm] = useState(null);
  const [stats, setStats] = useState(null);
  // The in-flight clip-extraction batch, held at PAGE level so it survives the
  // upload modal closing. Seeded from the 202 response and re-adopted from the
  // server on mount, so a reload or navigating away does not lose the batch.
  const [uploadJob, setUploadJob] = useState(null);
  // Per-clip breakdown of a finished batch, shown even if the upload modal was
  // already closed — losing this silently is the bug this flow fixes.
  const [uploadResults, setUploadResults] = useState(null);
  const uploadPollRef = useRef(null);
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

  // Re-adopt a clip-extraction batch that is still running on the server.
  // Extraction happens in a background job, so it survives the admin closing the
  // modal, navigating away, or reloading — but uploadJob is component state and
  // does not. Without this, coming back to the page showed no banner and the
  // batch's results appeared out of nowhere.
  //
  // Only the words on the current page are checked: the endpoint is per-word and
  // scanning every word would be a request per row. In practice the admin is
  // looking at the word they just uploaded to.
  const adoptActiveUploadJob = async (visibleWords) => {
    if (uploadJob) return; // already tracking one
    try {
      const found = await Promise.all(
        visibleWords.slice(0, PAGE_SIZE).map((w) =>
          getActiveUploadJob(w.id)
            .then((d) => d.job)
            .catch(() => null),
        ),
      );
      const live = found.find(Boolean);
      // Leave a job set moments ago by the modal alone — the fetch that started
      // before it may only now be landing.
      if (live) setUploadJob((current) => current || live);
    } catch {
      // Non-blocking: the table still renders without the banner.
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
      adoptActiveUploadJob(data.words || []);
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

  // Poll the clip-extraction batch every 5 seconds while one is in flight.
  //
  // The interval is cleared on unmount and whenever the job id changes, and
  // fetchWords re-adopts a live job on mount, so navigating away and back resumes
  // tracking rather than losing the batch.
  useEffect(() => {
    if (!uploadJob?.id) return;

    // A row stranded at "processing" (backend restarted mid-run, so nothing will
    // ever finish it) would otherwise poll for the whole session and keep the
    // upload button disabled forever. Give up after 30 minutes and say so.
    const startedAt = Date.now();
    const POLL_TIMEOUT_MS = 30 * 60 * 1000;
    const jobId = uploadJob.id;

    uploadPollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(uploadPollRef.current);
        setUploadJob(null);
        errorToast(
          "Stopped tracking this upload — it has not reported back. Reload to check its status.",
        );
        fetchWords();
        return;
      }
      try {
        const { job } = await getUploadJob(jobId);
        if (job.status === "completed") {
          clearInterval(uploadPollRef.current);
          setUploadJob(null);
          success(
            `${job.success_count} clip(s) stored${job.fail_count ? `, ${job.fail_count} failed/skipped` : ""}`,
          );
          setUploadResults(job);
          // The sample counts changed on the SERVER, so no mutation call ran on
          // this client to clear them. Without this, fetchWords would re-serve
          // the pre-upload numbers from cache.
          invalidate("words:");
          fetchWords();
        } else if (job.status === "failed") {
          clearInterval(uploadPollRef.current);
          setUploadJob(null);
          errorToast(`Upload failed: ${job.error || "Unknown error"}`);
          // Partial results still matter — those clips really were stored.
          if (job.results?.length) setUploadResults(job);
          invalidate("words:");
          fetchWords();
        } else {
          // Still processing — advance the banner's count.
          setUploadJob(job);
        }
      } catch (err) {
        // A missing or forbidden job will never resolve — stop rather than
        // hammering the endpoint. Network hiccups keep polling.
        const status = err.response?.status;
        if (status === 404 || status === 403 || status === 401) {
          clearInterval(uploadPollRef.current);
          setUploadJob(null);
          fetchWords();
        }
      }
    }, 5000);
    return () => clearInterval(uploadPollRef.current);
  }, [uploadJob?.id]);

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

  // Clear a word's samples but keep the word. Used when a category has to be
  // re-recorded (inconsistent takes, a mislabelled batch) — deleting the word
  // instead would drop its id, so a later re-import renumbers it.
  const handleClearSamples = async (word) => {
    try {
      const res = await deleteAllWordSamples(word.id, word.label);
      success(
        res.deleted > 0
          ? `Deleted ${res.deleted} sample(s) from "${word.label}"`
          : `"${word.label}" already had no samples`,
      );
      setClearSamplesConfirm(null);
      fetchWords();
    } catch (err) {
      errorToast(err.response?.data?.message || "Failed to clear samples");
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="page-title">
            Manage Words
          </h2>
          <p className="page-subtitle">
            Manage vocabulary, training clips, and demonstration videos
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={() => navigate("/model")}
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "8px 16px", background: "white", color: C.primary,
              border: `1px solid ${C.primary}`, borderRadius: "8px",
              fontSize: "var(--type-body)", fontWeight: 600, cursor: "pointer",
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
              fontSize: "var(--type-body)", fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Plus size={16} /> Add Word
          </button>
        </div>
      </div>

      {/* ── Clip extraction in progress ──
          Lives here rather than in the upload modal so it survives the modal
          closing, and is re-adopted from the server after a reload. */}
      {uploadJob && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent shrink-0" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="text-sm font-semibold text-blue-800">
              Extracting landmarks
              {(() => {
                const label = words.find((w) => w.id === uploadJob.word_id)?.label;
                return label ? <> for <span className="font-mono">{label}</span></> : null;
              })()}
              {" — "}
              {uploadJob.processed_count} of {uploadJob.total_count} clip
              {uploadJob.total_count === 1 ? "" : "s"}…
            </p>
            <div style={{ background: "#bfdbfe", borderRadius: "4px", height: "6px", margin: "6px 0 4px" }}>
              <div
                style={{
                  height: "6px", borderRadius: "4px", background: C.primary,
                  width: `${uploadJob.total_count ? Math.round((uploadJob.processed_count / uploadJob.total_count) * 100) : 0}%`,
                  transition: "width var(--dur-slow) var(--ease-standard)",
                }}
              />
            </div>
            <p className="small-text text-blue-500">
              This may take a few minutes. You can safely navigate away — this page
              will update automatically.
            </p>
          </div>
        </div>
      )}

      {/* ── Summary cards ── */}
      {!stats ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard index={i} key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard index={0}
            title="Vocabulary Entries"
            value={stats.total}
            icon={Database}
            color="bg-blue-900"
          />
          <StatCard index={1}
            title="Active"
            value={stats.active}
            icon={Check}
            color="bg-green-500"
          />
          <StatCard index={2}
            title="Awaiting Deployment"
            value={stats.ready_to_activate}
            icon={Clock}
            color="bg-yellow-500"
          />
          <StatCard index={3}
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
            placeholder="Search vocabulary..."
            value={search}
            onChange={e => applySearch(e.target.value)}
            style={{ width: "100%", padding: "8px 8px 8px 32px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "var(--type-body)", boxSizing: "border-box" }}
          />
        </div>
        <select value={filterCategory} onChange={e => applyCategoryFilter(e.target.value)}
          style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "var(--type-body)", minWidth: "140px" }}>
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div>
            <h3 className="section-title">Vocabulary entries</h3>
            <p className="section-subtitle">Training coverage and deployed availability</p>
          </div>
          {loading ? (
            <SkeletonBlock className="h-7 w-24 rounded-full" />
          ) : (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              {total} {total === 1 ? "entry" : "entries"}
            </span>
          )}
        </div>
        <div className="table-scroll" role="region" aria-label="Vocabulary entries table" tabIndex={0}>
          {/* The proportional columns consume the full card width. The desktop
              minimum keeps all five actions on one line; smaller viewports use
              the existing horizontal scroll instead of compressing the row. */}
          <table className="data-table table-text text-left" style={{ minWidth: 980, tableLayout: "fixed" }}>
            <colgroup>
              {/* Allocate space by information density. Actions begin at their
                  column boundary so they stay visually connected to Availability. */}
              <col style={{ width: "190px" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "13%" }} />
              <col />
            </colgroup>
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                <th className="px-5 py-3"><span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Vocabulary</span></th>
                <th className="px-5 py-3"><span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Category</span></th>
                <th className="px-5 py-3"><span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Samples</span></th>
                <th className="px-5 py-3"><span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Status</span></th>
                <th className="px-5 py-3 text-left"><span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeletonRows
                  rows={PAGE_SIZE}
                  cellClassName="px-5 py-3"
                  columns={[
                    { type: "stack", width: "w-28" },
                    { width: "w-24" },
                    { width: "w-10" },
                    { type: "pill", width: "w-20" },
                    { type: "actions", count: 5 },
                  ]}
                />
              ) : words.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "40px", color: C.muted }}>
                    No words found. Add your first word using the button above.
                  </td>
                </tr>
              ) : words.map((word, i) => (
                <tr
                  key={word.id}
                  className="row-interactive list-item-in"
                  style={{ borderTop: `1px solid ${C.border}`, ...listStagger(i) }}
                >
                  {/* Fixed layout prevents long labels from shifting every other
                      column; the full value remains available on hover. */}
                  <td className="px-5 py-3">
                    <p className="truncate font-semibold text-gray-800" title={word.label}>{word.label}</p>
                    {word.filipino_translation && (
                      <p className="mt-0.5 truncate text-xs text-gray-400" title={word.filipino_translation}>
                        {word.filipino_translation}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3" style={{ color: "#6b7280", textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={word.category || ""}>{word.category || "—"}</td>
                  <td className="px-5 py-3 font-medium text-gray-700">
                    {word.approved_sample_count ?? 0}
                  </td>
                  <td className="px-5 py-3">
                    <span title="Words become active automatically when a model is deployed" style={{ padding: "2px 8px", borderRadius: "12px", fontSize: "var(--type-small)", fontWeight: 600,
                      background: word.is_active ? "#dcfce7" : "#f3f4f6",
                      color: word.is_active ? "#166534" : "#6b7280" }}>
                      {word.is_active ? "Active" : "Not deployed"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", justifyContent: "flex-start", whiteSpace: "nowrap" }}>
                      {/* Disabled while a batch is extracting — the server also
                          rejects a concurrent batch with 409, since two would race
                          on the same sample counters. */}
                      <button
                        title={uploadJob ? "An upload is already in progress…" : "Upload dataset clips for training"}
                        onClick={() => setUploadWord(word)}
                        disabled={!!uploadJob}
                        aria-label={`Upload training clips for ${word.label}`}
                        style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 10px", borderRadius: "7px", border: `1px solid ${C.border}`, background: "white", cursor: uploadJob ? "not-allowed" : "pointer", fontSize: "var(--type-body)", fontWeight: 500, color: "#374151", opacity: uploadJob ? 0.5 : 1, whiteSpace: "nowrap", flexShrink: 0 }}>
                        <Upload size={14} /> Clips
                      </button>
                      <button title="Set the single demonstration video shown in the mobile app" onClick={() => setDemoVideoWord(word)}
                        aria-label={`Set demonstration video for ${word.label}`}
                        style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 10px", borderRadius: "7px", border: `1px solid ${word.video_url ? "#bbf7d0" : C.border}`, background: word.video_url ? "#f0fdf4" : "white", cursor: "pointer", fontSize: "var(--type-body)", fontWeight: 500, color: word.video_url ? "#166534" : "#374151", whiteSpace: "nowrap", flexShrink: 0 }}>
                        <Film size={14} /> Demo
                      </button>
                      <button title="Edit word" aria-label={`Edit ${word.label}`} onClick={() => setEditWord(word)}
                        style={{ width: "32px", height: "32px", padding: 0, borderRadius: "7px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Pencil size={14} color="#374151" />
                      </button>
                      {/* Clear samples, keep the word. Disabled at 0 samples so
                          the row cannot offer an action that would do nothing,
                          and greyed rather than hidden so the control does not
                          appear and disappear as counts change. */}
                      <button
                        title={
                          word.total_samples > 0
                            ? `Delete all ${word.total_samples} training sample(s), keeping the word`
                            : "No samples to clear"
                        }
                        onClick={() => setClearSamplesConfirm(word)}
                        disabled={!word.total_samples}
                        aria-label={`Clear training samples for ${word.label}`}
                        style={{ width: "32px", height: "32px", padding: 0, borderRadius: "7px", border: `1px solid ${word.total_samples ? "#fed7aa" : C.border}`, background: word.total_samples ? "#fff7ed" : "white", cursor: word.total_samples ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", opacity: word.total_samples ? 1 : 0.45, flexShrink: 0 }}>
                        <Eraser size={14} color={word.total_samples ? "#c2410c" : "#9ca3af"} />
                      </button>
                      <button title="Delete word and all its samples" aria-label={`Delete ${word.label}`} onClick={() => setDeleteConfirm(word)}
                        style={{ width: "32px", height: "32px", padding: 0, borderRadius: "7px", border: `1px solid #fecaca`, background: "#fff5f5", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
          <div className="flex flex-wrap items-center justify-between gap-2" style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, background: "#f9fafb" }}>
            <span className="text-xs text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ padding: "6px 12px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.5 : 1, display: "flex", alignItems: "center" }}>
                <ChevronLeft size={16} />
              </button>
              <span className="px-3 py-1.5 text-xs text-gray-700">{page} / {totalPages}</span>
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
          onStarted={(job) => setUploadJob(job)}
        />
      )}

      {/* Per-clip breakdown, opened by the poller when a batch finishes — even if
          the upload modal was closed or the admin was on another page. */}
      {uploadResults && (
        <AppModal
          title={`Upload Results — ${uploadResults.word?.label || words.find((w) => w.id === uploadResults.word_id)?.label || "clips"}`}
          onClose={() => setUploadResults(null)}
          onEnter={() => setUploadResults(null)}
          footer={<Button onClick={() => setUploadResults(null)}>Close</Button>}
        >
          <p style={{ fontSize: "var(--type-body)", color: "#374151", marginBottom: "12px" }}>
            <strong>{uploadResults.success_count}</strong> clip(s) stored
            {uploadResults.fail_count > 0 && (
              <>, <strong>{uploadResults.fail_count}</strong> failed/skipped</>
            )}
            .
          </p>
          {uploadResults.status === "failed" && (
            <p style={{ fontSize: "var(--type-meta)", color: C.red, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", padding: "8px 10px", marginBottom: "12px" }}>
              The batch stopped early: {uploadResults.error || "Unknown error"}
            </p>
          )}
          {uploadResults.results?.length > 0 && (
            <ClipResultsList results={uploadResults.results} />
          )}
        </AppModal>
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
          <p style={{ fontSize: "var(--type-body)", color: "#374151" }}>
            Are you sure you want to delete <strong>"{deleteConfirm.label}"</strong>? This will also remove all its gesture samples.
          </p>
        </AppModal>
      )}

      {clearSamplesConfirm && (
        <AppModal
          title="Delete All Samples"
          onClose={() => setClearSamplesConfirm(null)}
          onEnter={() => handleClearSamples(clearSamplesConfirm)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setClearSamplesConfirm(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => handleClearSamples(clearSamplesConfirm)}>
                Delete {clearSamplesConfirm.total_samples} Sample
                {clearSamplesConfirm.total_samples === 1 ? "" : "s"}
              </Button>
            </>
          }
        >
          <p style={{ fontSize: "var(--type-body)", color: "#374151" }}>
            Permanently delete all{" "}
            <strong>{clearSamplesConfirm.total_samples}</strong> training sample
            {clearSamplesConfirm.total_samples === 1 ? "" : "s"} for{" "}
            <strong>"{clearSamplesConfirm.label}"</strong>?
          </p>
          <p style={{ fontSize: "var(--type-body)", color: "#6b7280", marginTop: "10px" }}>
            The word itself is kept, so you can re-upload clips for it later. This
            cannot be undone — the samples are not recoverable from the app.
          </p>
          {clearSamplesConfirm.is_active && (
            <p style={{ fontSize: "var(--type-body)", color: "#c2410c", marginTop: "10px" }}>
              This word is <strong>active</strong> in the deployed model. Clearing
              its samples does not change what the app currently recognises, but
              the word will be dropped from the next model you train.
            </p>
          )}
        </AppModal>
      )}
    </div>
  );
};

export default ManageWord;
