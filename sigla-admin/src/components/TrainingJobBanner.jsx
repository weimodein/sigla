import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Minus, Loader2 } from "lucide-react";
import { useTrainingJob } from "../context/TrainingJobContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import AppModal from "./AppModal.jsx";
import Button from "./Button.jsx";

const C = {
  primary: "#1e3a8a",
  border: "#e5e7eb",
  muted: "#9ca3af",
  red: "#ef4444",
  green: "#16a34a",
};

// Same footprint as UploadJobBanner's cards (see CARD_WIDTH/CARD_HEIGHT there)
// so the two stack cleanly in one dock without the admin seeing two different
// card sizes fighting for the same corner.
const CARD_WIDTH = 360;
const CARD_HEIGHT = 92;
const STACK_Z_INDEX = 1000;

const fmt = (val) => (val != null ? `${(val * 100).toFixed(1)}%` : "—");

// "12m elapsed" / "48s elapsed" — training has no per-clip progress to report
// (see fetch_approved_samples in train.py, which reads the dataset once at the
// start of each half), so elapsed time is what stands in for the upload
// banner's "12/20 clips" count.
const useElapsed = (startedAt) => {
  // Seeded lazily inside useState's initializer rather than called directly
  // in the render body — Date.now() is impure, and calling it as a plain
  // argument expression re-runs on every render pass (including ones React
  // discards), which the lazy-init form avoids by only calling it once.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!startedAt) return "—";
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (secs < 60) return `${secs}s elapsed`;
  const mins = Math.floor(secs / 60);
  return `${mins}m elapsed`;
};

// Rendered by Layout, next to UploadJobBanner — fixed above every page so a
// running training run stays visible no matter where the admin navigates.
// Training is app-wide (trainModel refuses a second run while any version is
// status: "training"), so there is never more than one card here, unlike the
// upload stack which can hold one per word.
const TrainingJobBanner = () => {
  const { job, trainingResult, setTrainingResult, minimized, setMinimized } = useTrainingJob();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onModelPage = location.pathname === "/model";
  const elapsed = useElapsed(job?.startedAt);
  const progressStages = {
    starting: "Starting",
    loading_data: "Loading data",
    preparing_data: "Preparing data",
    selecting_model: "Selecting",
    evaluating_model: "Evaluating",
    preparing_final_model: "Preparing final model",
    training_final_model: "Final fit",
    converting_model: "Converting",
    uploading_model: "Uploading",
    completed: "Complete",
  };

  // Step count mirrors the upload card's "12/20" slot — 1/2 while the words
  // model trains, 2/2 once it has and the alphabet is running.
  const wordsDone = job?.wordsStatus === "trained" || job?.wordsStatus === "failed";
  const step = wordsDone ? 2 : 1;
  const stepLabel = wordsDone ? "Alphabet model" : "Words model";
  const activeProgress = wordsDone ? job?.lettersProgress ?? 0 : job?.wordsProgress ?? 0;
  const activeStageLabel = wordsDone ? job?.lettersStageLabel : job?.wordsStageLabel;
  const activeStage = wordsDone ? job?.lettersStage : job?.wordsStage;
  const activeEpoch = wordsDone ? job?.lettersEpoch : job?.wordsEpoch;
  const activeTotalEpochs = wordsDone ? job?.lettersTotalEpochs : job?.wordsTotalEpochs;
  const activeBatch = wordsDone ? job?.lettersBatch : job?.wordsBatch;
  const activeTotalBatches = wordsDone ? job?.lettersTotalBatches : job?.wordsTotalBatches;
  const stepName = wordsDone ? "Alphabet" : "Words";
  const compactStage = progressStages[activeStage] || activeStageLabel || "Waiting";
  const activeDetail = activeEpoch && activeTotalEpochs
    ? `${compactStage} · E${activeEpoch}/${activeTotalEpochs}${activeBatch && activeTotalBatches ? ` · B${activeBatch}/${activeTotalBatches}` : ""}`
    : compactStage;
  const fullActiveDetail = [
    activeStageLabel || compactStage,
    activeEpoch && activeTotalEpochs ? `epoch ${activeEpoch}/${activeTotalEpochs}` : null,
    activeBatch && activeTotalBatches ? `batch ${activeBatch}/${activeTotalBatches}` : null,
  ].filter(Boolean).join(" · ");
  // Whose run this is, shown only for someone else's — matches
  // UploadJobBanner's isMine/starterName treatment. Compared by id, not by
  // whether trainedById is merely present: a route change re-adopts and
  // stamps trainedById on THIS admin's own run too (see adoptActiveRun in
  // TrainingJobContext.jsx), so presence alone would mislabel every run as
  // "someone else's" the moment the admin navigated once.
  const isMine = job?.trainedById == null || job.trainedById === user?.id;
  const starterName = job?.trainedByName || "another admin";

  return (
    <>
      {job && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: "16px",
            // Anchored to the same bottom-right corner as the upload stack and
            // always the topmost of the two — UploadJobBanner reads this card's
            // height and shifts its own `bottom` up to make room, so a training
            // run and a live upload (another admin's, most likely — the
            // /models/train guard stops THIS admin from starting both at once)
            // can both be visible without overlapping.
            bottom: "16px",
            left: "16px",
            zIndex: STACK_Z_INDEX,
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
                {isMine ? "Training" : starterName} <span className="font-mono">{job.versionNumber}</span> · {step}/2
              </span>
            </button>
          ) : (
            <div
              className="bg-blue-50 border border-blue-200 rounded-xl"
              style={{
                cursor: onModelPage ? "default" : "pointer",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                height: `${CARD_HEIGHT}px`,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxSizing: "border-box",
              }}
              onClick={onModelPage ? undefined : () => navigate("/model")}
            >
              {/* Row 1: spinner, version, step count, minimize — matches the
                  upload card's row exactly so the two read as one system. */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent shrink-0" />
                <p
                  className="text-sm font-semibold text-blue-800"
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}
                  title={
                    isMine
                      ? `Training version ${job.versionNumber}`
                      : `Training started by ${starterName} — version ${job.versionNumber}`
                  }
                >
                  {isMine
                    ? <>Training · <span className="font-mono">{job.versionNumber}</span></>
                    : <>{starterName} · <span className="font-mono">{job.versionNumber}</span></>}
                </p>
                <span className="text-sm font-semibold text-blue-800" style={{ flexShrink: 0 }}>
                  {step}/2
                </span>
                <div style={{ width: "20px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMinimized(true); }}
                    aria-label="Minimize training progress"
                    title="Minimize"
                    style={{
                      background: "none", border: "none", padding: "2px", cursor: "pointer",
                      color: "#1e40af", opacity: 0.6, display: "flex",
                    }}
                  >
                    <Minus size={16} />
                  </button>
                </div>
              </div>

              {/* Each segment follows the ML trainer's reported progress for
                  that model. The alphabet segment remains empty until its run
                  actually starts. */}
              <div style={{ display: "flex", gap: "4px" }}>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(job.wordsProgress ?? 0)}
                  aria-label={`Words model ${Math.round(job.wordsProgress ?? 0)}%`}
                  style={{ flex: 1, background: "#bfdbfe", borderRadius: "4px", height: "6px", overflow: "hidden" }}
                >
                  <div style={{ height: "6px", borderRadius: "4px", background: C.primary, width: `${job.wordsProgress ?? 0}%`, transition: "width 400ms ease" }} />
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(job.lettersProgress ?? 0)}
                  aria-label={`Alphabet model ${Math.round(job.lettersProgress ?? 0)}%`}
                  style={{ flex: 1, background: "#bfdbfe", borderRadius: "4px", height: "6px", overflow: "hidden" }}
                >
                  <div style={{ height: "6px", borderRadius: "4px", background: C.primary, width: `${job.lettersProgress ?? 0}%`, transition: "width 400ms ease" }} />
                </div>
              </div>

              {/* Row 3: which half is running plus elapsed time, and a View
                  link off /model — same slot the upload card uses. */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <p
                  className="small-text text-blue-500"
                  title={`${stepName} · ${fullActiveDetail} · ${Math.round(activeProgress)}% · ${elapsed}`}
                  style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {stepName} · {activeDetail} · {elapsed}
                </p>
                <span className="small-text" style={{ color: C.primary, fontWeight: 700, flexShrink: 0 }}>
                  {Math.round(activeProgress)}%
                </span>
                {!onModelPage && (
                  <span className="small-text" style={{ color: "#1e40af", fontWeight: 600, flexShrink: 0 }}>
                    View →
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Outcome modal — opened by the poller when a run this admin started
          finishes, even if they were on a different page. Success and failure
          share one modal (unlike the old inline toast-only failure path) so a
          multi-line signer-coverage error is actually readable instead of
          being crammed into one toast line. */}
      {trainingResult && (
        <AppModal
          title={trainingResult.kind === "success" ? "Training Results" : "Training Failed"}
          onClose={() => setTrainingResult(null)}
          onEnter={() => setTrainingResult(null)}
          footer={<Button onClick={() => setTrainingResult(null)}>Close</Button>}
        >
          {trainingResult.kind === "success" ? (
            <div className="space-y-3 text-sm">
              <p className="text-gray-700 leading-relaxed">
                Version <strong className="font-mono">{trainingResult.versionNumber}</strong> finished training.
                {trainingResult.letters?.kind === "letters-ok" && (
                  <> Alphabet model: {fmt(trainingResult.letters.accuracy)} over {trainingResult.letters.totalClasses ?? "?"} letters.</>
                )}
                {trainingResult.letters?.kind === "letters-failed" && (
                  <> The alphabet model FAILED ({trainingResult.letters.error}); this version cannot be deployed.</>
                )}
                {trainingResult.letters?.kind === "no-letters" && (
                  <> No alphabet model was trained — there are no letters in the word list yet.</>
                )}
              </p>
              {(trainingResult.accuracy != null || trainingResult.totalClasses != null) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {trainingResult.accuracy != null && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Accuracy</p>
                      <p className="font-bold text-lg text-blue-900">{fmt(trainingResult.accuracy)}</p>
                    </div>
                  )}
                  {trainingResult.totalClasses != null && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Gesture classes</p>
                      <p className="font-bold text-lg text-blue-900">{trainingResult.totalClasses}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-gray-700 leading-relaxed">
                Version <strong className="font-mono">{trainingResult.versionNumber}</strong> failed to train.
              </p>
              {/* The signer-diversity gate (see validate_training_coverage in
                  preprocessor.py) raises one message with "\n  - WORD: ..."
                  per offending word. The toast this modal replaces rendered
                  that as one unbroken line — this is the exact message that
                  motivated the modal. Word labels are always uppercase, which
                  is what the split below keys on to find each new entry. */}
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  color: C.red,
                  fontSize: "var(--type-meta)",
                  lineHeight: 1.5,
                }}
              >
                {trainingResult.error.split(/\s+-\s+(?=[A-Z0-9])/).map((line, i) => (
                  <p key={i} style={{ margin: i === 0 ? "0 0 6px" : "0" }}>
                    {i === 0 ? line : `• ${line}`}
                  </p>
                ))}
              </div>
            </div>
          )}
        </AppModal>
      )}
    </>
  );
};

export default TrainingJobBanner;
