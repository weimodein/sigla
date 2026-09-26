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
      const inFlight = training.find((m) => m.model_kind !== "letters") || training[0];

      setJob((current) => {
        if (!inFlight) {
          // Only clear when the server no longer reports ANY training run —
          // leave a job set moments ago by startJob alone, since the list
          // fetched here may predate it.
          return current && !list.some((m) => m.status === "training") ? null : current;
        }
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
          startedAt: sameRun ? current.startedAt : Date.now(),
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

    pollRef.current = setInterval(async () => {
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
        const { model } = await getModelStatus(tracked.wordsId);

        let letters = null;
        if (tracked.lettersId) {
          try {
            letters = (await getModelStatus(tracked.lettersId)).model;
          } catch {
            // Treat an unreadable letters row as still running rather than a
            // failure; the next tick retries, and the poll timeout is the
            // backstop if it never resolves.
            letters = null;
          }
          // The alphabet trains after the words model in the same run, so the
          // words row reaching "trained" does not mean the run is over.
          if (model.status === "trained" && letters && letters.status === "training") {
            setJob((current) => current && current.wordsId === tracked.wordsId
              ? { ...current, wordsStatus: model.status, lettersStatus: letters.status }
              : current);
            return;
          }
        }

        if (model.status === "trained" || model.status === "failed") {
          clearInterval(pollRef.current);
          setJob(null);

          const isMine =
            currentUserIdRef.current != null &&
            (model.trained_by === currentUserIdRef.current || tracked.startedByMe);

          if (model.status === "failed") {
            if (isMine) {
              errorToast(`Training failed: ${model.training_error || "Unknown error"}`);
              setTrainingResult({
                kind: "failure",
                versionNumber: model.version_number,
                error: model.training_error || "Unknown error",
              });
            }
          } else {
            const lettersNote =
              letters?.status === "trained"
                ? { kind: "letters-ok", accuracy: letters.accuracy, totalClasses: letters.total_classes }
                : letters?.status === "failed"
                  ? { kind: "letters-failed", error: letters.training_error || "unknown error" }
                  : !tracked.lettersId
                    ? { kind: "no-letters" }
                    : null;

            if (isMine) {
              success(`Model ${model.version_number} trained successfully`);
              setTrainingResult({
                kind: "success",
                versionNumber: model.version_number,
                accuracy: model.accuracy ?? null,
                totalClasses: model.total_classes ?? null,
                letters: lettersNote,
              });
            }
          }

          invalidate("models:");
          setFinishedCount((n) => n + 1);
        } else {
          setJob((current) => current && current.wordsId === tracked.wordsId
            ? { ...current, wordsStatus: model.status, lettersStatus: letters?.status ?? current.lettersStatus }
            : current);
        }
      } catch (err) {
        const status = err.response?.status;
        if (status === 404 || status === 403 || status === 401) {
          clearInterval(pollRef.current);
          setJob(null);
          invalidate("models:");
          setFinishedCount((n) => n + 1);
        }
      }
    }, POLL_INTERVAL_MS);
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
      startedAt: Date.now(),
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
