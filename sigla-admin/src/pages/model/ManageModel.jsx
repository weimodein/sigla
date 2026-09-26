import { useState, useEffect, useRef, Fragment } from "react";
import AppModal from "../../components/AppModal.jsx";
import Button from "../../components/Button.jsx";
import { StatCard, SkeletonCard } from "../../components/StatCard.jsx";
import { SkeletonBlock, TableSkeletonRows } from "../../components/Skeleton.jsx";
import PageNav from "../../components/PageNav.jsx";
import { listStagger } from "../../utils/motion.js";
import {
  getAllModels,
  getModelStats,
  trainModel,
  deployModel,
  revertModel,
  deleteModel,
} from "../../api/modelApi.js";
import { getWordStats } from "../../api/wordApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import { useTrainingJob } from "../../context/TrainingJobContext.jsx";
import { useUploadJobs } from "../../context/UploadJobsContext.jsx";
import { usePageViewState } from "../../utils/pageViewState.js";
import { useCacheSubscription } from "../../hooks/useCacheSubscription.js";
import { getCached, hasCached } from "../../utils/apiCache.js";
import { CACHE_KEYS } from "../../api/cacheKeys.js";
import {
  Cpu,
  CheckCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

// ── Color Palette ──
const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
  muted: "#9ca3af",
  border: "#e5e7eb",
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
  orange: "#f97316",
};

// ── Stat Card ─────────────────────────────────────────────────

// ── Skeleton Components ───────────────────────────────────────

// ── Badge ─────────────────────────────────────────────────────
const Badge = ({ value }) => {
  const map = {
    deployed: "#16a34a",
    trained: "#d97706",
    inactive: "#6b7280",
    training: "#2563eb",
    failed: "#dc2626",
    incomplete: "#dc2626",
    inconsistent: "#dc2626",
  };
  const labels = {
    deployed: "Active",
    trained: "Ready",
    inactive: "Previous",
    training: "Training",
    failed: "Failed",
    incomplete: "Incomplete",
    inconsistent: "Needs attention",
  };
  const bg = map[value] || C.muted;
  return (
    <span
      className="small-text px-2.5 py-1 rounded-full font-semibold"
      style={{ background: bg + "18", color: bg }}
    >
      {labels[value] || value}
    </span>
  );
};

// Compact metric used inside the expanded pair summary.
const ModelMetric = ({ label, value, color = C.text }) => (
  <div className="min-w-0">
    <p className="text-xs text-gray-500 mb-0.5">{label}</p>
    <p className="text-sm font-semibold truncate" style={{ color }}>{value}</p>
  </div>
);

// ── SortableHeader ────────────────────────────────────────────
const SortableHeader = ({ label, sortKey, sortField, sortDir, onSort }) => {
  const active = sortField === sortKey;
  return (
    <th
      className="interactive px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 cursor-pointer select-none hover:bg-gray-100"
      onClick={() => onSort && onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp size={14} className="text-blue-900" />
          ) : (
            <ChevronDown size={14} className="text-blue-900" />
          )
        ) : (
          <ChevronUp size={14} className="opacity-20" />
        )}
      </div>
    </th>
  );
};


// ── Main Component ────────────────────────────────────────────
const ManageModel = () => {
  const toast = useToast();
  const cachedModelsAtMount = getCached(CACHE_KEYS.models);
  const [stats, setStats] = useState(() => getCached(CACHE_KEYS.modelStats) || null);
  const [wordStats, setWordStats] = useState(() => getCached(CACHE_KEYS.wordStats) || null);
  const [models, setModels] = useState(() => cachedModelsAtMount?.models || []);
  const [loading, setLoading] = useState(() =>
    !cachedModelsAtMount || cachedModelsAtMount.models?.some((model) => model.status === "training"),
  );
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [searchTerm, setSearchTerm] = usePageViewState("models.searchTerm", "");

  // Pagination
  const [page, setPage] = usePageViewState("models.page", 1);
  const [pageSize, setPageSize] = usePageViewState("models.pageSize", 10);

  // Sorting
  const [sortField, setSortField] = usePageViewState("models.sortField", "trained_at");
  const [sortDir, setSortDir] = usePageViewState("models.sortDir", "desc");

  useCacheSubscription(CACHE_KEYS.models, (data) => {
    setModels(data.models || []);
    setLoading(false);
  });
  useCacheSubscription(CACHE_KEYS.modelStats, setStats);
  useCacheSubscription(CACHE_KEYS.wordStats, setWordStats);

  // Modal state
  const [trainModal, setTrainModal] = useState(false);
  const [deployModal, setDeployModal] = useState(null);
  const [revertModal, setRevertModal] = useState(null);

  // Train form
  const [trainForm, setTrainForm] = useState({ version_number: "", notes: "" });

  // Training progress, the results modal and the poll that drives them all now
  // live in TrainingJobsProvider (App.jsx) — same reason UploadJobsContext was
  // hoisted out of ManageWord: this page unmounts on navigation (App.jsx
  // renders <Layout> per-<Route>), so state and an interval kept here would be
  // lost the moment the admin left, and a run finishing elsewhere would never
  // report its outcome. This page only needs to know a run is in flight (to
  // disable the Train button) and to refetch when one finishes.
  const {
    job: trainingJob,
    finishedCount: trainingFinishedCount,
    startJob: startTrainingJob,
  } = useTrainingJob();
  // Live upload batches, so the Train button can be disabled with a reason —
  // trainModel now refuses to start (409) while any word's upload is still
  // processing, since training snapshots the dataset once and would train on
  // a partially-uploaded word. See the guard in modelController.js.
  const { uploadJobs } = useUploadJobs();
  const uploadingWords = Object.values(uploadJobs).map(
    (j) => j.word?.label || `word #${j.word_id}`,
  );

  // ── Fetch data ──────────────────────────────────────────────
  // Re-adopting an in-flight training run (so a reload doesn't show a stale
  // "Train New Model" button) is TrainingJobsProvider's job now, not this
  // page's — it re-adopts on login and on every route change regardless of
  // whether ManageModel is even mounted. This just loads what the page
  // displays.
  const fetchData = async () => {
    const cachedModels = getCached(CACHE_KEYS.models);
    const cachedStats = getCached(CACHE_KEYS.modelStats);
    const cachedWordStats = getCached(CACHE_KEYS.wordStats);
    if (cachedModels) setModels(cachedModels.models || []);
    if (cachedStats) setStats(cachedStats);
    if (cachedWordStats) setWordStats(cachedWordStats);
    setLoading(!hasCached(CACHE_KEYS.models));
    try {
      const [statsData, modelsData, wordStatsData] = await Promise.all([
        getModelStats(),
        getAllModels(),
        getWordStats(),
      ]);
      setStats(statsData);
      setModels(modelsData.models || []);
      setWordStats(wordStatsData);
    } catch (err) {
      toast.error("Failed to load model data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Refetch whenever a training run finishes — this admin's or another's —
  // the same way ManageWord refetches on UploadJobsContext's finishedCount.
  // Skipped on the very first render, when finishedCount is still its initial
  // value and fetchData has not run yet via the effect above.
  const isFirstTrainingFinishedCount = useRef(true);
  useEffect(() => {
    if (isFirstTrainingFinishedCount.current) {
      isFirstTrainingFinishedCount.current = false;
      return;
    }
    fetchData();
  }, [trainingFinishedCount]);

  // ── Sort ────────────────────────────────────────────────────
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  // ── Pair each version's two models into ONE row ─────────────
  // A training run produces a words model and an alphabet model under the same
  // version. They are two database rows because they are two .tflite files with
  // different class lists, but they are one THING to an administrator: trained
  // together, deployed together, deleted together. Listing both put two
  // identical "1.7.0" rows in the table with only a tag between them.
  //
  // The words row represents the pair and carries the alphabet as `letters`;
  // the expanded panel shows both models' numbers. An alphabet row with no
  // words half (a failed or half-deleted version) still lists on its own rather
  // than vanishing.
  const pairedModels = (() => {
    const letters = new Map();
    for (const m of models) {
      if (m.model_kind === "letters") letters.set(m.version_number, m);
    }
    const claimed = new Set();
    const rows = [];
    for (const m of models) {
      if (m.model_kind === "letters") continue;
      const companion = letters.get(m.version_number) || null;
      if (companion) claimed.add(companion.id);
      let pairStatus;
      if (!companion) pairStatus = "incomplete";
      else if (m.status === "deployed" && companion.status === "deployed") pairStatus = "deployed";
      else if (m.status === "deployed" || companion.status === "deployed") pairStatus = "inconsistent";
      else if (m.status === "training" || companion.status === "training") pairStatus = "training";
      else if (m.status === "failed" || companion.status === "failed") pairStatus = "failed";
      else if (m.status === "trained" && companion.status === "trained") pairStatus = "trained";
      else if (m.status === "inactive" && companion.status === "inactive") pairStatus = "inactive";
      else pairStatus = "incomplete";
      rows.push({ ...m, words_status: m.status, status: pairStatus, letters: companion });
    }
    for (const m of letters.values()) {
      if (!claimed.has(m.id)) {
        rows.push({
          ...m,
          words_status: null,
          status: "incomplete",
          total_classes: null,
          accuracy: null,
          trained_word_ids: null,
          letters: m,
          is_letters_only: true,
        });
      }
    }
    return rows;
  })();

  const sortedModels = [...pairedModels].sort((a, b) => {
    let va = sortField === "letters_accuracy" ? a.letters?.accuracy : a[sortField];
    let vb = sortField === "letters_accuracy" ? b.letters?.accuracy : b[sortField];

    // Nulls last in BOTH directions. Coercing them to "" put untested models
    // (null accuracy) at the head of an ascending sort, since `0.95 > ""` is
    // true — "not measured" is not the smallest value, it is absent.
    const aMissing = va === null || va === undefined || va === "";
    const bMissing = vb === null || vb === undefined || vb === "";
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;

    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // ── Search filter ───────────────────────────────────────────
  const filteredModels = searchTerm
    ? sortedModels.filter(
        (m) =>
          m.version_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
          m.trainer?.username?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : [...sortedModels];

  // ── Paginate ────────────────────────────────────────────────
  // Floored at 1 so an empty list does not produce page 0.
  const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));

  // Keep the current page valid as the list shrinks. Deleting the only row on
  // the last page used to leave `page` past the end, rendering "No models found.
  // Train your first model to get started." while models still existed.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // A deployable version always includes its alphabet; the backend validates
  // the same condition before changing any deployed rows.
  const deployLetterCount =
    deployModal?.letters &&
    deployModal.letters.tflite_url &&
    deployModal.letters.status === "trained" &&
    Array.isArray(deployModal.letters.trained_word_ids)
      ? deployModal.letters.trained_word_ids.length
      : null;

  const paginatedModels = filteredModels.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  // ── Actions ─────────────────────────────────────────────────
  const showSuccess = (msg) => toast.success(msg);
  const showError = (msg) => toast.error(msg);

  // ── Train ─────────────────────────────────────────────────
  const handleTrain = async () => {
    if (!trainForm.version_number) {
      showError("Version number is required");
      return;
    }
    if (!/^[a-zA-Z0-9._\-]+$/.test(trainForm.version_number)) {
      showError("Version number can only contain letters, numbers, dots, dashes, and underscores. Use MAJOR.MINOR.PATCH with no prefix, e.g. 1.0.2");
      return;
    }
    setActionLoading(true);
    try {
      const result = await trainModel(trainForm.version_number, trainForm.notes);
      // Backend returns 202 — training is running in background. Hand the pair
      // off to TrainingJobsProvider, which polls both rows and survives this
      // page unmounting.
      startTrainingJob(result.model, result.letters_model);
      setTrainModal(false);
      setTrainForm({ version_number: "", notes: "" });
      fetchData();
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.detail ||
          "Training failed",
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ── Deploy ────────────────────────────────────────────────
  const handleDeploy = async () => {
    setActionLoading(true);
    try {
      await deployModel(deployModal.version_number);
      showSuccess(`Model ${deployModal.version_number} deployed successfully`);
      setDeployModal(null);
      fetchData();
    } catch (err) {
      showError(
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
    try {
      await revertModel(revertModal.version_number);
      showSuccess(`Reverted to model ${revertModal.version_number}`);
      setRevertModal(null);
      fetchData();
    } catch (err) {
      showError(
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
    // Say that BOTH halves go. The backend deletes a version's words model and
    // its alphabet together — they are trained and deployed as a pair — and this
    // is irreversible, so a prompt naming only one of them understates it.
    const alsoLetters =
      model.letters && model.letters.status !== "deployed"
        ? " Its alphabet model will be deleted too."
        : "";
    if (
      !window.confirm(
        `Delete model ${model.version_number}?${alsoLetters} This cannot be undone.`,
      )
    )
      return;
    setActionLoading(true);
    try {
      await deleteModel(model.id);
      showSuccess("Model deleted successfully");
      fetchData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to delete model");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Format metric ─────────────────────────────────────────
  const fmt = (val) => (val != null ? `${(val * 100).toFixed(1)}%` : "—");

  // ── Format metric (for inline use) ──────────────────────────
  const getMetricColor = (val) => {
    if (val == null) return "#9ca3af";
    const pct = val * 100;
    if (pct >= 80) return "#16a34a";
    if (pct >= 60) return "#ca8a04";
    return "#dc2626";
  };

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Manage Model
          </h1>
          <p className="page-subtitle">
            Train, test, and deploy sign language models
          </p>
        </div>
        <button
          onClick={() => setTrainModal(true)}
          disabled={!!trainingJob || uploadingWords.length > 0}
          className="page-primary-action interactive bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            trainingJob
              ? "Training in progress…"
              : uploadingWords.length > 0
                ? `Wait for the upload in progress to finish: ${uploadingWords.join(", ")}`
                : undefined
          }
        >
          + Train New Model
        </button>
      </div>

      {/* Training progress now renders as a floating card in Layout
          (TrainingJobBanner), matching UploadJobBanner — see the note there.
          It survives navigating away from this page, which the inline banner
          this replaced did not. */}

      {/* Stat Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard index={i} key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <StatCard index={1}
            title="Total Versions"
            value={stats?.total}
            icon={Cpu}
            color="bg-blue-900"
          />
          <StatCard index={2}
            title="Deployed"
            value={stats?.deployed}
            icon={CheckCircle}
            color="bg-green-500"
          />
          <StatCard index={3}
            title="Trained (pending)"
            value={stats?.trained}
            icon={Clock}
            color="bg-yellow-500"
          />
        </div>
      )}

      {/* Current Deployed Model */}
      {loading ? (
        <div
          className="mb-5 rounded-xl border border-gray-200 bg-white px-6 py-5"
          aria-hidden="true"
        >
          <SkeletonBlock className="mb-4 h-4 w-40 rounded" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <SkeletonBlock className="h-3 w-20 rounded" />
                <SkeletonBlock className="h-6 w-24 max-w-full rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : stats?.current_model ? (
        /* Not a StatCard — a full-width gradient banner — but it takes the same
           entrance so it does not sit static above cards that animate. */
        <div
          className="list-item-in"
          style={{
            background: `linear-gradient(135deg, ${C.primary}, ${C.secondary})`,
            borderRadius: "12px",
            padding: "20px 24px",
            marginBottom: "20px",
            color: "#fff",
            ...listStagger(0),
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            Currently Deployed
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Version
              </p>
              <p className="font-bold text-lg">
                {stats.current_model.version_number}
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Accuracy
              </p>
              <p className="font-semibold">
                {fmt(stats.current_model.accuracy)}
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Classes
              </p>
              <p className="font-semibold">
                {stats.current_model.total_classes ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Deployed At
              </p>
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
      ) : null}

      {/* Models Table ────────────────────────────────────────── */}
      <div className="dash-card">
        <div
          className="table-toolbar dash-card-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 className="section-title">
              Model Versions
            </h3>
            <p className="section-subtitle">
              Words and alphabet models are managed as one version.
            </p>
          </div>
          <div
            className="table-toolbar-actions"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            {/* Search */}
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              placeholder="Search versions..."
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              style={{ width: "200px" }}
            />
            {loading ? (
              <SkeletonBlock className="h-4 w-20 rounded" />
            ) : (
              <span className="text-xs text-gray-500">
                {filteredModels.length} version
                {filteredModels.length !== 1 ? "s" : ""}
              </span>
            )}
            {/* Same Prev/Next as the bottom bar — paging without scrolling down
                to it first, on a table that can run to many pages. */}
            <PageNav page={page} totalPages={totalPages} onChange={setPage} disabled={loading} />
          </div>
        </div>

        {loading ? (
          <div className="table-scroll" role="region" aria-label="Model versions table" tabIndex={0}>
          <table className="data-table mobile-card-table models-mobile-table table-text text-left" style={{ minWidth: 920, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "44px" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "18%" }} />
              <col />
            </colgroup>
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                <th className="px-5 py-3" />
                <th className="px-5 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Version
                  </span>
                </th>
                <th className="px-5 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Words model
                  </span>
                </th>
                <th className="px-5 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Alphabet model
                  </span>
                </th>
                <th className="px-5 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Status
                  </span>
                </th>
                <th className="px-5 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Training
                  </span>
                </th>
                <th className="px-5 py-3 text-left">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Actions
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <TableSkeletonRows
                rows={5}
                cellClassName="px-5 py-3"
                columns={[
                  { width: "w-3" },
                  { width: "w-16" },
                  { type: "stack", width: "w-20" },
                  { type: "stack", width: "w-20" },
                  { type: "pill", width: "w-20" },
                  { type: "stack", width: "w-28" },
                  { width: "w-20" },
                ]}
              />
            </tbody>
          </table>
          </div>
        ) : (
          <>
            {/* Table header row */}
            <div className="table-scroll" role="region" aria-label="Model versions table" tabIndex={0}>
            <table className="data-table mobile-card-table models-mobile-table table-text text-left" style={{ minWidth: 920, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "44px" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "18%" }} />
              <col />
              </colgroup>
              <thead style={{ background: "#f9fafb" }}>
                <tr>
                  <th className="px-5 py-3" />
                  <SortableHeader label="Version" sortKey="version_number" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Words model" sortKey="accuracy" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Alphabet model" sortKey="letters_accuracy" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Status" sortKey="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Training" sortKey="trained_at" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <th
                    className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedModels.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-10 text-center text-sm"
                      style={{ color: C.muted }}
                    >
                      {searchTerm
                        ? "No models match your search."
                        : "No models found. Train your first model to get started."}
                    </td>
                  </tr>
                ) : (
                  paginatedModels.map((model, i) => (
                    // Keyed on the FRAGMENT. The key used to sit on the inner
                    // <tr>, where React never sees it, so this list reconciled by
                    // index: with a row expanded, a re-sort or refetch could
                    // re-match the open detail panel to a different version.
                    <Fragment key={model.id}>
                      {/* Main row */}
                      <tr
                        className="border-t row-interactive list-item-in"
                        style={{
                          cursor: "pointer",
                          ...listStagger(i),
                        }}
                        onClick={() =>
                          setExpandedRow(
                            expandedRow === model.id ? null : model.id,
                          )
                        }
                      >
                        <td className="px-5 py-3">
                          <ChevronDown
                            size={16}
                            className={`transition-transform duration-base ease-standard ${
                              expandedRow === model.id ? "rotate-180" : ""
                            }`}
                            style={{ color: C.muted }}
                          />
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900">
                              {model.version_number}
                            </span>
                            {model.status === "deployed" && (
                              <span className="w-2 h-2 rounded-full bg-green-500" title="Active version" />
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-semibold" style={{ color: getMetricColor(model.accuracy) }}>
                            {fmt(model.accuracy)}
                          </p>
                          {model.total_classes == null && (
                            <p className="mt-0.5 text-xs text-gray-400">Not trained</p>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <p
                            className="font-semibold"
                            style={{
                              color: model.letters?.accuracy == null
                                ? C.muted
                                : getMetricColor(model.letters.accuracy),
                            }}
                          >
                            {fmt(model.letters?.accuracy)}
                          </p>
                          {model.letters?.total_classes == null && (
                            <p className="mt-0.5 text-xs text-gray-400">Not trained</p>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <Badge value={model.status} />
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-700">
                            {model.trainer?.username || "—"}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {model.trained_at
                              ? new Date(model.trained_at).toLocaleDateString()
                              : "Not completed"}
                          </p>
                        </td>
                        <td
                          className="px-5 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex justify-start gap-1.5 flex-wrap">
                            {model.status === "trained" && (
                              <>
                                <button
                                  onClick={() => setDeployModal(model)}
                                  className="text-sm font-medium px-3 py-1.5 rounded-lg transition"
                                  style={{
                                    background: "#bbf7d0",
                                    color: "#14532d",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                      "#86efac")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background =
                                      "#bbf7d0")
                                  }
                                >
                                  Deploy
                                </button>
                                <button
                                  onClick={() => handleDelete(model)}
                                  disabled={actionLoading}
                                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                  style={{
                                    background: "#fff",
                                    color: "#991b1b",
                                  }}
                                  onMouseEnter={(e) =>
                                      (e.currentTarget.style.background =
                                        "#fef2f2")
                                  }
                                  onMouseLeave={(e) =>
                                      (e.currentTarget.style.background =
                                        "#fff")
                                  }
                                >
                                  Delete
                                </button>
                              </>
                            )}
                            {model.status === "inactive" && (
                              <>
                                <button
                                  onClick={() => setRevertModal(model)}
                                  className="text-sm font-medium px-3 py-1.5 rounded-lg transition"
                                  style={{
                                    background: "#bfdbfe",
                                    color: "#1e3a8a",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                      "#93c5fd")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background =
                                      "#bfdbfe")
                                  }
                                >
                                  Revert
                                </button>
                                <button
                                  onClick={() => handleDelete(model)}
                                  disabled={actionLoading}
                                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                  style={{
                                    background: "#fff",
                                    color: "#991b1b",
                                  }}
                                  onMouseEnter={(e) =>
                                      (e.currentTarget.style.background =
                                        "#fef2f2")
                                  }
                                  onMouseLeave={(e) =>
                                      (e.currentTarget.style.background =
                                        "#fff")
                                  }
                                >
                                  Delete
                                </button>
                              </>
                            )}
                            {/* A failed run produced no artifacts, so Revert is
                                meaningless — but it still occupies a row, and
                                without Delete those rows accumulate forever. */}
                            {["failed", "incomplete", "inconsistent"].includes(model.status) && (
                              <button
                                onClick={() => handleDelete(model)}
                                disabled={actionLoading}
                                className="text-sm font-medium px-3 py-1.5 rounded-lg border border-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{
                                  background: "#fff",
                                  color: "#991b1b",
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.background = "#fef2f2")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background = "#fff")
                                }
                              >
                                Delete
                              </button>
                            )}
                            {model.status === "deployed" && (
                              <span className="text-xs font-medium text-gray-500">Deployed</span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Compact pair details */}
                      {expandedRow === model.id && (
                        <tr
                          style={{ background: "#f8fafc" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <td colSpan={7} className="px-4 py-4">
                            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                              <div className="grid grid-cols-1 md:grid-cols-2">
                                <section className="p-4 md:border-r border-gray-200">
                                  <div className="flex items-start justify-between gap-3 mb-4">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                                        <h4 className="text-sm font-semibold text-gray-900">Words model</h4>
                                      </div>
                                      <p className="text-xs text-gray-500 mt-1 ml-4">
                                        General sign vocabulary
                                      </p>
                                    </div>
                                    {model.words_status ? <Badge value={model.words_status} /> : <Badge value="incomplete" />}
                                  </div>
                                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                    <ModelMetric
                                      label="Accuracy"
                                      value={fmt(model.accuracy)}
                                      color={model.accuracy == null ? C.muted : getMetricColor(model.accuracy)}
                                    />
                                    <ModelMetric label="Classes" value={model.total_classes ?? "—"} />
                                    <ModelMetric
                                      label="Bank entries"
                                      value={
                                        Array.isArray(model.trained_word_ids)
                                          ? model.trained_word_ids.length
                                          : "—"
                                      }
                                    />
                                  </div>
                                </section>

                                <section className="p-4 border-t md:border-t-0 border-gray-200">
                                  <div className="flex items-start justify-between gap-3 mb-4">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-violet-500" />
                                        <h4 className="text-sm font-semibold text-gray-900">Alphabet model</h4>
                                      </div>
                                      <p className="text-xs text-gray-500 mt-1 ml-4">
                                        Fingerspelling recognition
                                      </p>
                                    </div>
                                    <Badge value={model.letters?.status || "incomplete"} />
                                  </div>
                                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                    <ModelMetric
                                      label="Accuracy"
                                      value={fmt(model.letters?.accuracy)}
                                      color={
                                        model.letters?.accuracy == null
                                          ? C.muted
                                          : getMetricColor(model.letters.accuracy)
                                      }
                                    />
                                    <ModelMetric
                                      label="Classes"
                                      value={model.letters?.total_classes ?? "—"}
                                    />
                                    <ModelMetric
                                      label="Bank entries"
                                      value={
                                        Array.isArray(model.letters?.trained_word_ids)
                                          ? model.letters.trained_word_ids.length
                                          : "—"
                                      }
                                    />
                                  </div>
                                </section>
                              </div>

                              <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
                                <div className="flex flex-wrap items-start gap-x-8 gap-y-2 text-xs">
                                  <div>
                                    <span className="text-gray-500">Trained by </span>
                                    <span className="font-medium text-gray-700">
                                      {model.trainer?.username || "—"}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Trained </span>
                                    <span className="font-medium text-gray-700">
                                      {model.trained_at
                                        ? new Date(model.trained_at).toLocaleDateString()
                                        : "—"}
                                    </span>
                                  </div>
                                  {model.deployed_at && (
                                    <div>
                                      <span className="text-gray-500">Last deployed </span>
                                      <span className="font-medium text-gray-700">
                                        {new Date(model.deployed_at).toLocaleString()}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {model.notes && (
                                  <p className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-200">
                                    <span className="font-medium text-gray-700">Notes:</span>{" "}
                                    {model.notes}
                                  </p>
                                )}
                              </div>

                              {(model.training_error || model.letters?.training_error) && (
                                <div className="border-t border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
                                  <span className="font-semibold">Training issue:</span>{" "}
                                  {model.training_error || model.letters?.training_error}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
            </div>

            {/* Pagination */}
            {filteredModels.length > pageSize && (
              <div
                className="data-pagination dash-card-footer meta-text flex flex-wrap items-center justify-between gap-2 text-gray-500"
                style={{
                  paddingTop: "12px",
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>
                    {filteredModels.length} result
                    {filteredModels.length !== 1 ? "s" : ""}
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-900"
                  >
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="text-xs">
                    {page} / {totalPages || 1}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="interactive p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="interactive p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Train Modal */}
      {trainModal && (
        <AppModal
          title="Train New Model"
          onClose={() => setTrainModal(false)}
          onEnter={() => { if (!actionLoading) handleTrain(); }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setTrainModal(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleTrain} loading={actionLoading}>
                {actionLoading
                  ? "Training... (this may take a while)"
                  : "Start Training"}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Version Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={trainForm.version_number}
                onChange={(e) =>
                  setTrainForm({ ...trainForm, version_number: e.target.value.replace(/[^a-zA-Z0-9._\-]/g, "") })
                }
                placeholder="e.g. 1.0.2"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
              <p className="small-text mt-1 text-gray-400">
                Use MAJOR.MINOR.PATCH with no prefix — e.g. 1.0.2. The UI adds the
                &quot;v&quot; when displaying, so typing one here shows as &quot;vv1.0.2&quot;.
              </p>
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
          </div>
        </AppModal>
      )}

      {/* Deploy Modal */}
      {deployModal && (
        <AppModal
          title={`Deploy Model: ${deployModal.version_number}`}
          onClose={() => setDeployModal(null)}
          onEnter={() => { if (!actionLoading) handleDeploy(); }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeployModal(null)}>
                Cancel
              </Button>
              <Button onClick={handleDeploy} loading={actionLoading}>
                {actionLoading ? "Deploying..." : "Confirm Deploy"}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Deploying <strong>{deployModal.version_number}</strong> will make
              it the active model. All users will be notified to update.
            </p>
            {stats?.current_model && (
              <div className="small-text rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-yellow-700">
                Current deployed model{" "}
                <strong>{stats.current_model.version_number}</strong> will
                become inactive.
              </div>
            )}
            {/* Describe what deploy ACTUALLY does. This used to print
                wordStats.ready_to_activate — words with enough approved samples —
                but deploy calls reconcileActiveWords, which sets the visible word
                bank to exactly THIS version's trained_word_ids. Deploying an older
                version therefore activated none of those words and hid others,
                while the dialog promised the opposite. */}
            <div className="small-text rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-700">
              {Array.isArray(deployModal.trained_word_ids) ? (
                <>
                  The mobile word bank will match this version:{" "}
                  <strong>
                    {deployModal.trained_word_ids.length +
                      (deployLetterCount ?? 0)}
                  </strong>{" "}
                  entries visible
                  {/* The word bank is the union of both required model rows. */}
                  {deployLetterCount != null && (
                    <>
                      {" "}
                      ({deployModal.trained_word_ids.length} word
                      {deployModal.trained_word_ids.length !== 1 ? "s" : ""} +{" "}
                      {deployLetterCount} letter
                      {deployLetterCount !== 1 ? "s" : ""})
                    </>
                  )}
                  . Words this version was not trained on become hidden.
                </>
              ) : (
                <>
                  The mobile word bank will be set to the words this version was
                  trained on. This version has no recorded word list, so the
                  current set is kept.
                </>
              )}
            </div>
          </div>
        </AppModal>
      )}

      {/* Revert Modal */}
      {revertModal && (
        <AppModal
          title={`Revert to: ${revertModal.version_number}`}
          onClose={() => setRevertModal(null)}
          onEnter={() => { if (!actionLoading) handleRevert(); }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRevertModal(null)}>
                Cancel
              </Button>
              <Button onClick={handleRevert} loading={actionLoading}>
                {actionLoading ? "Reverting..." : "Confirm Revert"}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              This will revert the active model back to{" "}
              <strong>{revertModal.version_number}</strong>. The current
              deployed model will become inactive.
              {/* Reverting brings this version's alphabet back too. Saying so
                  matters: the letters model changes under the user's feet
                  otherwise, and a version's two halves are only ever deployed
                  as a pair. */}
              {revertModal.letters?.tflite_url &&
                revertModal.letters.status !== "failed" && (
                  <> Its alphabet model reverts with it.</>
                )}
            </p>
          </div>
        </AppModal>
      )}

      {/* Training results/failure modal now renders from TrainingJobBanner in
          Layout, so it appears even if the admin left this page before the
          run finished — see TrainingJobContext.jsx. */}
    </div>
  );
};

export default ManageModel;
