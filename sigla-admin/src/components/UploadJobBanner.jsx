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

// Fixed footprint, the same on every page. Each card is exactly one height —
// every line is single-line and truncates instead of wrapping — so the stack
// never resizes as the admin navigates, as a word's label gets longer, or as
// the "click to view" link appears/disappears between pages. Width matches
// CARD_WIDTH on desktop; on phones the card is pinned to even side margins
// instead of being sized off the viewport, which used to leave 8px on one
// side and 24px on the other.
const CARD_WIDTH = 360;
const CARD_HEIGHT = 92;
const MAX_VISIBLE_CARDS = 3;

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

  // Capped so the stack's height is bounded regardless of how many batches are
  // running — otherwise five admins uploading at once would grow the stack
  // past the viewport, which is exactly the "different dimensions" problem
  // this pass is fixing, just triggered by job count instead of page.
  const shownJobs = visibleJobs.slice(0, MAX_VISIBLE_CARDS);
  const hiddenCount = visibleJobs.length - shownJobs.length;

  return (
    <>
      {visibleJobs.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: "16px",
            bottom: "16px",
            left: "16px",
            zIndex: STACK_Z_INDEX,
            // Pinned to the same left/right offset as the container above, then
            // pulled to the container's right edge and clamped to CARD_WIDTH —
            // this is what keeps the margins even on a phone instead of the
            // card being sized directly off 100vw.
            marginLeft: "auto",
            width: `min(${CARD_WIDTH}px, 100%)`,
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
                height: "40px", padding: "0 14px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                cursor: "pointer", fontSize: "var(--type-meta)", fontWeight: 600, color: "#1e40af",
                overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "100%",
              }}
            >
              <Loader2 size={14} className="animate-spin" style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {visibleJobs.length === 1
                  ? <>Extracting · {totalProcessed}/{totalCount} clips</>
                  : <>{visibleJobs.length} uploads · {totalProcessed}/{totalCount} clips</>}
              </span>
            </button>
          ) : (
            <>
              {shownJobs.map((job, i) => {
                const wordLabel = job.word?.label || `word #${job.word_id}`;
                // Whose upload this is, shown only for someone else's — an
                // admin's own card stays "Extracting · WORD" as before, since
                // asking "who started this?" only makes sense for a card they
                // didn't start themselves.
                const isMine = job.started_by === user?.id;
                const starterName = job.starter?.username || "another admin";
                return (
                  <div
                    key={job.id}
                    className="bg-blue-50 border border-blue-200 rounded-xl"
                    style={{
                      cursor: onDatasetPage ? "default" : "pointer",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                      height: `${CARD_HEIGHT}px`,
                      padding: "12px 14px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      boxSizing: "border-box",
                    }}
                    onClick={onDatasetPage ? undefined : () => navigate("/dataset")}
                  >
                    {/* Row 1: spinner, truncated word label, count, minimize. Every
                        field here is single-line and fixed-height so this row's
                        height never depends on the label's length. */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent shrink-0" />
                      <p
                        className="text-sm font-semibold text-blue-800"
                        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}
                        title={
                          isMine
                            ? `Extracting landmarks for ${wordLabel}`
                            : `Uploaded by ${starterName} — extracting landmarks for ${wordLabel}`
                        }
                      >
                        {isMine
                          ? <>Extracting · <span className="font-mono">{wordLabel}</span></>
                          : <>{starterName} · <span className="font-mono">{wordLabel}</span></>}
                      </p>
                      <span className="text-sm font-semibold text-blue-800" style={{ flexShrink: 0 }}>
                        {job.processed_count}/{job.total_count}
                      </span>
                      {/* Minimize applies to the whole stack, so it only needs to
                          appear once — on the first card. A fixed-width empty
                          slot on the others keeps every row the same width. */}
                      <div style={{ width: "20px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                        {i === 0 && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setMinimized(true); }}
                            aria-label="Minimize upload progress"
                            title="Minimize"
                            style={{
                              background: "none", border: "none", padding: "2px", cursor: "pointer",
                              color: "#1e40af", opacity: 0.6, display: "flex",
                            }}
                          >
                            <Minus size={16} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Row 2: progress bar. */}
                    <div style={{ background: "#bfdbfe", borderRadius: "4px", height: "6px" }}>
                      <div
                        style={{
                          height: "6px", borderRadius: "4px", background: C.primary,
                          width: `${job.total_count ? Math.round((job.processed_count / job.total_count) * 100) : 0}%`,
                          transition: "width var(--dur-slow) var(--ease-standard)",
                        }}
                      />
                    </div>

                    {/* Row 3: one hint, same wording on every page — the only
                        thing that changes between pages is the "View" link,
                        never the height of this row. */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <p className="small-text text-blue-500" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        You can navigate away — this keeps running.
                      </p>
                      {!onDatasetPage && (
                        <span className="small-text" style={{ color: "#1e40af", fontWeight: 600, flexShrink: 0 }}>
                          View →
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={onDatasetPage ? undefined : () => navigate("/dataset")}
                  style={{
                    height: "32px", background: "white", border: `1px solid ${C.border}`, borderRadius: "8px",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.1)", fontSize: "var(--type-meta)", fontWeight: 600,
                    color: "#374151", cursor: onDatasetPage ? "default" : "pointer",
                  }}
                >
                  +{hiddenCount} more upload{hiddenCount === 1 ? "" : "s"}
                </button>
              )}
            </>
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
