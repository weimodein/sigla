import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { getAllModels, getModelStatus } from "../api/modelApi.js";
import { invalidate } from "../utils/apiCache.js";
import { useToast } from "./ToastContext.jsx";
import { useAuth } from "./AuthContext.jsx";

// App-wide tracking for a model training run, mirroring UploadJobsContext.jsx —
// same reason: this used to live inside ManageModel's component state, which
// React unmounts on every route change (App.jsx renders <Layout> per-<Route>,
// not as a parent layout route). Navigating to Dashboard and back mid-run used
// to hide the banner, re-enable the Train button, and mean a run that finished
// while the admin was elsewhere never reported its outcome — the poller only
// existed while ManageModel was mounted. Hoisting it here, mounted once in
// App.jsx alongside UploadJobsProvider, fixes both.
const TrainingJobContext = createContext(null);

// A row stranded at "training" (server restarted mid-run, so nothing will ever
// mark it trained/failed) would otherwise poll for the whole session and keep
// the Train button disabled forever. Give up and say so — set well past the
// words model's own timeout: training can exceed 20 minutes per the ML
// service's unlimited client timeout (see runTraining in modelController.js),
// and the words half runs before the alphabet half in the same run, so the
// pair together can run long. 90 minutes leaves headroom without leaving a
// truly stuck run tying up the banner all day.
const POLL_TIMEOUT_MS = 90 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

export const TrainingJobsProvider = ({ children }) => {
  const { success, error: errorToast } = useToast();
  const { isLoggedIn } = useAuth();
  const location = useLocation();

  // The in-flight run, or null. Unlike uploads (one per word, so a Map), only
  // one training run can exist at a time — trainModel refuses a second one
  // while any ModelVersion row is status: "training" — so a single value is
  // enough here.
  const [job, setJob] = useState(null);
  // Result of the run just finished, shown even if the admin was on another
  // page when it landed. { kind: "success" | "failure", ... }
  const [trainingResult, setTrainingResult] = useState(null);
  // Bumped whenever a run finishes, so ManageModel can refetch without this
  // provider needing to know what that page fetches — same pattern as
  // UploadJobsContext's finishedCount.
  const [finishedCount, setFinishedCount] = useState(0);
  const [minimized, setMinimized] = useState(false);

  const pollRef = useRef(null);
  const jobRef = useRef(null);
  useEffect(() => { jobRef.current = job; }, [job]);
  // Only the admin who started a run gets its toast/results modal — everyone
  // sees the banner (so the Train button reads as disabled with a reason), but
  // the outcome belongs to whoever triggered it. Read through a ref so the
  // interval's closure (created once per tracked job) sees the current admin
  // rather than whoever was signed in when the interval was set up.
  const currentUserIdRef = useRef(null);
  const { user } = useAuth();
  useEffect(() => { currentUserIdRef.current = user?.id; }, [user?.id]);

  // Re-adopt a run already in flight on the server. Mirrors ManageModel's old
  // fetchData logic: prefer the words row to track (the long half), and find
  // its alphabet companion by version number so a failure there is still
  // reported even when this client did not start the run.
  const adoptActiveRun = useCallback(async (stillRelevant) => {
    try {
      const { models } = await getAllModels({ force: true });
      if (!stillRelevant()) return;
      const list = models || [];
      const training = list.filter((m) => m.status === "training");
      const active = training.find((m) => m.model_kind !== "letters") || training[0];

      setJob((current) => {
        if (!active) {
          // Only clear when the server no longer reports ANY training run —
          // leave a job set moments ago by startJob alone, since the list
          // fetched here may predate it.
          return current && !list.some((m) => m.status === "training") ? null : current;
        }
        // If the words model has finished and only the alphabet is still
        // training, track the original words row as the run anchor and the
        // alphabet row as its companion. Otherwise a reload would label the
        // alphabet's progress as the words model's progress.
        const inFlight = active.model_kind === "letters"
          ? list.find((m) => m.version_number === active.version_number && m.model_kind !== "letters") || active
          : active;
        const companion = list.find(
          (m) =>
            m.version_number === inFlight.version_number &&
            m.model_kind === "letters" &&
            m.id !== inFlight.id,
        );
        // Preserve startedAt AND startedByMe from a job we already know about,
        // so re-adoption (which fires on every route change, including right
        // after this same client's own startJob call) does not reset the
        // elapsed timer or silently strip this admin's ownership of the
        // outcome — losing startedByMe here would mean this admin's own run
        // never showed its results modal because trained_by had not landed in
        // the list yet on the tick that re-adopted it.
        const sameRun = current?.wordsId === inFlight.id;
        return {
          wordsId: inFlight.id,
          lettersId: companion?.id ?? null,
          versionNumber: inFlight.version_number,
          trainedById: inFlight.trained_by ?? null,
          trainedByName: inFlight.trainer?.username || null,
          wordsStatus: inFlight.status,
          lettersStatus: companion?.status ?? null,
          wordsProgress: inFlight.status === "trained" ? 100 : current?.wordsProgress ?? 0,
          wordsStage: current?.wordsStage ?? "starting",
          wordsStageLabel: current?.wordsStageLabel ?? "Waiting for training updates",
          wordsEpoch: current?.wordsEpoch ?? null,
          wordsTotalEpochs: current?.wordsTotalEpochs ?? null,
          wordsBatch: current?.wordsBatch ?? null,
          wordsTotalBatches: current?.wordsTotalBatches ?? null,
          lettersProgress: companion?.status === "trained" ? 100 : current?.lettersProgress ?? 0,
          lettersStage: current?.lettersStage ?? "starting",
          lettersStageLabel: current?.lettersStageLabel ?? "Waiting for training updates",
          lettersEpoch: current?.lettersEpoch ?? null,
          lettersTotalEpochs: current?.lettersTotalEpochs ?? null,
          lettersBatch: current?.lettersBatch ?? null,
          lettersTotalBatches: current?.lettersTotalBatches ?? null,
          startedAt: sameRun
            ? current.startedAt
            : Number.isFinite(Date.parse(inFlight.created_at))
              ? Date.parse(inFlight.created_at)
              : Date.now(),
          startedByMe: sameRun ? current.startedByMe : false,
        };
      });
    } catch {
      // Non-blocking: the app still works without the banner.
    }
  }, []);

  // Re-adopt on login and on every route change — same trigger as uploads, so
  // the banner appears on whichever page the admin lands on, including a hard
  // reload mid-run.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => { await adoptActiveRun(() => !cancelled); })();
    return () => { cancelled = true; };
  }, [isLoggedIn, location.pathname, adoptActiveRun]);

  useEffect(() => {
    if (!isLoggedIn) {
      queueMicrotask(() => {
        setJob(null);
        setTrainingResult(null);
      });
    }
  }, [isLoggedIn]);

  // Poll the tracked run every 5 seconds until both halves settle.
  useEffect(() => {
    if (!job) return;

    const startedAt = job.startedAt || Date.now();

    const poll = async () => {
      const tracked = jobRef.current;
      if (!tracked) return;

      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(pollRef.current);
        setJob(null);
        errorToast(
          "Stopped tracking this training run — it has not reported back. Reload to check its status.",
        );
        invalidate("models:");
        setFinishedCount((n) => n + 1);
        return;
      }

      try {
        const [wordsResponse, lettersResponse] = await Promise.all([
          getModelStatus(tracked.wordsId),
          tracked.lettersId
            ? getModelStatus(tracked.lettersId).catch(() => null)
            : Promise.resolve(null),
        ]);
        const { model, progress: wordsProgress } = wordsResponse;
        const letters = lettersResponse?.model ?? null;
        const lettersProgress = lettersResponse?.progress ?? null;

        const updateProgress = (current, prefix, row, progress) => {
          const status = row?.status ?? current[`${prefix}Status`];
          const value = Number(progress?.progress);
          return {
            [`${prefix}Status`]: status,
            [`${prefix}Progress`]: status === "trained"
              ? 100
              : Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : current[`${prefix}Progress`] ?? 0,
            [`${prefix}Stage`]: progress?.stage ?? current[`${prefix}Stage`],
            [`${prefix}StageLabel`]: progress?.stage_label ?? current[`${prefix}StageLabel`],
            [`${prefix}Epoch`]: progress?.current_epoch ?? null,
            [`${prefix}TotalEpochs`]: progress?.total_epochs ?? null,
            [`${prefix}Batch`]: progress?.current_batch ?? null,
            [`${prefix}TotalBatches`]: progress?.total_batches ?? null,
          };
        };
        setJob((current) => current && current.wordsId === tracked.wordsId
          ? {
              ...current,
              ...updateProgress(current, "words", model, wordsProgress),
              ...(letters
                ? updateProgress(current, "letters", letters, lettersProgress)
                : {}),
            }
          : current);

        const isSettled = (status) => status === "trained" || status === "failed";
        const pairSettled = isSettled(model.status) &&
          (!tracked.lettersId || (letters && isSettled(letters.status)));
        if (!pairSettled) return;

        clearInterval(pollRef.current);
        setJob(null);

        const isMine =
          currentUserIdRef.current != null &&
          (model.trained_by === currentUserIdRef.current || tracked.startedByMe);
        const wordsFailed = model.status === "failed";
        const lettersFailed = letters?.status === "failed";

        if (wordsFailed || lettersFailed) {
          const errors = [
            wordsFailed ? `Words model: ${model.training_error || "Unknown error"}` : null,
            lettersFailed ? `Alphabet model: ${letters.training_error || "Unknown error"}` : null,
          ].filter(Boolean);
          const error = errors.join("\n");
          if (isMine) {
            errorToast(`Training failed: ${errors[0] || "Unknown error"}`);
            setTrainingResult({ kind: "failure", versionNumber: model.version_number, error });
          }
        } else if (isMine) {
          const lettersNote = letters
            ? { kind: "letters-ok", accuracy: letters.accuracy, totalClasses: letters.total_classes }
            : { kind: "no-letters" };
          success(`Model ${model.version_number} trained successfully`);
          setTrainingResult({
            kind: "success",
            versionNumber: model.version_number,
            accuracy: model.accuracy ?? null,
            totalClasses: model.total_classes ?? null,
            letters: lettersNote,
          });
        }

        invalidate("models:");
        setFinishedCount((n) => n + 1);
      } catch (err) {
        const status = err.response?.status;
        if (status === 404 || status === 403 || status === 401) {
          clearInterval(pollRef.current);
          setJob(null);
          invalidate("models:");
          setFinishedCount((n) => n + 1);
        }
      }
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    void poll();
    return () => clearInterval(pollRef.current);
    // Keyed on the tracked run's identity, not its contents — depending on the
    // whole job object would tear down and restart the interval on every
    // status tick.
  }, [job?.wordsId, job?.lettersId, success, errorToast]);

  // Called by ManageModel right after the 202 response from trainModel.
  const startJob = useCallback((model, lettersModel) => {
    setJob({
      wordsId: model.id,
      lettersId: lettersModel?.id ?? null,
      versionNumber: model.version_number,
      trainedById: currentUserIdRef.current ?? null,
      trainedByName: null,
      wordsStatus: "training",
      lettersStatus: "training",
      wordsProgress: 0,
      wordsStage: "starting",
      wordsStageLabel: "Waiting for training updates",
      wordsEpoch: null,
      wordsTotalEpochs: null,
      wordsBatch: null,
      wordsTotalBatches: null,
      lettersProgress: 0,
      lettersStage: "starting",
      lettersStageLabel: "Waiting for training updates",
      lettersEpoch: null,
      lettersTotalEpochs: null,
      lettersBatch: null,
      lettersTotalBatches: null,
      startedAt: Number.isFinite(Date.parse(model.created_at)) ? Date.parse(model.created_at) : Date.now(),
      // This client made the call, so it owns the outcome even before the
      // first poll tick reads trained_by back from the server.
      startedByMe: true,
    });
    setMinimized(false);
  }, []);

  const value = {
    job,
    trainingResult,
    setTrainingResult,
    startJob,
    finishedCount,
    minimized,
    setMinimized,
  };

  return (
    <TrainingJobContext.Provider value={value}>
      {children}
    </TrainingJobContext.Provider>
  );
};

export const useTrainingJob = () => {
  const context = useContext(TrainingJobContext);
  if (!context) {
    throw new Error("useTrainingJob must be used within a TrainingJobsProvider");
  }
  return context;
};
