import { useState, useEffect, useRef, Fragment } from "react";
import AppModal from "../../components/AppModal.jsx";
import Button from "../../components/Button.jsx";
import { StatCard, SkeletonCard } from "../../components/StatCard.jsx";
import { listStagger } from "../../utils/motion.js";
import { invalidate } from "../../utils/apiCache.js";
import {
  getAllModels,
  getModelStats,
  trainModel,
  getModelStatus,
  deployModel,
  revertModel,
  deleteModel,
} from "../../api/modelApi.js";
import { getWordStats } from "../../api/wordApi.js";
import { useToast } from "../../context/ToastContext.jsx";
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
      className="px-2.5 py-1 rounded-full text-xs font-semibold"
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
  const [stats, setStats] = useState(null);
  const [wordStats, setWordStats] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Sorting
  const [sortField, setSortField] = useState("trained_at");
  const [sortDir, setSortDir] = useState("desc");

  // Modal state
  const [trainModal, setTrainModal] = useState(false);
  const [deployModal, setDeployModal] = useState(null);
  const [revertModal, setRevertModal] = useState(null);
  const [resultModal, setResultModal] = useState(null);

  // Train form
  const [trainForm, setTrainForm] = useState({ version_number: "", notes: "" });

  // Async training poll state
  const [trainingModelId, setTrainingModelId] = useState(null);
  const [trainingVersion, setTrainingVersion] = useState("");
  // The alphabet row trained alongside the words model in the same run. Polled
  // together with it so a failed alphabet is reported rather than sitting
  // unnoticed as a "failed" row in the table.
  const [trainingLettersId, setTrainingLettersId] = useState(null);
  const pollingRef = useRef(null);

  // ── Fetch data ──────────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsData, modelsData, wordStatsData] = await Promise.all([
        getModelStats(),
        // force: this page reads status === "training" from the list below to
        // re-adopt a run already in flight. A cached copy would show no banner,
        // re-enable the Train button, and leave the run looking stuck forever —
        // exactly the bug the re-adoption logic was written to fix.
        getAllModels({ force: true }),
        getWordStats(),
      ]);
      setStats(statsData);
      const list = modelsData.models || [];
      setModels(list);
      setWordStats(wordStatsData);

      // Adopt a training run that is already in flight. Training happens in a
      // background job on the server, so it survives the admin navigating away
      // or reloading — but trainingModelId is component state and does not.
      // Without this, returning to the page showed no banner, re-enabled the
      // Train button, and never reported the outcome: the run looked stuck at
      // "training" forever even though the server had finished it.
      // Prefer the WORDS row as the one to track: a run produces both, the
      // words model is the long half, and the poll reads the alphabet through
      // trainingLettersId rather than tracking it directly.
      const training = list.filter((m) => m.status === "training");
      const inFlight =
        training.find((m) => m.model_kind !== "letters") || training[0];
      setTrainingModelId((current) => {
        if (inFlight) {
          setTrainingVersion(inFlight.version_number || "");
          // Re-adopt the alphabet row of the same version too, so a reload
          // mid-run still reports the alphabet's outcome instead of declaring
          // the run finished when only the words half is done.
          const companion = list.find(
            (m) =>
              m.version_number === inFlight.version_number &&
              m.model_kind === "letters" &&
              m.id !== inFlight.id,
          );
          setTrainingLettersId(companion?.id ?? null);
          return inFlight.id;
        }
        // Only clear when we were tracking a run the server no longer reports as
        // training; leave an id set moments ago by handleTrain alone, since the
        // row may not have been re-read yet.
        return current && !list.some((m) => m.id === current) ? null : current;
      });
    } catch (err) {
      toast.error("Failed to load model data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Poll training status every 5 seconds when a training job is in progress.
  //
  // The interval is cleared on unmount and whenever trainingModelId changes, and
  // fetchData re-adopts an in-flight run on mount, so navigating away and back
  // resumes polling rather than losing the run.
  useEffect(() => {
    if (!trainingModelId) return;

    // A row stranded at "training" (server restarted mid-run, so nothing will
    // ever mark it trained/failed) would otherwise poll every 5s for the whole
    // session and keep the Train button disabled forever. Give up after 30
    // minutes — well past the 20-minute ML timeout — and say so.
    const startedAt = Date.now();
    const POLL_TIMEOUT_MS = 30 * 60 * 1000;

    pollingRef.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(pollingRef.current);
        setTrainingModelId(null);
        setTrainingVersion("");
        setTrainingLettersId(null);
        showError(
          "Stopped tracking this training run — it has not reported back. Reload to check its status.",
        );
        fetchData();
        return;
      }
      try {
        const { model } = await getModelStatus(trainingModelId);

        // The alphabet trains after the words model in the same run, so the
        // words row reaching "trained" does NOT mean the run is over. Keep
        // polling until the alphabet settles too, otherwise the modal appears
        // mid-run and a later alphabet failure is never reported.
        // Resolve the alphabet row by VERSION from the list, not only from the
        // id captured when this client started the run. A run started from
        // another tab, or adopted after a reload, has no captured id — and
        // without this the modal reported "no alphabet model was trained" for a
        // run whose alphabet had in fact trained fine.
        const lettersId =
          trainingLettersId ??
          models.find(
            (m) =>
              m.version_number === model.version_number &&
              m.model_kind === "letters",
          )?.id ??
          null;

        let letters = null;
        if (lettersId) {
          try {
            letters = (await getModelStatus(lettersId)).model;
          } catch {
            // Treat an unreadable letters row as still running rather than as a
            // failure; the next tick retries, and the poll timeout is the
            // backstop if it never resolves.
            letters = null;
          }
          if (model.status === "trained" && letters && letters.status === "training") {
            return;
          }
        }

        if (model.status === "trained") {
          clearInterval(pollingRef.current);
          setTrainingModelId(null);
          setTrainingVersion("");
          setTrainingLettersId(null);
          showSuccess(`Model ${model.version_number} trained successfully`);

          // The two rows are one deployable version. A failed alphabet leaves
          // the version incomplete even when words training succeeded.
          // Keyed off `letters`, the row actually read this tick — not off the
          // captured id, which is null for a run this client did not start and
          // made the modal claim no alphabet was trained when one had been.
          const lettersNote =
            letters?.status === "trained"
              ? ` Alphabet model: ${fmt(letters.accuracy)} over ${letters.total_classes ?? "?"} letters.`
              : letters?.status === "failed"
                ? ` The alphabet model FAILED (${letters.training_error || "unknown error"}); this version cannot be deployed.`
                : !lettersId
                  ? " No alphabet model was trained — there are no letters in the word list yet."
                  : "";

          // Flattened to the shape the results modal reads. Passing the raw
          // model object left every field unreadable, so the modal rendered
          // nothing but a title and a Close button.
          setResultModal({
            title: "Training Results",
            message:
              "Training finished." +
              lettersNote,
            accuracy: model.accuracy ?? null,
            totalClasses: model.total_classes ?? null,
            versionNumber: model.version_number,
          });
          // Training completed on the SERVER, so no mutation ran on this client
          // to clear the model caches. getAllModels is already forced below, but
          // getModelStats is not and it carries current_model.
          invalidate("models:");
          fetchData();
        } else if (model.status === "failed") {
          clearInterval(pollingRef.current);
          setTrainingModelId(null);
          setTrainingVersion("");
          setTrainingLettersId(null);
          showError(`Training failed: ${model.training_error || "Unknown error"}`);
          invalidate("models:");
          fetchData();
        }
      } catch (err) {
        // A missing or forbidden model will never resolve — stop rather than
        // hammering the endpoint for the rest of the session. Network hiccups
        // (no response) keep polling, which is the original intent.
        const status = err.response?.status;
        if (status === 404 || status === 403 || status === 401) {
          clearInterval(pollingRef.current);
          setTrainingModelId(null);
          setTrainingVersion("");
          setTrainingLettersId(null);
          fetchData();
        }
      }
    }, 5000);
    return () => clearInterval(pollingRef.current);
    // trainingLettersId is a dependency, not just a closed-over value: the
    // re-adoption path in fetchData can set it AFTER this effect has started
    // (a reload mid-run learns the words row first), and without it the
    // interval would keep reading the stale null and declare the run finished
    // as soon as the words half completed.
    //
    // `models` likewise: the fallback lookup by version reads it, and a list
    // fetched after this effect started is the one that actually contains the
    // alphabet row for a run in progress.
  }, [trainingModelId, trainingLettersId, models]);

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
      // Backend returns 202 — training is running in background, start polling
      setTrainingModelId(result.model.id);
      setTrainingVersion(result.model.version_number);
      setTrainingLettersId(result.letters_model?.id ?? null);
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
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: C.text,
              margin: 0,
            }}
          >
            Manage Model
          </h1>
          <p
            style={{
              fontSize: "0.9rem",
              color: "#6b7280",
              margin: "4px 0 0",
            }}
          >
            Train, test, and deploy sign language models
          </p>
        </div>
        <button
          onClick={() => setTrainModal(true)}
          disabled={!!trainingModelId}
          className="bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          title={trainingModelId ? "Training in progress…" : undefined}
        >
          + Train New Model
        </button>
      </div>

      {/* Training in progress banner */}
      {trainingModelId && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-800">
              Training <span className="font-mono">{trainingVersion}</span> in progress…
            </p>
            <p className="text-xs text-blue-500">This may take several minutes. You can safely navigate away — this page will update automatically.</p>
          </div>
        </div>
      )}

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
      {stats?.current_model && (
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
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-4"
            style={{ fontSize: "0.9rem" }}
          >
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
      )}

      {/* Models Table ────────────────────────────────────────── */}
      <div className="dash-card">
        <div
          className="dash-card-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 className="text-base font-semibold text-gray-800" style={{ margin: 0 }}>
              Model Versions
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Words and alphabet models are managed as one version.
            </p>
          </div>
          <div
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
            <span className="text-xs text-gray-500">
              {filteredModels.length} version
              {filteredModels.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" style={{ minWidth: 1040, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "44px" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "20%" }} />
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
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-5 py-3">
                      <div className="h-4 bg-gray-200 rounded animate-pulse w-2/3" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <>
            {/* Table header row */}
            <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" style={{ minWidth: 1040, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "44px" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "20%" }} />
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
                      className="text-center py-10"
                      style={{ color: C.muted, fontSize: "0.85rem" }}
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
                        className="border-t row-interactive list-item-in text-sm"
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
                            className={`transition-transform duration-200 ${
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
                          <p className="text-sm font-medium text-gray-700">
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
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition"
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
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition"
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
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                                  <div className="grid grid-cols-3 gap-4">
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
                                  <div className="grid grid-cols-3 gap-4">
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
                className="dash-card-footer flex flex-wrap items-center justify-between gap-2"
                style={{
                  fontSize: "0.8rem",
                  color: "#6b7280",
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
                    className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-900"
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
              <p className="text-xs text-gray-400 mt-1">
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
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
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
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700">
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

      {/* Results Modal */}
      {resultModal && (
        <AppModal
          title={resultModal.title}
          onClose={() => setResultModal(null)}
          onEnter={() => setResultModal(null)}
          footer={
            /* Lone button — ModalFooter promotes it to primary. */
            <Button onClick={() => setResultModal(null)}>Close</Button>
          }
        >
          <div className="space-y-3 text-sm">
            {resultModal.message && (
              <p className="text-gray-700 leading-relaxed">
                {resultModal.message}
              </p>
            )}
            {(resultModal.accuracy != null ||
              resultModal.totalClasses != null) && (
              <div className="grid grid-cols-2 gap-3">
                {resultModal.accuracy != null && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500">Accuracy</p>
                    <p className="font-bold text-lg text-blue-900">
                      {fmt(resultModal.accuracy)}
                    </p>
                  </div>
                )}
                {resultModal.totalClasses != null && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500">Gesture classes</p>
                    <p className="font-bold text-lg text-blue-900">
                      {resultModal.totalClasses}
                    </p>
                  </div>
                )}
              </div>
            )}
            {resultModal.versionNumber && (
              <p className="text-gray-500 text-xs">
                Version <strong>{resultModal.versionNumber}</strong>
              </p>
            )}
          </div>
        </AppModal>
      )}
    </div>
  );
};

export default ManageModel;
