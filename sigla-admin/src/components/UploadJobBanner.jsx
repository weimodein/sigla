import { useLocation, useNavigate } from "react-router-dom";
import { Minus, Loader2 } from "lucide-react";
import { useUploadJobs } from "../context/UploadJobsContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import AppModal from "./AppModal.jsx";
import Button from "./Button.jsx";
import ClipResultsList from "./ClipResultsList.jsx";

const C = {
  primary: "#1e3a8a",
  border: "#e5e7eb",
  muted: "#9ca3af",
  red: "#ef4444",
};

// Fixed to the viewport, not the page flow — appearing or disappearing here
// must never shift page content up or down. Bottom-right, clear of the toast
// stack (top-right, z-index 2100) and under modals (1100) and the mobile
// drawer (1040+), but above the mobile topbar (900).
const STACK_Z_INDEX = 1000;

// Rendered by Layout, fixed above every page, so a running upload batch stays
// visible no matter where the admin navigates to. On /dataset every admin's
// batches show, matching the per-word lock the server enforces (and that page
// re-adopts every 5s so a SECOND admin's upload appears without navigating
// away and back). Elsewhere only the current admin's own batches show —
// another admin's upload on a word this admin has never opened would
// otherwise be a mystery card with no context.
const UploadJobBanner = () => {
  const { uploadJobs, uploadResults, setUploadResults, minimized, setMinimized } = useUploadJobs();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const onDatasetPage = location.pathname === "/dataset";
  const visibleJobs = Object.values(uploadJobs).filter(
    (job) => onDatasetPage || job.started_by === user?.id,
  );

  const resultWord = uploadResults ? uploadResults.word || null : null;
  const formatTime = (value) => (value ? new Date(value).toLocaleString() : "—");
  const details = uploadResults
    ? [
        ["Word", resultWord?.label || `#${uploadResults.word_id}`],
        ["Category", resultWord?.category || "—"],
        ["Signer ID", uploadResults.session_id || "—"],
        ["Started", formatTime(uploadResults.created_at)],
        ["Finished", formatTime(uploadResults.finished_at)],
      ]
    : [];

  // Summed across every visible job, for the collapsed pill's one-line count.
  const totalProcessed = visibleJobs.reduce((sum, j) => sum + (j.processed_count || 0), 0);
  const totalCount = visibleJobs.reduce((sum, j) => sum + (j.total_count || 0), 0);

  return (
    <>
      {visibleJobs.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: "24px",
            bottom: "24px",
            zIndex: STACK_Z_INDEX,
            width: "min(360px, calc(100vw - 32px))",
            maxHeight: "calc(100vh - 48px)",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {minimized ? (
            <button
              type="button"
              onClick={() => setMinimized(false)}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                alignSelf: "flex-end",
                background: "white", border: `1px solid ${C.border}`, borderRadius: "999px",
                padding: "8px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                cursor: "pointer", fontSize: "var(--type-meta)", fontWeight: 600, color: "#1e40af",
              }}
            >
              <Loader2 size={14} className="animate-spin" />
              {visibleJobs.length === 1
                ? <>Extracting · {totalProcessed}/{totalCount} clips</>
                : <>{visibleJobs.length} uploads · {totalProcessed}/{totalCount} clips</>}
            </button>
          ) : (
            visibleJobs.map((job, i) => (
              <div
                key={job.id}
                className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3"
                style={{
                  cursor: onDatasetPage ? "default" : "pointer",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                }}
                onClick={onDatasetPage ? undefined : () => navigate("/dataset")}
              >
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent shrink-0" style={{ marginTop: "2px" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="text-sm font-semibold text-blue-800">
                    Extracting landmarks
                    {job.word?.label
                      ? <> for <span className="font-mono">{job.word.label}</span></>
                      : <> for word #{job.word_id}</>}
                    {" — "}
                    {job.processed_count} of {job.total_count} clip
                    {job.total_count === 1 ? "" : "s"}…
                  </p>
                  <div style={{ background: "#bfdbfe", borderRadius: "4px", height: "6px", margin: "6px 0 4px" }}>
                    <div
                      style={{
                        height: "6px", borderRadius: "4px", background: C.primary,
                        width: `${job.total_count ? Math.round((job.processed_count / job.total_count) * 100) : 0}%`,
                        transition: "width var(--dur-slow) var(--ease-standard)",
                      }}
                    />
                  </div>
                  <p className="small-text text-blue-500">
                    {onDatasetPage
                      ? "This may take a few minutes. You can safely navigate away — this page will update automatically."
                      : "This may take a few minutes. Click to view it in Manage Words."}
                  </p>
                </div>
                {/* Minimize applies to the whole stack, so it only needs to
                    appear once — on the first card. */}
                {i === 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMinimized(true); }}
                    aria-label="Minimize upload progress"
                    title="Minimize"
                    style={{
                      background: "none", border: "none", padding: "2px", cursor: "pointer",
                      color: "#1e40af", opacity: 0.6, flexShrink: 0,
                    }}
                  >
                    <Minus size={16} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Per-clip breakdown, opened by the poller when a batch this admin
          started finishes — even if they were on a different page. */}
      {uploadResults && (
        <AppModal
          title={`Upload Results — ${resultWord?.label || `#${uploadResults.word_id}`}`}
          onClose={() => setUploadResults(null)}
          onEnter={() => setUploadResults(null)}
          footer={<Button onClick={() => setUploadResults(null)}>Close</Button>}
        >
          {/* Which word and signer the clips were filed under — a batch stored
              under the wrong signer ID skews signer-held-out evaluation, so the
              uploader should be able to confirm it here. */}
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", fontSize: "var(--type-meta)", background: "#f9fafb", border: `1px solid ${C.border}`, borderRadius: "8px", padding: "10px 12px", marginBottom: "12px" }}>
            {details.map(([term, value]) => (
              <div key={term} style={{ display: "contents" }}>
                <dt style={{ color: C.muted, fontWeight: 600 }}>{term}</dt>
                <dd style={{
                  margin: 0, color: "#374151", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textTransform: term === "Category" ? "capitalize" : "none",
                  fontFamily: term === "Signer ID" ? "monospace" : "inherit",
                }} title={String(value)}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p style={{ fontSize: "var(--type-body)", color: "#374151", marginBottom: "12px" }}>
            <strong>{uploadResults.success_count}</strong> clip(s) stored
            {uploadResults.fail_count > 0 && (
              <>, <strong>{uploadResults.fail_count}</strong> failed/skipped</>
            )}
            .
          </p>
          {uploadResults.status === "failed" && (
            <p style={{ fontSize: "var(--type-meta)", color: C.red, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", padding: "8px 10px", marginBottom: "12px" }}>
              The batch stopped early: {uploadResults.error || "Unknown error"}
            </p>
          )}
          {uploadResults.results?.length > 0 && (
            <ClipResultsList results={uploadResults.results} />
          )}
        </AppModal>
      )}
    </>
  );
};

export default UploadJobBanner;
