-- Lets the server tell a slow upload batch from a dead one.
--
-- WHY
-- ---
-- 003_upload_jobs.sql recorded a KNOWN LIMITATION: the extraction loop is an
-- in-process async IIFE, so a backend restart mid-batch strands the row at
-- 'processing' forever. On 2026-09-26 that happened for real — a nodemon restart
-- during job 334 left it at 6/10. Nothing ever marked it finished, so:
--   - every admin's banner sat at 6/10 indefinitely,
--   - the word's upload lock (a 'processing' row for that word) refused every
--     new batch with 409,
--   - the per-clip results were lost, because they were only written at the end.
--
-- The clips still in memory cannot be recovered, but the row can be failed
-- promptly and clearly. last_progress_at is a heartbeat: the loop stamps it
-- before and after every clip, and a 'processing' row whose heartbeat is older
-- than the per-clip ML timeout plus a margin cannot belong to a live loop.
--
-- A heartbeat rather than "fail every processing job on startup": the local
-- backend and the deployed one may share this database, and a local restart
-- must not kill a batch that is running fine on the other server.
--
-- NOTE: apply this migration BEFORE restarting the backend onto the matching
-- code. Sequelize selects every declared column, so the model would fail against
-- a table without it (Postgres 42703, surfacing as a generic 500).

ALTER TABLE upload_jobs
  ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;

-- Existing rows: finished ones never need it, and any row still 'processing'
-- from before this migration is judged from when it started.
UPDATE upload_jobs
  SET last_progress_at = COALESCE(finished_at, created_at)
  WHERE last_progress_at IS NULL;

ALTER TABLE upload_jobs
  ALTER COLUMN last_progress_at SET DEFAULT now();

COMMENT ON COLUMN upload_jobs.last_progress_at IS
  'Heartbeat from the extraction loop, stamped before and after every clip. A '
  '''processing'' row whose heartbeat is older than the per-clip ML timeout plus '
  'a margin has no live loop behind it and is failed by failStaleUploadJobs.';
