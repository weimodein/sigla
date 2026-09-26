import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { getUploadJob, getActiveUploadJobs } from "../api/wordApi.js";
import { invalidate } from "../utils/apiCache.js";
import { useToast } from "./ToastContext.jsx";
import { useAuth } from "./AuthContext.jsx";

// App-wide tracking for clip-extraction batches, so the progress banner and
// the results modal survive navigating away from Manage Words.
//
// This used to live inside ManageWord's component state, which React unmounts
// on every route change (App.jsx renders <Layout> per-<Route>, not as a parent
// layout route — see Layout.jsx). Closing the tab on the banner mid-upload was
// fine, since re-adoption picked the job back up on return, but navigating to
// Dashboard and back also unmounted-and-remounted the page in between, so:
//   - the banner disappeared while away, even though the batch kept running
//   - a batch that finished while the admin was elsewhere never showed its
//     results modal, because nothing was polling it
// Hoisting the same tracking here, mounted once in App.jsx alongside the other
// providers, fixes both: the poll interval and the job map now survive every
// navigation, and only a hard reload or logout clears them.
const UploadJobsContext = createContext(null);

// A row stranded at "processing" (backend restarted mid-run, so nothing will
// ever finish it) would otherwise poll for the whole session and keep the
// upload button disabled forever. Give up after 30 minutes and say so.
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

export const UploadJobsProvider = ({ children }) => {
  const { success, error: errorToast } = useToast();
  const { user, isLoggedIn } = useAuth();
  const location = useLocation();

  // Every in-flight clip-extraction batch, keyed by word_id.
  //
  // A MAP rather than one job: the upload lock is per word, so two admins
  // uploading to different words both proceed. Tracking a single job meant the
  // second batch ran with no progress shown — and an upload that looks like
  // nothing is happening invites a re-upload while the clips are really being
  // stored.
  const [uploadJobs, setUploadJobs] = useState({});
  // Per-clip breakdown of a finished batch, shown even if the admin was on
  // another page when it finished — losing this silently is the bug this
  // provider fixes.
  const [uploadResults, setUploadResults] = useState(null);
  // Bumped whenever any tracked batch finishes (this admin's or another's), so
  // a page can refetch its own data (word list, sample counts, signer counts)
  // without the provider needing to know what that page fetches.
  const [finishedCount, setFinishedCount] = useState(0);

  const uploadPollRef = useRef(null);
  // Mirrors uploadJobs for the poll interval to read. The interval is created
  // once per SET of tracked ids, so its closure would otherwise hold whichever
  // counts existed at creation and overwrite fresher ones on every tick.
  const uploadJobsRef = useRef({});
  useEffect(() => { uploadJobsRef.current = uploadJobs; }, [uploadJobs]);
  // Every admin's live batches are tracked so their banners show and the Clips
  // button stays locked, but only the admin who STARTED a batch gets its toast
  // and results modal. Read through a ref for the same stale-closure reason.
  const currentUserIdRef = useRef(user?.id);
  useEffect(() => { currentUserIdRef.current = user?.id; }, [user?.id]);

  // Re-adopt every clip-extraction batch still running on the server, on login
  // and on every route change. Cheap (one query for all live jobs) and it is
  // what lets the banner reappear on whichever page the admin lands on next,
  // including a hard reload.
  //
  // One request for all live jobs, rather than one per visible word. The old
  // per-word scan cost a request per row AND only saw the current page, so a
  // batch on another page — or a second admin's batch on a word not shown
  // there — was invisible.
  //
  // Wrapped in an async IIFE rather than calling setState directly in the
  // effect body — the state write below only happens after its own await.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const { jobs } = await getActiveUploadJobs();
        if (cancelled || !jobs?.length) return;
        setUploadJobs((current) => {
          const next = { ...current };
          for (const job of jobs) {
            // Leave a job set moments ago by the modal alone — the fetch that
            // started before it may only now be landing, and it carries the
            // fresher count.
            if (!next[job.word_id]) next[job.word_id] = job;
          }
          return next;
        });
      } catch {
        // Non-blocking: the app still works without the banners.
      }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, location.pathname]);

  // Logging out must not leave a stale job map for the next admin on this
  // browser to inherit, or keep polling for someone who is no longer signed in.
  useEffect(() => {
    if (!isLoggedIn) {
      queueMicrotask(() => {
        setUploadJobs({});
        setUploadResults(null);
      });
    }
  }, [isLoggedIn]);

  // Poll every tracked batch every 5 seconds.
  //
  // One interval for ALL tracked jobs rather than one per job: a separate
  // effect per job would re-subscribe every time any single job's count
  // advanced, since the map identity changes on each poll.
  useEffect(() => {
    const ids = Object.keys(uploadJobs);
    if (ids.length === 0) return;

    const startedAt = Date.now();

    uploadPollRef.current = setInterval(async () => {
      const tracked = Object.values(uploadJobsRef.current);
      if (tracked.length === 0) return;

      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(uploadPollRef.current);
        setUploadJobs({});
        errorToast(
          "Stopped tracking these uploads — they have not reported back. Reload to check their status.",
        );
        invalidate("words:");
        setFinishedCount((n) => n + 1);
        return;
      }

      let anyFinished = false;
      for (const trackedJob of tracked) {
        try {
          const { job } = await getUploadJob(trackedJob.id);
          // Another admin's batch finishing still clears its banner and
          // invalidates the cache, but its outcome is theirs to review. A job
          // with no started_by predates that column and belongs to nobody.
          const isMine =
            job.started_by != null && job.started_by === currentUserIdRef.current;
          if (job.status === "completed") {
            anyFinished = true;
            setUploadJobs((current) => {
              const next = { ...current };
              delete next[job.word_id];
              return next;
            });
            if (isMine) {
              success(
                `${job.success_count} clip(s) stored${job.fail_count ? `, ${job.fail_count} failed/skipped` : ""}`,
              );
              setUploadResults(job);
            }
          } else if (job.status === "failed") {
            anyFinished = true;
            setUploadJobs((current) => {
              const next = { ...current };
              delete next[job.word_id];
              return next;
            });
            if (isMine) {
              errorToast(`Upload failed: ${job.error || "Unknown error"}`);
              // Partial results still matter — those clips really were stored.
              if (job.results?.length) setUploadResults(job);
            }
          } else {
            // Still processing — advance this banner's count.
            setUploadJobs((current) => ({ ...current, [job.word_id]: job }));
          }
        } catch (err) {
          // A missing or forbidden job will never resolve — drop just that one
          // rather than hammering the endpoint or abandoning the others.
          const status = err.response?.status;
          if (status === 404 || status === 403 || status === 401) {
            anyFinished = true;
            setUploadJobs((current) => {
              const next = { ...current };
              delete next[trackedJob.word_id];
              return next;
            });
          }
        }
      }

      if (anyFinished) {
        // The sample counts changed on the SERVER, so no mutation call ran on
        // this client to clear them. Without this, a cached fetch would re-serve
        // the pre-upload numbers.
        invalidate("words:");
        setFinishedCount((n) => n + 1);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(uploadPollRef.current);
    // Keyed on WHICH jobs are tracked, not on their contents: depending on the
    // map itself would tear down and restart the interval on every count update.
  }, [Object.keys(uploadJobs).sort().join(","), success, errorToast]);

  // Called by the upload modal right after the 202 response. Seeds `word` from
  // the row that was clicked, since the response itself carries no word — the
  // banner would otherwise read "word #id" until the first poll replaces it.
  const startJob = useCallback((job, word) => {
    setUploadJobs((current) => ({
      ...current,
      [job.word_id]: { ...job, word: job.word || word },
    }));
  }, []);

  const value = {
    uploadJobs,
    uploadResults,
    setUploadResults,
    startJob,
    finishedCount,
  };

  return (
    <UploadJobsContext.Provider value={value}>
      {children}
    </UploadJobsContext.Provider>
  );
};

export const useUploadJobs = () => {
  const context = useContext(UploadJobsContext);
  if (!context) {
    throw new Error("useUploadJobs must be used within an UploadJobsProvider");
  }
  return context;
};
