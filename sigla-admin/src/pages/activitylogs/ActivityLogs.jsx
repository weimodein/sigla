import { useState, useEffect, useCallback } from "react";
import { getActivityLogs } from "../../api/activityLogApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import {
  Search,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";

// ── Color Palette ────────────────────────────────────────────
const C = {
  text: "#1f2937",
  primary: "#1e3a8a",
  green: "#22c55e",
  red: "#ef4444",
  orange: "#f97316",
  purple: "#7c3aed",
  muted: "#9ca3af",
  border: "#e5e7eb",
  surface: "#ffffff",
};

// ── Action metadata: humanized label + accent color ──────────
const ACTION_META = {
  signed_in:            { label: "Signed In",            color: C.muted },
  created_admin:        { label: "Created Admin",        color: C.green },
  updated_admin:        { label: "Updated Admin",        color: C.primary },
  deactivated_admin:    { label: "Deactivated Admin",    color: C.red },
  reactivated_admin:    { label: "Reactivated Admin",    color: C.green },
  deleted_admin:        { label: "Deleted Admin",        color: C.red },
  added_word:           { label: "Added Word",           color: C.green },
  updated_word:         { label: "Updated Word",         color: C.primary },
  deleted_word:         { label: "Deleted Word",         color: C.red },
  activated_word:       { label: "Activated Word",       color: C.green },
  approved_word:        { label: "Approved Word",        color: C.green },
  rejected_word:        { label: "Rejected Word",        color: C.red },
  approved_submission:  { label: "Approved Submission",  color: C.green },
  rejected_submission:  { label: "Rejected Submission",  color: C.red },
  uploaded_samples:     { label: "Uploaded Samples",     color: C.primary },
  trained_model:        { label: "Trained Model",        color: C.purple },
  tested_model:         { label: "Tested Model",         color: C.purple },
  deployed_model:       { label: "Deployed Model",       color: C.green },
  reverted_model:       { label: "Reverted Model",       color: C.orange },
  deleted_model:        { label: "Deleted Model",        color: C.red },
  added_category:       { label: "Added Category",       color: C.green },
  updated_category:     { label: "Updated Category",     color: C.primary },
  deleted_category:     { label: "Deleted Category",     color: C.red },
  completed_setup:      { label: "Completed Setup",      color: C.green },
};

const actionLabel = (a) =>
  ACTION_META[a]?.label ??
  a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const ACTION_OPTIONS = Object.keys(ACTION_META);

const TARGET_OPTIONS = [
  { value: "user", label: "Administrator" },
  { value: "word", label: "Word" },
  { value: "model", label: "Model" },
  { value: "category", label: "Category" },
];

// ── Action badge ─────────────────────────────────────────────
const ActionBadge = ({ action }) => {
  const color = ACTION_META[action]?.color ?? C.muted;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: color + "18",
        color,
        whiteSpace: "nowrap",
      }}
    >
      {actionLabel(action)}
    </span>
  );
};

// ── Pagination ───────────────────────────────────────────────
const Pagination = ({ page, totalPages, onPage, pageSize, onPageSize, total }) => (
  <div
    className="flex items-center justify-between px-5 py-3.5"
    style={{ borderTop: `1px solid ${C.border}`, fontSize: 13, color: "#6b7280" }}
  >
    <div className="flex items-center gap-3">
      <span>
        {total} result{total !== 1 ? "s" : ""}
      </span>
      <select
        value={pageSize}
        onChange={(e) => onPageSize(+e.target.value)}
        className="rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
        style={{ border: `1px solid ${C.border}` }}
      >
        <option value={20}>20 / page</option>
        <option value={50}>50 / page</option>
        <option value={100}>100 / page</option>
      </select>
    </div>
    <div className="flex items-center gap-1">
      {[
        { icon: <ChevronsLeft size={16} />, action: () => onPage(1), disabled: page === 1 },
        { icon: <ChevronLeft size={16} />, action: () => onPage(page - 1), disabled: page === 1 },
      ].map((b, i) => (
        <button
          key={i}
          onClick={b.action}
          disabled={b.disabled}
          className="p-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition hover:bg-gray-100"
        >
          {b.icon}
        </button>
      ))}
      <span className="px-3 font-medium" style={{ color: C.text }}>
        Page {page} of {totalPages || 1}
      </span>
      {[
        { icon: <ChevronRight size={16} />, action: () => onPage(page + 1), disabled: page >= totalPages },
        { icon: <ChevronsRight size={16} />, action: () => onPage(totalPages), disabled: page >= totalPages },
      ].map((b, i) => (
        <button
          key={i}
          onClick={b.action}
          disabled={b.disabled}
          className="p-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition hover:bg-gray-100"
        >
          {b.icon}
        </button>
      ))}
    </div>
  </div>
);

// ── Skeleton rows ────────────────────────────────────────────
const SkeletonRows = ({ rows = 8, cols = 5 }) =>
  Array.from({ length: rows }).map((_, i) => (
    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-5 py-3.5">
          <div className="h-4 rounded animate-pulse w-3/4" style={{ background: C.border }} />
        </td>
      ))}
    </tr>
  ));

// ── Format timestamp ─────────────────────────────────────────
const formatDateTime = (dateStr) => {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const targetLabel = (t) =>
  TARGET_OPTIONS.find((o) => o.value === t)?.label ?? (t || "—");

// ════════════════════════════════════════════════════════════
const ActivityLogs = () => {
  const toast = useToast();

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [actionFilter, setActionFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getActivityLogs({
        action: actionFilter || undefined,
        target_type: targetFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: debouncedSearch || undefined,
        page,
        limit: pageSize,
      });
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load activity logs");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, targetFilter, startDate, endDate, debouncedSearch, page, pageSize, toast]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever a filter changes
  useEffect(() => {
    setPage(1);
  }, [actionFilter, targetFilter, startDate, endDate, debouncedSearch, pageSize]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const hasFilters =
    actionFilter || targetFilter || startDate || endDate || search;

  const clearFilters = () => {
    setActionFilter("");
    setTargetFilter("");
    setStartDate("");
    setEndDate("");
    setSearch("");
  };

  const selectStyle = {
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.text,
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 style={{ fontSize: "1.75rem", fontWeight: 700, color: C.text, margin: 0 }}>
          Activity Logs
        </h2>
        <p style={{ fontSize: "0.9rem", color: "#6b7280", margin: "4px 0 0" }}>
          A permanent, read-only record of significant actions in the system
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        {/* Action type */}
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "#4b5563" }}>
            Action Type
          </label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={selectStyle}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </div>

        {/* Affected item */}
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "#4b5563" }}>
            Affected Item
          </label>
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={selectStyle}
          >
            <option value="">All items</option>
            {TARGET_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "#4b5563" }}>
            From
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={selectStyle}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "#4b5563" }}>
            To
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={selectStyle}
          />
        </div>

        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium mb-1" style={{ color: "#4b5563" }}>
            Search
          </label>
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: C.muted }}
            />
            <input
              type="text"
              placeholder="Search description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl focus:outline-none"
              style={selectStyle}
            />
          </div>
        </div>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-2.5 text-sm rounded-xl transition hover:bg-gray-100"
            style={{ border: `1px solid ${C.border}`, color: "#4b5563" }}
          >
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 760 }}>
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                {["User", "Action", "Affected Item", "Description", "Date & Time"].map((h) => (
                  <th key={h} className="px-5 py-3">
                    <span
                      className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: C.muted }}
                    >
                      {h}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={5} />
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10" style={{ color: C.muted, fontSize: 13 }}>
                    No activity found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="text-sm"
                    style={{ borderTop: `1px solid ${C.border}` }}
                  >
                    <td className="px-5 py-3.5 font-semibold" style={{ color: C.text }}>
                      {log.user?.username || log.user?.name || "System"}
                    </td>
                    <td className="px-5 py-3.5">
                      <ActionBadge action={log.action} />
                    </td>
                    <td className="px-5 py-3.5" style={{ color: "#4b5563" }}>
                      {log.target_type ? (
                        <span>
                          {targetLabel(log.target_type)}
                          {log.target_id != null && (
                            <span style={{ color: C.muted }}> #{log.target_id}</span>
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3.5" style={{ color: "#4b5563", maxWidth: 380 }}>
                      {log.details || "—"}
                    </td>
                    <td className="px-5 py-3.5" style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
                      {formatDateTime(log.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && total > pageSize && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPage={setPage}
            pageSize={pageSize}
            onPageSize={setPageSize}
            total={total}
          />
        )}
      </div>
    </div>
  );
};

export default ActivityLogs;
