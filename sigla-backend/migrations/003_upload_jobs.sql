-- Tracks a batch of dataset clips through landmark extraction.
--
-- WHY
-- ---
-- uploadVideos used to extract landmarks inside the HTTP request: a sequential
-- loop over up to 50 clips, each with a 60-second ML timeout. Two failures came
-- out of that.
--
-- 1. Closing the modal orphaned the batch. The React modal unmounts on close, so
--    the per-clip OK/Skipped/Failed breakdown was written to a dead component and
--    discarded. Nothing aborted the request, so the clips still landed minutes
--    later with no indication any work had been in flight — the admin only found
--    out because the sample count had moved. Reopening the modal showed a blank
--    slate with the upload button live again, so a second concurrent batch could
--    be fired at the same word.
--
-- 2. Large batches could not finish in production. 50 clips x 60s is up to 50
--    minutes in one request, and Render's proxy closes it at ~30 seconds. This is
--    the same wall trainModel hit, which is why that flow returns 202 and does its
--    work in the background (see modelController.trainModel).
--
-- This table is the durable record that makes the same treatment possible here:
-- the request creates a row and returns 202, a background loop advances
-- processed_count clip by clip, and the client polls the row. Because the row —
-- not component state — is the source of truth, the batch survives closing the
-- modal, navigating away, and a full page reload.
--
-- status: processing -> completed | failed.
--   'failed' means the batch itself broke (ML service down, DB error). Individual
--   clips that skip or fail do NOT fail the job — they are recorded per-clip in
--   `results` and the job still reaches 'completed'. A failed job may still carry
--   partial `results`, and those clips really were stored.
--
-- `results` holds the array extractAndStoreSample already returns, one entry per
-- clip: { file, status: "ok"|"skipped"|"failed", type, sample_id?, reason?, error? }.
--
-- KNOWN LIMITATION: the background loop is an in-process async IIFE, not a real
-- queue (same as trainModel). A backend restart mid-run strands the row at
-- 'processing' forever, so the client also enforces a 30-minute give-up guard.
--
-- NOTE: apply this migration AND restart the backend before uploading. Sequelize
-- emits every declared column in its SELECTs, so a model declared against a
-- missing table fails with Postgres 42P01 and surfaces as a generic 500.

CREATE TABLE IF NOT EXISTS upload_jobs (
  id              SERIAL PRIMARY KEY,
  word_id         INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  -- No FK: administrators may be deleted, and losing the job history with them
  -- would be worse than an orphaned id. Matches model_versions.trained_by.
  started_by      INTEGER,
  -- Signer grouping for cross-validation, carried through to gesture_samples.
  -- See 002_gesture_samples_session_id.sql.
  session_id      TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'processing',
  total_count     INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  fail_count      INTEGER NOT NULL DEFAULT 0,
  results         JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);

-- Two hot reads: "is a batch live for this word?" (the concurrency guard and the
-- client's re-adoption on mount). Partial, so the index stays small as finished
-- jobs accumulate.
CREATE INDEX IF NOT EXISTS idx_upload_jobs_processing
  ON upload_jobs (word_id)
  WHERE status = 'processing';

COMMENT ON TABLE upload_jobs IS
  'One row per batch of dataset clips submitted for landmark extraction. Created '
  'before the request returns 202; advanced by a background loop. The row, not '
  'client state, is the source of truth for progress.';

COMMENT ON COLUMN upload_jobs.status IS
  'processing | completed | failed. ''failed'' = the batch broke (ML down, DB '
  'error); individual skipped/failed clips are recorded in results and still '
  'reach ''completed''. A failed job may carry partial results.';

COMMENT ON COLUMN upload_jobs.results IS
  'Per-clip outcomes from extractAndStoreSample: '
  '{ file, status: ok|skipped|failed, type, sample_id?, reason?, error? }.';
