import { useState, useEffect, useRef } from "react";
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
  X,
  Loader2,
} from "lucide-react";

// ── FSL-105 label list (from labels.csv) ─────────────────────
const FSL_105 = [
  { id: 0,  label: "GOOD MORNING",      category: "GREETING" },
  { id: 1,  label: "GOOD AFTERNOON",    category: "GREETING" },
  { id: 2,  label: "GOOD EVENING",      category: "GREETING" },
  { id: 3,  label: "HELLO",             category: "GREETING" },
  { id: 4,  label: "HOW ARE YOU",       category: "GREETING" },
  { id: 5,  label: "IM FINE",           category: "GREETING" },
  { id: 6,  label: "NICE TO MEET YOU",  category: "GREETING" },
  { id: 7,  label: "THANK YOU",         category: "GREETING" },
  { id: 8,  label: "YOURE WELCOME",     category: "GREETING" },
  { id: 9,  label: "SEE YOU TOMORROW",  category: "GREETING" },
  { id: 10, label: "UNDERSTAND",        category: "SURVIVAL" },
  { id: 11, label: "DON'T UNDERSTAND",  category: "SURVIVAL" },
  { id: 12, label: "KNOW",              category: "SURVIVAL" },
  { id: 13, label: "DON'T KNOW",        category: "SURVIVAL" },
  { id: 14, label: "NO",                category: "SURVIVAL" },
  { id: 15, label: "YES",               category: "SURVIVAL" },
  { id: 16, label: "WRONG",             category: "SURVIVAL" },
  { id: 17, label: "CORRECT",           category: "SURVIVAL" },
  { id: 18, label: "SLOW",              category: "SURVIVAL" },
  { id: 19, label: "FAST",              category: "SURVIVAL" },
  { id: 20, label: "ONE",               category: "NUMBER" },
  { id: 21, label: "TWO",               category: "NUMBER" },
  { id: 22, label: "THREE",             category: "NUMBER" },
  { id: 23, label: "FOUR",              category: "NUMBER" },
  { id: 24, label: "FIVE",              category: "NUMBER" },
  { id: 25, label: "SIX",               category: "NUMBER" },
  { id: 26, label: "SEVEN",             category: "NUMBER" },
  { id: 27, label: "EIGHT",             category: "NUMBER" },
  { id: 28, label: "NINE",              category: "NUMBER" },
  { id: 29, label: "TEN",               category: "NUMBER" },
  { id: 30, label: "JANUARY",           category: "CALENDAR" },
  { id: 31, label: "FEBRUARY",          category: "CALENDAR" },
  { id: 32, label: "MARCH",             category: "CALENDAR" },
  { id: 33, label: "APRIL",             category: "CALENDAR" },
  { id: 34, label: "MAY",               category: "CALENDAR" },
  { id: 35, label: "JUNE",              category: "CALENDAR" },
  { id: 36, label: "JULY",              category: "CALENDAR" },
  { id: 37, label: "AUGUST",            category: "CALENDAR" },
  { id: 38, label: "SEPTEMBER",         category: "CALENDAR" },
  { id: 39, label: "OCTOBER",           category: "CALENDAR" },
  { id: 40, label: "NOVEMBER",          category: "CALENDAR" },
  { id: 41, label: "DECEMBER",          category: "CALENDAR" },
  { id: 42, label: "MONDAY",            category: "DAYS" },
  { id: 43, label: "TUESDAY",           category: "DAYS" },
  { id: 44, label: "WEDNESDAY",         category: "DAYS" },
  { id: 45, label: "THURSDAY",          category: "DAYS" },
  { id: 46, label: "FRIDAY",            category: "DAYS" },
  { id: 47, label: "SATURDAY",          category: "DAYS" },
  { id: 48, label: "SUNDAY",            category: "DAYS" },
  { id: 49, label: "TODAY",             category: "DAYS" },
  { id: 50, label: "TOMORROW",          category: "DAYS" },
  { id: 51, label: "YESTERDAY",         category: "DAYS" },
  { id: 52, label: "FATHER",            category: "FAMILY" },
  { id: 53, label: "MOTHER",            category: "FAMILY" },
  { id: 54, label: "SON",               category: "FAMILY" },
  { id: 55, label: "DAUGHTER",          category: "FAMILY" },
  { id: 56, label: "GRANDFATHER",       category: "FAMILY" },
  { id: 57, label: "GRANDMOTHER",       category: "FAMILY" },
  { id: 58, label: "UNCLE",             category: "FAMILY" },
  { id: 59, label: "AUNTIE",            category: "FAMILY" },
  { id: 60, label: "COUSIN",            category: "FAMILY" },
  { id: 61, label: "PARENTS",           category: "FAMILY" },
  { id: 62, label: "BOY",               category: "RELATIONSHIPS" },
  { id: 63, label: "GIRL",              category: "RELATIONSHIPS" },
  { id: 64, label: "MAN",               category: "RELATIONSHIPS" },
  { id: 65, label: "WOMAN",             category: "RELATIONSHIPS" },
  { id: 66, label: "DEAF",              category: "RELATIONSHIPS" },
  { id: 67, label: "HARD OF HEARING",   category: "RELATIONSHIPS" },
  { id: 68, label: "WEELCHAIR PERSON",  category: "RELATIONSHIPS" },
  { id: 69, label: "BLIND",             category: "RELATIONSHIPS" },
  { id: 70, label: "DEAF BLIND",        category: "RELATIONSHIPS" },
  { id: 71, label: "MARRIED",           category: "RELATIONSHIPS" },
  { id: 72, label: "BLUE",              category: "COLOR" },
  { id: 73, label: "GREEN",             category: "COLOR" },
  { id: 74, label: "RED",               category: "COLOR" },
  { id: 75, label: "BROWN",             category: "COLOR" },
  { id: 76, label: "BLACK",             category: "COLOR" },
  { id: 77, label: "WHITE",             category: "COLOR" },
  { id: 78, label: "YELLOW",            category: "COLOR" },
  { id: 79, label: "ORANGE",            category: "COLOR" },
  { id: 80, label: "GRAY",              category: "COLOR" },
  { id: 81, label: "PINK",              category: "COLOR" },
  { id: 82, label: "VIOLET",            category: "COLOR" },
  { id: 83, label: "LIGHT",             category: "COLOR" },
  { id: 84, label: "DARK",              category: "COLOR" },
  { id: 85, label: "BREAD",             category: "FOOD" },
  { id: 86, label: "EGG",               category: "FOOD" },
  { id: 87, label: "FISH",              category: "FOOD" },
  { id: 88, label: "MEAT",              category: "FOOD" },
  { id: 89, label: "CHICKEN",           category: "FOOD" },
  { id: 90, label: "SPAGHETTI",         category: "FOOD" },
  { id: 91, label: "RICE",              category: "FOOD" },
  { id: 92, label: "LONGANISA",         category: "FOOD" },
  { id: 93, label: "SHRIMP",            category: "FOOD" },
  { id: 94, label: "CRAB",              category: "FOOD" },
  { id: 95, label: "HOT",               category: "DRINK" },
  { id: 96, label: "COLD",              category: "DRINK" },
  { id: 97, label: "JUICE",             category: "DRINK" },
  { id: 98, label: "MILK",              category: "DRINK" },
  { id: 99, label: "COFFEE",            category: "DRINK" },
  { id: 100, label: "TEA",              category: "DRINK" },
  { id: 101, label: "BEER",             category: "DRINK" },
  { id: 102, label: "WINE",             category: "DRINK" },
  { id: 103, label: "SUGAR",            category: "DRINK" },
  { id: 104, label: "NO SUGAR",         category: "DRINK" },
];

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
  const [source, setSource] = useState("fsl105"); // "fsl105" | "custom"
  const [selectedSign, setSelectedSign] = useState(null);
  const [fslSearch, setFslSearch] = useState("");
  const [form, setForm] = useState({ label: "", description: "", category: "", gesture_type: "static", hands_count: 1, sign_type: "FSL", filipino_translation: "" });
  const [saving, setSaving] = useState(false);

  const filteredFsl = FSL_105.filter(s =>
    s.label.toLowerCase().includes(fslSearch.toLowerCase()) ||
    s.category.toLowerCase().includes(fslSearch.toLowerCase())
  );

  const handleSelectFsl = (sign) => {
    setSelectedSign(sign);
    setForm(f => ({ ...f, label: sign.label, category: sign.category.toLowerCase() }));
  };

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
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {["fsl105", "custom"].map(s => (
          <button key={s} onClick={() => setSource(s)} style={{
            flex: 1, padding: "8px", borderRadius: "8px", border: `1px solid ${source === s ? C.primary : C.border}`,
            background: source === s ? C.primary : "white", color: source === s ? "white" : "#374151",
            fontWeight: 600, cursor: "pointer", fontSize: "0.875rem",
          }}>
            {s === "fsl105" ? "From FSL-105" : "Custom Word"}
          </button>
        ))}
      </div>

      {source === "fsl105" && (
        <div>
          <div style={{ position: "relative", marginBottom: "12px" }}>
            <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: C.muted }} />
            <input
              placeholder="Search FSL-105 signs..."
              value={fslSearch}
              onChange={e => setFslSearch(e.target.value)}
              style={{ width: "100%", padding: "8px 8px 8px 32px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ maxHeight: "200px", overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "8px", marginBottom: "16px" }}>
            {filteredFsl.map(sign => (
              <div key={sign.id} onClick={() => handleSelectFsl(sign)} style={{
                padding: "8px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                background: selectedSign?.id === sign.id ? "#eff6ff" : "white",
                borderBottom: `1px solid ${C.border}`,
              }}>
                <span style={{ fontWeight: selectedSign?.id === sign.id ? 600 : 400, fontSize: "0.875rem" }}>{sign.label}</span>
                <span style={{ fontSize: "0.75rem", color: C.muted, background: "#f3f4f6", padding: "2px 8px", borderRadius: "12px" }}>{sign.category}</span>
              </div>
            ))}
          </div>
          {selectedSign && (
            <p style={{ fontSize: "0.875rem", color: "#374151", marginBottom: "8px" }}>
              Selected: <strong>{selectedSign.label}</strong> ({selectedSign.category})
            </p>
          )}
        </div>
      )}

      {source === "custom" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Label *</label>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value.toUpperCase() }))}
              style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Category</label>
            <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="e.g. greeting, survival..."
              style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Filipino Translation</label>
            <input value={form.filipino_translation} onChange={e => setForm(f => ({ ...f, filipino_translation: e.target.value }))}
              style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
              style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", resize: "vertical", boxSizing: "border-box" }} />
          </div>
        </div>
      )}

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
        <button onClick={handleSubmit} disabled={saving || (source === "fsl105" && !selectedSign) || !form.label}
          style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: C.primary, color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: "0.875rem", fontWeight: 600, opacity: saving ? 0.7 : 1, display: "flex", alignItems: "center", gap: "6px" }}>
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
        Upload <strong>.MOV</strong> video files from the FSL-105 dataset. Landmarks will be extracted automatically using MediaPipe.
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

  const categories = [...new Set(FSL_105.map(s => s.category))];

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
        <button onClick={() => setAddOpen(true)} style={{
          display: "flex", alignItems: "center", gap: "8px", padding: "10px 18px",
          background: C.primary, color: "white", border: "none", borderRadius: "10px",
          fontWeight: 600, cursor: "pointer", fontSize: "0.875rem",
        }}>
          <Plus size={16} /> Add Word
        </button>
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
