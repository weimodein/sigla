import { useState, useEffect, useMemo, memo } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useNavigate } from "react-router-dom";
import {
  getDeactivatedAdministrators,
  getDeletedAdministrators,
} from "../../api/administratorApi.js";
import { getWordStats, getAllWords } from "../../api/wordApi.js";
import { getModelVersions } from "../../api/modelApi.js";
import { getCategories } from "../../api/categoryApi.js";
import { listStagger } from "../../utils/motion.js";
import { StatCard, SkeletonCard } from "../../components/StatCard.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  BookOpen,
  Database,
  Tag,
  Cpu,
  Download,
} from "lucide-react";

// ── Stat Card ─────────────────────────────────────────────────

// ── Section Header ────────────────────────────────────────────
const SectionHeader = ({ title, description, count }) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      {description && (
        <p className="mt-0.5 text-xs text-gray-400">{description}</p>
      )}
    </div>
    {count !== undefined && (
      <span className="shrink-0 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
        {count} total
      </span>
    )}
  </div>
);

const asPercent = (value) => {
  const number = Number(value);
  return value == null || !Number.isFinite(number)
    ? null
    : Number((number * 100).toFixed(1));
};

const formatAccuracy = (value) => {
  const percent = asPercent(value);
  return percent == null ? "—" : `${percent.toFixed(1)}%`;
};

const pairState = (pair) => {
  const statuses = [pair.words?.status, pair.letters?.status].filter(Boolean);

  if (!pair.words || !pair.letters) {
    return { label: "Incomplete" };
  }
  if (statuses.every((status) => status === "deployed")) {
    return { label: "Active" };
  }
  if (statuses.some((status) => status === "deployed")) {
    return { label: "Needs attention" };
  }
  if (statuses.some((status) => status === "failed")) {
    return { label: "Failed" };
  }
  if (statuses.some((status) => status === "training")) {
    return { label: "Training" };
  }
  if (statuses.every((status) => status === "trained")) {
    return { label: "Ready" };
  }
  return { label: "Previous" };
};

// ── Simple Table ──────────────────────────────────────────────
const SimpleTable = ({ headers, rows, emptyMessage }) => (
  <div className="overflow-x-auto rounded-lg border border-gray-200">
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
        <tr>
          {headers.map((h) => (
            <th key={h} className="px-4 py-3">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={headers.length}
              className="text-center py-6 text-gray-400 text-xs"
            >
              {emptyMessage || "No records found"}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr
              key={i}
              className="border-t row-interactive list-item-in"
              style={listStagger(i)}
            >
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-gray-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

// ── Main Component ────────────────────────────────────────────
// Load report rows in bounded pages so trends and exports do not silently stop at
// the first API page when the vocabulary grows.
// ── Skeletons ──
// Module scope on purpose. These used to be declared inside ReportsAnalytics, so
// React saw a new component type on every render and remounted them — which
// restarted `animate-pulse` from frame 0 and made the skeletons visibly stutter
// while data loaded.

const SkeletonChart = () => (
  <div className="dash-card animate-pulse">
    <div className="dash-card-header">
      <div className="h-4 w-32 bg-gray-200 rounded" />
    </div>
    <div className="dash-card-body">
      <div className="h-[220px] bg-gray-100 rounded" />
    </div>
  </div>
);

const SkeletonTable = () => (
  <div className="dash-card animate-pulse">
    <div className="dash-card-header">
      <div className="h-4 w-28 bg-gray-200 rounded" />
    </div>
    <div className="rounded-lg border border-gray-200 overflow-hidden mx-6 mb-6">
      <div className="h-10 bg-gray-50" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-12 border-t px-4 py-3 flex gap-4">
          <div className="h-4 flex-1 bg-gray-100 rounded" />
          <div className="h-4 flex-1 bg-gray-100 rounded" />
          <div className="h-4 w-12 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  </div>
);

const WORD_FETCH_LIMIT = 500;

const getReportWords = async () => {
  const firstPage = await getAllWords({ page: 1, limit: WORD_FETCH_LIMIT });
  const allWords = [...(firstPage.words || [])];

  for (let page = 2; page <= (firstPage.totalPages || 1); page += 1) {
    const nextPage = await getAllWords({ page, limit: WORD_FETCH_LIMIT });
    allWords.push(...(nextPage.words || []));
  }

  const uniqueWords = [
    ...new Map(allWords.map((entry) => [entry.id, entry])).values(),
  ];
  return { ...firstPage, words: uniqueWords };
};

// Start of the window for each range option, or null for "all time".
const rangeStart = (range) => {
  const now = new Date();
  if (range === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6); // today plus the previous 6 days
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (range === "month") {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (range === "year") {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return null;
};

const ReportsAnalytics = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const { isSuper, user } = useAuth();
  const [filter, setFilter] = useState("month");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [modelLoadFailed, setModelLoadFailed] = useState(false);
  const [dataAsOf, setDataAsOf] = useState(null);

  const [wordStats, setWordStats] = useState(null);
  const [deactivatedUsers, setDeactivatedUsers] = useState([]);
  const [deletedUsers, setDeletedUsers] = useState([]);
  const [words, setWords] = useState([]);
  // Total words on the server, which may exceed WORD_FETCH_LIMIT.
  const [wordTotal, setWordTotal] = useState(0);
  const [models, setModels] = useState([]);
  const [categoryCount, setCategoryCount] = useState(null);

  // Report sections per scope §20: word statistics, gesture sample counts, model accuracy.
  const [reportSections, setReportSections] = useState({
    word_stats: true,
    sample_counts: true,
    model_accuracy: true,
  });

  const [deactivatedPage, setDeactivatedPage] = useState(1);
  const [deletedPage, setDeletedPage] = useState(1);
  const PAGE_SIZE = 5;

  // ── Fetch ───────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    setLoadError(false);
    setModelLoadFailed(false);
    try {
      // The deactivated/deleted rosters are super-only. Regular admins skip them
      // and simply don't see those tables.
      //
      // These come from the DEDICATED endpoints. Filtering GET /administrators by
      // status could never work for deleted accounts: that route hardcodes
      // `status != "deleted"`, so the "Deleted Accounts" table was guaranteed to
      // render empty no matter how many accounts had been deleted.
      const [wStats, deactivatedData, deletedData, wordsData, catsData] =
        await Promise.all([
          getWordStats({ force: true }),
          isSuper ? getDeactivatedAdministrators() : Promise.resolve({ administrators: [] }),
          isSuper ? getDeletedAdministrators() : Promise.resolve({ administrators: [] }),
          getReportWords(),
          getCategories({ force: true }),
        ]);

      setWordStats(wStats);
      setCategoryCount((catsData.categories || []).length);

      setDeactivatedUsers(deactivatedData.administrators || []);
      setDeletedUsers(deletedData.administrators || []);
      setWords(wordsData.words || []);
      // Keep the server total separately so an unexpected partial response can
      // still be disclosed in the export rather than presented as complete.
      setWordTotal(
        typeof wordsData.total === "number" ? wordsData.total : (wordsData.words || []).length,
      );

      try {
        const mData = await getModelVersions({ force: true });
        setModels(mData.models || []);
      } catch {
        setModels([]);
        setModelLoadFailed(true);
      }
      setDataAsOf(new Date());
    } catch {
      setLoadError(true);
      setDataAsOf(null);
      toast.error("Failed to load reports data");
    } finally {
      setLoading(false);
    }
  };

  // `filter` is deliberately NOT a dependency. The week/month/year range is
  // applied entirely client-side by the wordsInRange memo below, and none of
  // these endpoints take a date parameter — so refetching on a range change
  // re-requested every report source (including the paginated vocabulary) for identical data.
  // isSuper stays: it genuinely changes which endpoints are called.
  useEffect(() => {
    fetchAll();
    // The range is applied locally; only the administrator scope changes sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  // Range changes only reset pagination.
  useEffect(() => {
    setDeactivatedPage(1);
    setDeletedPage(1);
  }, [filter]);

  // ── Chart data helpers ──────────────────────────────────────
  // Words submitted inside the selected range. The range used to be cosmetic —
  // it changed only the x-axis label format while every bucket still counted
  // ALL words ever created, so "Week" collapsed every Monday in history into a
  // single point and the PDF claimed to be filtered when it was not.
  const wordsInRange = useMemo(() => {
    const start = rangeStart(filter);
    if (!start) return words;
    return words.filter((w) => {
      const t = new Date(w.created_at).getTime();
      return Number.isFinite(t) && t >= start.getTime();
    });
  }, [words, filter]);

  const submissionTrend = useMemo(() => {
    // Bucket by a SORTABLE key, carrying the label separately. Keying on the
    // display string meant "Mar 5" merged across years, and Object.entries
    // preserved the API's created_at DESC order, so the chart ran newest→oldest.
    const buckets = new Map();
    wordsInRange.forEach((w) => {
      const date = new Date(w.created_at);
      if (Number.isNaN(date.getTime())) return;

      let sortKey;
      let label;
      if (filter === "week" || filter === "month") {
        // One point per calendar day.
        sortKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        label =
          filter === "week"
            ? date.toLocaleDateString("en-PH", { weekday: "short" })
            : date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
      } else {
        // One point per calendar month.
        sortKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        label = date.toLocaleDateString("en-PH", { month: "short", year: "numeric" });
      }

      const existing = buckets.get(sortKey);
      if (existing) existing.submissions += 1;
      else buckets.set(sortKey, { name: label, submissions: 1 });
    });

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [wordsInRange, filter]);

  // One point per version, with each model kind kept in its own series. Missing
  // measurements remain null instead of being rendered as a false 0%.
  const modelPairs = useMemo(() => {
    const grouped = new Map();

    models.forEach((model) => {
      const version = model.version_number;
      if (!version) return;
      const pair = grouped.get(version) || {
        version,
        words: null,
        letters: null,
        timestamp: 0,
        trainedTimestamp: 0,
      };
      const kind = model.model_kind === "letters" ? "letters" : "words";
      pair[kind] = model;
      pair.timestamp = Math.max(
        pair.timestamp,
        new Date(model.trained_at || model.created_at || 0).getTime() || 0,
      );
      pair.trainedTimestamp = Math.max(
        pair.trainedTimestamp,
        new Date(model.trained_at || 0).getTime() || 0,
      );
      grouped.set(version, pair);
    });

    return [...grouped.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [models]);

  const modelAccuracyData = useMemo(
    () =>
      modelPairs
        .map((pair) => ({
          version: pair.version,
          words: asPercent(pair.words?.accuracy),
          alphabet: asPercent(pair.letters?.accuracy),
        }))
        .filter((point) => point.words != null || point.alphabet != null),
    [modelPairs],
  );

  // Sample counts are cumulative per word, not per-period, so this intentionally
  // uses the full list rather than wordsInRange — restricting it to a date window
  // would show a word's lifetime sample count only if it happened to be created
  // inside that window, which is misleading.
  //
  // `.filter()` already copies, so the `.sort()` below no longer mutates state.
  const samplesPerWord = useMemo(
    () =>
      words
        .filter((w) => (w.total_samples || 0) > 0)
        .sort((a, b) => (b.total_samples || 0) - (a.total_samples || 0))
        .slice(0, 10)
        .map((w) => ({
          name: w.label.length > 10 ? w.label.slice(0, 10) + "…" : w.label,
          samples: w.total_samples || 0,
          approved: w.approved_sample_count || 0,
        })),
    [words]
  );

  // Current means one version whose words and alphabet rows are both deployed.
  // Never fall back to the highest-scoring row: that is not necessarily live.
  const deploymentSummary = useMemo(() => {
    if (modelLoadFailed) {
      return { state: "error", label: "Model data unavailable", pair: null };
    }
    const withDeployedRows = modelPairs.filter(
      (pair) =>
        pair.words?.status === "deployed" || pair.letters?.status === "deployed",
    );
    const activePair =
      withDeployedRows.length === 1 &&
      withDeployedRows[0].words?.status === "deployed" &&
      withDeployedRows[0].letters?.status === "deployed"
        ? withDeployedRows[0]
        : null;

    if (activePair) {
      return {
        state: "active",
        label: `Active pair · v${activePair.version}`,
        pair: activePair,
      };
    }
    if (withDeployedRows.length > 0) {
      return {
        state: "warning",
        label: "Deployment needs attention",
        pair: null,
      };
    }
    return { state: "empty", label: "No active model pair", pair: null };
  }, [modelPairs, modelLoadFailed]);

  const toggleSection = (key) =>
    setReportSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Generate PDF report ─────────────────────────────────────
  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const generatedAt = new Date();
      const rangeFrom = rangeStart(filter);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 16;
      const navy = [30, 58, 138];
      const muted = [100, 116, 139];

      const formatDate = (value) => {
        if (value == null) return "N/A";
        const date = new Date(value);
        return Number.isNaN(date.getTime())
          ? "N/A"
          : date.toLocaleDateString("en-PH", {
              year: "numeric",
              month: "short",
              day: "numeric",
            });
      };
      const formatDateTime = (value) => {
        if (value == null || value === 0) return "N/A";
        const date = new Date(value);
        return Number.isNaN(date.getTime())
          ? "N/A"
          : date.toLocaleString("en-PH", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            });
      };
      const pdfAccuracy = (value) => {
        const percent = asPercent(value);
        return percent == null ? "N/A" : `${percent.toFixed(1)}%`;
      };
      const titleCase = (value) =>
        String(value || "N/A")
          .replaceAll("_", " ")
          .replace(/\b\w/g, (letter) => letter.toUpperCase());

      const activityRangeLabel = `${formatDate(rangeFrom)} to ${formatDate(generatedAt)}`;
      const sectionNames = [
        reportSections.word_stats && "Vocabulary statistics",
        reportSections.sample_counts && "Gesture sample counts",
        reportSections.model_accuracy && "Model accuracy",
      ].filter(Boolean);

      doc.setProperties({
        title: "SigLa System Report",
        subject: "Reports and analytics export",
        author: user?.username || "SigLa administrator",
        creator: "SigLa Administrator Platform",
      });

      // Report header and scope metadata.
      doc.setFillColor(...navy);
      doc.rect(0, 0, pageWidth, 34, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("SIGLA ADMINISTRATOR PLATFORM", margin, 11);
      doc.setFontSize(20);
      doc.text("Reports & Analytics", margin, 24);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated ${formatDateTime(generatedAt)}`, pageWidth - margin, 15, {
        align: "right",
      });
      doc.text(`By ${user?.username || "Administrator"}`, pageWidth - margin, 22, {
        align: "right",
      });
      doc.text(`Data as of ${formatDateTime(dataAsOf || generatedAt)}`, pageWidth - margin, 29, {
        align: "right",
      });

      doc.setTextColor(31, 41, 55);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("Activity range", margin, 44);
      doc.text("Included sections", margin, 51);
      doc.setFont("helvetica", "normal");
      doc.text(activityRangeLabel, 48, 44);
      doc.text(sectionNames.join(", "), 48, 51);
      doc.setTextColor(...muted);
      doc.text(
        "The activity range applies only to new vocabulary entries. Inventory, sample, and model values are current all-time data.",
        margin,
        59,
      );

      let y = 69;
      const sectionGap = 10;

      const ensureSpace = (required = 28) => {
        if (y + required > pageHeight - 16) {
          doc.addPage();
          y = 18;
        }
      };

      const addSectionTitle = (title, description) => {
        // Reserve enough room for the heading and the first part of its table so
        // a section title is not orphaned at the foot of a page.
        ensureSpace(description ? 50 : 38);
        doc.setTextColor(...navy);
        doc.setFontSize(13);
        doc.setFont("helvetica", "bold");
        doc.text(title, margin, y);
        y += 5;
        if (description) {
          doc.setTextColor(...muted);
          doc.setFontSize(8.5);
          doc.setFont("helvetica", "normal");
          const lines = doc.splitTextToSize(description, pageWidth - margin * 2);
          doc.text(lines, margin, y);
          y += lines.length * 4;
        }
        y += 2;
      };

      const addNote = (message) => {
        const lines = doc.splitTextToSize(message, pageWidth - margin * 2 - 8);
        const height = Math.max(10, lines.length * 4 + 5);
        ensureSpace(height + 5);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(margin, y, pageWidth - margin * 2, height, 2, 2, "FD");
        doc.setTextColor(...muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.text(lines, margin + 4, y + 6);
        y += height + 5;
      };

      const tableDefaults = {
        theme: "grid",
        margin: { left: margin, right: margin, top: 16, bottom: 18 },
        styles: {
          font: "helvetica",
          fontSize: 8,
          cellPadding: 2.5,
          textColor: [51, 65, 85],
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
          overflow: "linebreak",
          valign: "middle",
        },
        headStyles: {
          fillColor: navy,
          textColor: [255, 255, 255],
          fontStyle: "bold",
          lineColor: navy,
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      };

      const wordVocabularyCount = words.filter(
        (entry) => entry.vocabulary !== "letters",
      ).length;
      const alphabetVocabularyCount = words.filter(
        (entry) => entry.vocabulary === "letters",
      ).length;
      const approvedSampleTotal = words.reduce(
        (sum, entry) => sum + Number(entry.approved_sample_count || 0),
        0,
      );
      const entriesWithSamples = words.filter(
        (entry) => Number(entry.total_samples || 0) > 0,
      ).length;

      if (reportSections.word_stats) {
        addSectionTitle(
          "1. Vocabulary overview",
          "Current inventory totals are separated from newly created entries in the selected activity range.",
        );
        autoTable(doc, {
          ...tableDefaults,
          startY: y,
          head: [["Metric", "Value", "Metric", "Value"]],
          body: [
            ["Total entries", wordStats?.total ?? 0, "Active entries", wordStats?.active ?? 0],
            ["Words vocabulary", wordVocabularyCount, "Alphabet vocabulary", alphabetVocabularyCount],
            ["Pending review", wordStats?.pending ?? 0, "Approved", wordStats?.approved ?? 0],
            ["Rejected", wordStats?.rejected ?? 0, "Approved but inactive", wordStats?.ready_to_activate ?? 0],
            ["Categories", categoryCount ?? 0, "Gesture samples", wordStats?.total_samples ?? 0],
            ["New entries in activity range", wordsInRange.length, "Activity range", activityRangeLabel],
          ],
          columnStyles: {
            0: { fontStyle: "bold", cellWidth: 55 },
            1: { cellWidth: 70 },
            2: { fontStyle: "bold", cellWidth: 55 },
          },
        });
        y = doc.lastAutoTable.finalY + sectionGap;
      }

      if (reportSections.sample_counts) {
        addSectionTitle(
          `${reportSections.word_stats ? "2" : "1"}. Gesture sample coverage`,
          "Sample counts are current all-time database counts. Approved samples are shown separately from total submitted samples.",
        );
        autoTable(doc, {
          ...tableDefaults,
          startY: y,
          head: [["Metric", "Value", "Metric", "Value"]],
          body: [
            ["Total gesture samples", wordStats?.total_samples ?? 0, "Approved samples", approvedSampleTotal],
            ["Entries with samples", entriesWithSamples, "Entries without samples", Math.max(0, words.length - entriesWithSamples)],
          ],
          columnStyles: {
            0: { fontStyle: "bold", cellWidth: 55 },
            1: { cellWidth: 70 },
            2: { fontStyle: "bold", cellWidth: 55 },
          },
        });
        y = doc.lastAutoTable.finalY + 6;

        if (wordTotal > words.length) {
          addNote(
            `The API returned ${words.length} of ${wordTotal} vocabulary entries. The detail table below is partial; all-time totals above remain server-calculated.`,
          );
        }

        const sampleRows = [...words]
          .sort((a, b) => {
            const vocabularyOrder = String(a.vocabulary || "words").localeCompare(
              String(b.vocabulary || "words"),
            );
            return vocabularyOrder || String(a.label).localeCompare(String(b.label));
          })
          .map((entry) => [
            entry.label,
            entry.vocabulary === "letters" ? "Alphabet" : "Words",
            titleCase(entry.status),
            entry.category || "Uncategorized",
            Number(entry.approved_sample_count || 0),
            Number(entry.total_samples || 0),
          ]);

        if (sampleRows.length > 0) {
          autoTable(doc, {
            ...tableDefaults,
            startY: y,
            head: [["Entry", "Vocabulary", "Status", "Category", "Approved", "Total"]],
            body: sampleRows,
            columnStyles: {
              0: { fontStyle: "bold", cellWidth: 55 },
              1: { cellWidth: 30 },
              2: { cellWidth: 30 },
              3: { cellWidth: 65 },
              4: { halign: "right", cellWidth: 30 },
              5: { halign: "right", cellWidth: 30 },
            },
          });
          y = doc.lastAutoTable.finalY + sectionGap;
        } else {
          addNote("No vocabulary entries are available for the sample coverage table.");
        }
      }

      if (reportSections.model_accuracy) {
        const sectionNumber =
          Number(reportSections.word_stats) + Number(reportSections.sample_counts) + 1;
        addSectionTitle(
          `${sectionNumber}. Model pair accuracy`,
          "Words and alphabet are separate models under one version. Their evaluation accuracies are reported independently and are never averaged.",
        );

        if (modelLoadFailed) {
          addNote(
            "Model data could not be loaded when this report snapshot was created. No deployment status or accuracy is reported because an empty result would be misleading.",
          );
        } else if (deploymentSummary.pair) {
          const pair = deploymentSummary.pair;
          const deployedAt = Math.max(
            new Date(pair.words?.deployed_at || 0).getTime() || 0,
            new Date(pair.letters?.deployed_at || 0).getTime() || 0,
          );
          autoTable(doc, {
            ...tableDefaults,
            startY: y,
            head: [["Current deployment", "Value", "Current deployment", "Value"]],
            body: [
              ["Version", pair.version, "Pair status", "Active"],
              ["Words accuracy", pdfAccuracy(pair.words?.accuracy), "Alphabet accuracy", pdfAccuracy(pair.letters?.accuracy)],
              ["Words classes", pair.words?.total_classes ?? "N/A", "Alphabet classes", pair.letters?.total_classes ?? "N/A"],
              ["Deployed", deployedAt ? formatDateTime(deployedAt) : "N/A", "Trainer", pair.words?.trainer?.username || pair.letters?.trainer?.username || "N/A"],
            ],
            columnStyles: {
              0: { fontStyle: "bold", cellWidth: 55 },
              1: { cellWidth: 70 },
              2: { fontStyle: "bold", cellWidth: 55 },
            },
          });
          y = doc.lastAutoTable.finalY + 6;
        } else {
          addNote(
            deploymentSummary.state === "warning"
              ? "Deployment consistency warning: deployed words and alphabet rows do not form one complete version pair. No accuracy is labeled as current."
              : "There is no currently deployed words-and-alphabet model pair.",
          );
        }

        if (!modelLoadFailed) {
          addNote(
            "Accuracy is the stored evaluation result from model training/testing. It is not a measurement of live-user recognition success.",
          );

          const modelRows = [...modelPairs].reverse().map((pair) => [
            pair.version,
            pairState(pair).label,
            pdfAccuracy(pair.words?.accuracy),
            pair.words?.total_classes ?? "N/A",
            pdfAccuracy(pair.letters?.accuracy),
            pair.letters?.total_classes ?? "N/A",
            pair.trainedTimestamp ? formatDate(pair.trainedTimestamp) : "N/A",
            pair.words?.trainer?.username || pair.letters?.trainer?.username || "N/A",
          ]);

          if (modelRows.length > 0) {
            autoTable(doc, {
              ...tableDefaults,
              startY: y,
              head: [[
                "Version",
                "Pair status",
                "Words accuracy",
                "Words classes",
                "Alphabet accuracy",
                "Alphabet classes",
                "Trained",
                "Trainer",
              ]],
              body: modelRows,
              columnStyles: {
                0: { fontStyle: "bold", cellWidth: 28 },
                1: { cellWidth: 34 },
                2: { halign: "right", cellWidth: 31 },
                3: { halign: "right", cellWidth: 28 },
                4: { halign: "right", cellWidth: 35 },
                5: { halign: "right", cellWidth: 31 },
                6: { cellWidth: 33 },
                7: { cellWidth: 32 },
              },
            });
            y = doc.lastAutoTable.finalY + sectionGap;
          } else {
            addNote("No model versions are available.");
          }
        }
      }

      // Add stable page numbering only after every autoTable has created pages.
      const pageCount = doc.getNumberOfPages();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        doc.setPage(pageNumber);
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
        doc.setTextColor(...muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text("SigLa system report", margin, pageHeight - 7);
        doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - margin, pageHeight - 7, {
          align: "right",
        });
      }

      const dateKey = generatedAt.toISOString().split("T")[0];
      doc.save(`sigla_system_report_${filter}_${dateKey}.pdf`);
      toast.success("Report downloaded successfully");
    } catch {
      toast.error("Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };


  // ── JSX ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {["week", "month", "year"].map((f) => (
              <div
                key={f}
                className="w-14 h-7 bg-gray-200 rounded-md animate-pulse"
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard index={i} key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonChart key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonTable key={i} />
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5 animate-pulse">
          <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-52 bg-gray-100 rounded mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1f2937", margin: 0 }}>
            Reports & Analytics
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: 4 }}>
            System activity overview and data exports
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-medium text-gray-400 sm:inline">
            Activity range
          </span>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {["week", "month", "year"].map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition capitalize ${
                  filter === f
                    ? "bg-white text-blue-900 shadow-sm"
                    : "interactive text-gray-500 hover:text-gray-700"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards (scope §20): words, gesture samples, categories, model pair */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard index={0}
          title="Vocabulary Entries"
          value={wordStats?.total}
          icon={BookOpen}
          color="bg-blue-900"
          onClick={() => navigate("/dataset")}
        />
        <StatCard index={1}
          title="Gesture Samples"
          value={wordStats?.total_samples}
          icon={Database}
          color="bg-blue-700"
          onClick={() => navigate("/dataset")}
        />
        <StatCard index={2}
          title="Total Categories"
          value={categoryCount}
          icon={Tag}
          color="bg-green-600"
          onClick={() => navigate("/categories")}
        />
        <button
          type="button"
          onClick={() => navigate("/model")}
          className="dash-stat-card list-item-in flex w-full items-center gap-3 text-left"
          style={listStagger(3)}
        >
          <div className="shrink-0 rounded-full bg-violet-600 p-3">
            <Cpu size={20} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  deploymentSummary.state === "active"
                    ? "bg-emerald-500"
                    : deploymentSummary.state === "warning"
                      ? "bg-amber-500"
                      : deploymentSummary.state === "error"
                        ? "bg-red-500"
                      : "bg-gray-300"
                }`}
              />
              <p className="truncate text-xs font-medium text-gray-500">
                {deploymentSummary.label}
              </p>
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div className="pr-3">
                <p className="text-[11px] text-gray-400">Words</p>
                <p className="text-xl font-bold text-gray-800">
                  {formatAccuracy(deploymentSummary.pair?.words?.accuracy)}
                </p>
              </div>
              <div className="pl-3">
                <p className="text-[11px] text-gray-400">Alphabet</p>
                <p className="text-xl font-bold text-gray-800">
                  {formatAccuracy(deploymentSummary.pair?.letters?.accuracy)}
                </p>
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="dash-card">
          <div className="dash-card-header">
            <SectionHeader
              title="Vocabulary submissions"
              description={`New entries during the selected ${filter}`}
            />
          </div>
          <div className="dash-card-body">
            {submissionTrend.length === 0 ? (
              <div className="flex h-[240px] items-center justify-center text-sm text-gray-400">
                No submissions in this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240} debounce={200}>
                <LineChart data={submissionTrend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="submissions"
                    name="Submissions"
                    stroke="#16a34a"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#ffffff", strokeWidth: 2 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-header">
            <SectionHeader
              title="Accuracy by model version"
              description="Words and alphabet are reported separately"
            />
          </div>
          <div className="dash-card-body">
            {modelAccuracyData.length === 0 ? (
              <div className="flex h-[240px] items-center justify-center text-sm text-gray-400">
                {modelLoadFailed ? "Model data unavailable" : "No measured model versions"}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240} debounce={200}>
                <LineChart data={modelAccuracyData} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="version" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(value, name) => [`${value}%`, name]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="words"
                    name="Words"
                    stroke="#1d4ed8"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#ffffff", strokeWidth: 2 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="alphabet"
                    name="Alphabet"
                    stroke="#7c3aed"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#ffffff", strokeWidth: 2 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="dash-card lg:col-span-2">
          <div className="dash-card-header">
            <SectionHeader
              title="Gesture sample coverage"
              description="Top 10 vocabulary entries · all-time counts"
            />
          </div>
          <div className="dash-card-body">
            {words.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-10">
                No words available
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220} debounce={200}>
                <BarChart data={samplesPerWord} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 11 }}
                    width={65}
                  />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="samples"
                    fill="#bfdbfe"
                    radius={[0, 4, 4, 0]}
                    name="Total"
                  />
                  <Bar
                    dataKey="approved"
                    fill="#1e3a8a"
                    radius={[0, 4, 4, 0]}
                    name="Approved"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Administrator Lists — super admin only (per-admin data from /users) */}
      {isSuper && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="dash-card">
          <div className="dash-card-header">
            <SectionHeader
              title="Deactivated Administrators"
              count={deactivatedUsers.length}
            />
          </div>
          <div className="dash-card-body">
            <SimpleTable
              headers={["Username", "Email", "Since"]}
              rows={deactivatedUsers
                .slice(
                  (deactivatedPage - 1) * PAGE_SIZE,
                  deactivatedPage * PAGE_SIZE,
                )
                .map((u) => [
                  u.username,
                  u.email || "—",
                  u.deactivated_at
                    ? new Date(u.deactivated_at).toLocaleDateString("en-PH")
                    : "—",
                ])}
              emptyMessage="No deactivated administrators"
            />
            {deactivatedUsers.length > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                <span>
                  Page {deactivatedPage} of{" "}
                  {Math.ceil(deactivatedUsers.length / PAGE_SIZE)}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() =>
                      setDeactivatedPage((p) => Math.max(1, p - 1))
                    }
                    disabled={deactivatedPage === 1}
                    className="interactive px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() =>
                      setDeactivatedPage((p) =>
                        Math.min(
                          Math.ceil(deactivatedUsers.length / PAGE_SIZE),
                          p + 1,
                        ),
                      )
                    }
                    disabled={
                      deactivatedPage >=
                      Math.ceil(deactivatedUsers.length / PAGE_SIZE)
                    }
                    className="interactive px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="dash-card">
          <div className="dash-card-header">
            <SectionHeader title="Deleted Accounts" count={deletedUsers.length} />
          </div>
          <div className="dash-card-body">
            <SimpleTable
              headers={["Username", "Email"]}
              rows={deletedUsers
                .slice(
                  (deletedPage - 1) * PAGE_SIZE,
                  deletedPage * PAGE_SIZE,
                )
                .map((u) => [u.username, u.email || "—"])}
              emptyMessage="No deleted accounts"
            />
            {deletedUsers.length > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                <span>
                  Page {deletedPage} of{" "}
                  {Math.ceil(deletedUsers.length / PAGE_SIZE)}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setDeletedPage((p) => Math.max(1, p - 1))}
                    disabled={deletedPage === 1}
                    className="interactive px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() =>
                      setDeletedPage((p) =>
                        Math.min(
                          Math.ceil(deletedUsers.length / PAGE_SIZE),
                          p + 1,
                        ),
                      )
                    }
                    disabled={
                      deletedPage >=
                      Math.ceil(deletedUsers.length / PAGE_SIZE)
                    }
                    className="interactive px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Generate Report */}
      <div className="dash-card">
        <div className="dash-card-header flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Generate Report
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Select sections to include in the exported PDF
            </p>
          </div>
          <button
            onClick={handleGenerateReport}
            disabled={
              generating || loadError || !Object.values(reportSections).some(Boolean)
            }
            className="flex items-center gap-2 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
          >
            <Download size={16} />
            {generating ? "Generating..." : "Generate Report"}
          </button>
        </div>
        <div className="dash-card-body">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { key: "word_stats", label: "Vocabulary Statistics" },
              { key: "sample_counts", label: "Gesture Sample Counts" },
              { key: "model_accuracy", label: "Model Accuracy" },
            ].map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center gap-2 cursor-pointer group"
              >
                <input
                  type="checkbox"
                  checked={reportSections[key]}
                  onChange={() => toggleSection(key)}
                  className="w-4 h-4 accent-blue-900 cursor-pointer"
                />
                <span className="text-xs text-gray-600 group-hover:text-gray-800">
                  {label}
                </span>
              </label>
            ))}
          </div>
          {loadError ? (
            <p className="mt-3 text-xs text-red-600">
              Report generation is unavailable because the current data did not load.
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-3">
              Activity range:{" "}
              <strong className="text-gray-600 capitalize">{filter}</strong>
              {" · "}Summary totals remain all time · Exported as PDF
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(ReportsAnalytics);
