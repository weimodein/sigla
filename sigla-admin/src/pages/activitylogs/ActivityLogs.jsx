import { useState, useEffect, useCallback } from "react";
import { getActivityLogs } from "../../api/activityLogApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import { listStagger } from "../../utils/motion.js";
import { TableSkeletonRows } from "../../components/Skeleton.jsx";
import PageNav from "../../components/PageNav.jsx";
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
  reset_admin_password: { label: "Reset Admin Password", color: C.orange },
  // Written by authController.resetPassword. Missing here meant the row rendered
  // via the fallback humaniser but was absent from the Action Type dropdown, so
  // the most security-relevant event could not be filtered for.
  password_reset_completed: { label: "Password Reset", color: C.orange },
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
  { value: "administrator", label: "Administrator" },
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
        fontSize: 13,
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
    className="data-pagination meta-text flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-gray-500"
    style={{ borderTop: `1px solid ${C.border}` }}
  >
    <div className="flex items-center gap-3">
      <span>
        {total} result{total !== 1 ? "s" : ""}
      </span>
      <select
        value={pageSize}
        onChange={(e) => onPageSize(+e.target.value)}
        className="rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
        style={{ border: `1px solid ${C.border}` }}
      >
        <option value={10}>10 / page</option>
        <option value={25}>25 / page</option>
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
const LOG_SKELETON_COLUMNS = [
  { width: "w-24" },
  { type: "pill", width: "w-28" },
  { width: "w-28" },
  { width: "w-full" },
  { width: "w-32" },
];

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
  const [pageSize, setPageSize] = useState(10);

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
      <div className="page-header">
        <h2 className="page-title">
          Activity Logs
        </h2>
        <p className="page-subtitle">
          A permanent, read-only record of significant actions in the system
        </p>
      </div>

      {/* Filters */}
      <div className="filter-bar mb-4">
        {/* Action type */}
        <div className="filter-field filter-field-half-mobile">
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
        <div className="filter-field filter-field-half-mobile">
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
        <div className="filter-field filter-field-half-mobile">
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
        <div className="filter-field filter-field-half-mobile">
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
        <div className="filter-field-grow">
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
            className="mobile-full-width interactive flex items-center justify-center gap-1 px-3 py-2.5 text-sm rounded-xl transition hover:bg-gray-100"
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
        {totalPages > 1 && (
          <div className="flex items-center justify-end px-5 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
            {/* Same Prev/Next as the bottom bar — paging without scrolling down
                to it first, on a table that can run to many pages. */}
            <PageNav page={page} totalPages={totalPages} onChange={setPage} disabled={loading} />
          </div>
        )}
        <div className="table-scroll" role="region" aria-label="Activity logs table" tabIndex={0}>
          <table className="data-table mobile-card-table activity-mobile-table table-text text-left" style={{ minWidth: 860, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "16%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
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
                <TableSkeletonRows rows={8} columns={LOG_SKELETON_COLUMNS} />
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm" style={{ color: C.muted }}>
                    No activity found
                  </td>
                </tr>
              ) : (
                logs.map((log, i) => (
                  <tr
                    key={log.id}
                    className="row-interactive list-item-in"
                    style={{ borderTop: `1px solid ${C.border}`, ...listStagger(i) }}
                  >
                    <td className="px-5 py-3.5 font-semibold" style={{ color: C.text }}>
                      {log.administrator?.username || "System"}
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
                    <td className="px-5 py-3.5" style={{ color: C.muted, fontSize: 15, whiteSpace: "nowrap" }}>
                      {formatDateTime(log.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Rendered whenever there are rows, not only when they overflow one
            page. Gating on `total > pageSize` hid the whole bar — including the
            page-size <select> — so choosing 100/page with fewer results stranded
            the user at 100 with no way back short of a reload. */}
        {!loading && total > 0 && (
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
