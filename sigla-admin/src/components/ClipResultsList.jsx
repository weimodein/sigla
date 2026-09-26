const C = {
  border: "#e5e7eb",
  muted: "#9ca3af",
  green: "#22c55e",
  red: "#ef4444",
};

// Per-clip outcomes from a finished upload batch. Shared by the upload modal
// (previews results the admin can still see before closing it) and the
// app-wide upload results modal (what shows if the batch finished after the
// admin navigated away).
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

export default ClipResultsList;
