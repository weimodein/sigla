import { ChevronLeft, ChevronRight } from "lucide-react";

const C = {
  border: "#e5e7eb",
};

// Compact Prev/Next + "page X of Y", meant to sit in a table's header row so
// paging doesn't require scrolling all the way to the bottom bar first. Every
// paginated table on the admin renders one of these at the top AND keeps its
// existing full pagination bar (with the result count and page-size picker)
// at the bottom — this is a second, lighter control, not a replacement.
//
// Deliberately stateless: the page belongs to whichever page/pageSize state
// each table already owns, so this never becomes a second source of truth.
const PageNav = ({ page, totalPages, onChange, disabled = false }) => {
  if (totalPages <= 1) return null;

  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={disabled || atFirst}
        aria-label="Previous page"
        style={{
          width: "28px", height: "28px", padding: 0, borderRadius: "6px",
          border: `1px solid ${C.border}`, background: "white",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: disabled || atFirst ? "not-allowed" : "pointer",
          opacity: disabled || atFirst ? 0.4 : 1,
        }}
      >
        <ChevronLeft size={14} />
      </button>
      <span className="text-xs text-gray-500" style={{ whiteSpace: "nowrap" }}>
        Page {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={disabled || atLast}
        aria-label="Next page"
        style={{
          width: "28px", height: "28px", padding: 0, borderRadius: "6px",
          border: `1px solid ${C.border}`, background: "white",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: disabled || atLast ? "not-allowed" : "pointer",
          opacity: disabled || atLast ? 0.4 : 1,
        }}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
};

export default PageNav;
