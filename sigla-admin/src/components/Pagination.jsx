import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { C } from "../utils/colors.js";

// The full table footer: result count, page-size picker, first/prev/next/last.
// ActivityLogs and ManageAdministrators each carried a copy. PageNav is the
// lighter Prev/Next control that sits in a table's header row.
const Pagination = ({ page, totalPages, onPage, pageSize, onPageSize, total }) => {
  const buttons = (items) =>
    items.map((b) => (
      <button
        key={b.label}
        onClick={b.action}
        disabled={b.disabled}
        aria-label={b.label}
        className="p-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition hover:bg-gray-100"
      >
        {b.icon}
      </button>
    ));

  return (
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
        {buttons([
          { label: "First page", icon: <ChevronsLeft size={16} />, action: () => onPage(1), disabled: page === 1 },
          { label: "Previous page", icon: <ChevronLeft size={16} />, action: () => onPage(page - 1), disabled: page === 1 },
        ])}
        <span className="px-3 font-medium" style={{ color: C.text }}>
          Page {page} of {totalPages || 1}
        </span>
        {buttons([
          { label: "Next page", icon: <ChevronRight size={16} />, action: () => onPage(page + 1), disabled: page >= totalPages },
          { label: "Last page", icon: <ChevronsRight size={16} />, action: () => onPage(totalPages), disabled: page >= totalPages },
        ])}
      </div>
    </div>
  );
};

export default Pagination;
