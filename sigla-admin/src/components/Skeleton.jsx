import { createElement } from "react";

const join = (...classes) => classes.filter(Boolean).join(" ");

/**
 * Shared visual primitive for every data-loading placeholder.
 * Keeping the shimmer on one class makes motion, contrast, and reduced-motion
 * behaviour consistent without repeating animate-pulse throughout the app.
 */
export const SkeletonBlock = ({ className = "", style, as = "div" }) =>
  createElement(as, {
    "aria-hidden": true,
    className: join("skeleton-block", className),
    style,
  });

export const PageHeaderSkeleton = ({ action = false }) => (
  <div
    aria-hidden="true"
    className="flex flex-wrap items-center justify-between gap-3"
  >
    <div className="space-y-2">
      <SkeletonBlock className="h-9 w-56 max-w-[70vw] rounded-lg" />
      <SkeletonBlock className="h-5 w-72 max-w-[82vw] rounded-md" />
    </div>
    {action && <SkeletonBlock className="h-10 w-40 rounded-lg" />}
  </div>
);

const CellSkeleton = ({ type = "line", width = "w-3/4", count = 3 }) => {
  if (type === "stack") {
    return (
      <div className="space-y-2">
        <SkeletonBlock className={join("h-4 rounded", width)} />
        <SkeletonBlock className="h-3 w-2/5 rounded" />
      </div>
    );
  }

  if (type === "pill") {
    return <SkeletonBlock className={join("h-6 rounded-full", width)} />;
  }

  if (type === "actions") {
    return (
      <div className="flex items-center gap-2">
        {Array.from({ length: count }).map((_, index) => (
          <SkeletonBlock
            key={index}
            className={join("h-8 rounded-lg", index < 2 ? "w-16" : "w-8")}
          />
        ))}
      </div>
    );
  }

  return <SkeletonBlock className={join("h-4 rounded", width)} />;
};

/**
 * Table rows that preserve the information density of the final table.
 * A column can be a line, stacked label, status pill, or action cluster.
 */
export const TableSkeletonRows = ({
  rows = 5,
  columns,
  cellClassName = "px-5 py-3.5",
  borderColor = "var(--input-border)",
}) =>
  Array.from({ length: rows }).map((_, rowIndex) => (
    <tr key={rowIndex} aria-hidden="true" style={{ borderTop: `1px solid ${borderColor}` }}>
      {columns.map((column, columnIndex) => (
        <td key={columnIndex} className={cellClassName}>
          <CellSkeleton {...column} />
        </td>
      ))}
    </tr>
  ));

export default SkeletonBlock;
