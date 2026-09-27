-- Schema cleanup: drop columns that carry no information, align nullability with
-- how the columns are actually used, and fix the index set.
--
-- WHY
-- ---
-- A review of the live database on 2026-09-27 (3,244 samples, 130 words) found:
--
--   * gesture_samples.sample_count  -- 1 on every row. Left over from image
--     batches; a sample is now one clip.
--   * gesture_samples.is_validated  -- true on every row, and every insert path
--     writes true. The dataset filters `status='pending' AND is_validated` were
--     therefore just `status='pending'`.
--   * words.is_locked               -- only ever written as false, never read.
--   * words.total_samples           -- stale on 91 of 130 words. The API has
--     derived this from gesture_samples at read time since the counters drifted
--     (see getSampleCounts in wordController), so the column is dead weight that
--     only misleads anyone reading the table directly.
--
--   * idx_users_email duplicates administrators_email_key (both on email).
--   * idx_words_sign_type has 0 scans; sign_type only admits 'FSL'.
--   * idx_words_is_locked indexes a column being dropped.
--   * activity_logs had only its primary key while the logs page filters and
--     orders by created_at (9,256 sequential scans, ~330 rows/day).
--
--   * words.normalized_label had no database guard. Duplicates were refused only
--     by a findOne in the controller, which two concurrent requests can both
--     pass -- and two words with one label train as two classes of the same
--     name. The index mirrors the controller's rule exactly: same
--     normalized_label and sign_type among pending/approved words. Rejected words
--     stay exempt, so a rejected label can still be resubmitted.
--
--   * upload_jobs.started_by had no FK (003 skipped it to keep history when an
--     admin is deleted). Admins are soft-deleted (status='deleted'), so the row
--     is never removed and ON DELETE never fires; SET NULL is there only in case
--     that ever changes, matching every other *_by column.
--
--   * Columns with a DEFAULT that no code path ever sets to NULL are made NOT
--     NULL, so a NULL can no longer appear and every reader stops having to
--     guard against it. email_verifications.administrator_id is included: its FK
--     is ON DELETE CASCADE, so NULL could never be meaningful, and all three
--     create paths set it.
--
--   * gesture_samples.file_url was NOT NULL here but allowNull in the model; the
--     model's comment ("optional when landmark data is sent directly") is the
--     intended contract, so the database follows it. Existing values untouched.
--
-- NOT CHANGED, deliberately:
--   * The nullable *_by / administrator_id columns with ON DELETE SET NULL. SET
--     NULL requires a nullable column; making them NOT NULL would turn any hard
--     delete of an admin into an FK error. dbdiagram's "nullable but operator >"
--     warnings are about the diagram notation, not the schema.
--   * revoked_auth_tokens.administrator_id gets no FK. It is a disposable
--     blacklist, and a CASCADE would un-revoke a deleted admin's logged-out
--     tokens.
--   * Mixed `timestamp` / `timestamptz` columns. Converting needs a decision on
--     how the existing values were written; separate migration.
--
-- ORDER OF OPERATIONS -- IMPORTANT, AND THE REVERSE OF 002/003/009
-- ----------------------------------------------------------------
-- Deploy the matching backend code FIRST, to EVERY backend sharing this
-- database (local and Hostinger), THEN run this file.
--
-- The old code declares the dropped columns, and Sequelize names every declared
-- column in its INSERTs and SELECTs, so running this under the old code breaks
-- uploads with Postgres 42703. The new code runs fine against the old schema:
-- it simply stops mentioning those columns and they take their defaults.
--
-- Do not run while an upload batch is in progress: the guard below refuses if
-- any upload job has heartbeated in the last 10 minutes.
--
-- Everything is in one transaction; any failure leaves the schema untouched.

BEGIN;

-- Fail fast instead of queueing behind live traffic and blocking it.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM upload_jobs
     WHERE status = 'processing'
       AND last_progress_at > now() - interval '10 minutes'
  ) THEN
    RAISE EXCEPTION 'An upload batch is in progress; run 010 once it finishes.';
  END IF;
END
$$;

-- ── Dead columns ──────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_words_is_locked;

ALTER TABLE gesture_samples DROP COLUMN IF EXISTS sample_count;
ALTER TABLE gesture_samples DROP COLUMN IF EXISTS is_validated;
ALTER TABLE words           DROP COLUMN IF EXISTS is_locked;
ALTER TABLE words           DROP COLUMN IF EXISTS total_samples;

-- ── Redundant / unused indexes ────────────────────────────────────────────
DROP INDEX IF EXISTS idx_users_email;       -- administrators_email_key covers it
DROP INDEX IF EXISTS idx_words_sign_type;   -- 0 scans; single-valued column

-- ── Missing indexes and guards ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
  ON activity_logs (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_words_normalized_label_live
  ON words (normalized_label, sign_type)
  WHERE status IN ('pending', 'approved');

ALTER TABLE upload_jobs DROP CONSTRAINT IF EXISTS upload_jobs_started_by_fkey;
ALTER TABLE upload_jobs
  ADD CONSTRAINT upload_jobs_started_by_fkey
  FOREIGN KEY (started_by) REFERENCES administrators(id) ON DELETE SET NULL;

-- ── Nullability matches usage ─────────────────────────────────────────────
-- Every column below had zero NULLs on 2026-09-27 and a DEFAULT that applies
-- whenever the application omits it; SET NOT NULL fails (and rolls back) if a
-- NULL has appeared since.
ALTER TABLE email_verifications
  ALTER COLUMN administrator_id    SET NOT NULL,
  ALTER COLUMN is_used             SET NOT NULL,
  ALTER COLUMN attempt_count       SET NOT NULL,
  ALTER COLUMN session_invalidated SET NOT NULL,
  ALTER COLUMN created_at          SET NOT NULL;

ALTER TABLE gesture_samples
  ALTER COLUMN status     SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN file_url   DROP NOT NULL;

ALTER TABLE words
  ALTER COLUMN is_active             SET NOT NULL,
  ALTER COLUMN approved_sample_count SET NOT NULL,
  ALTER COLUMN created_at            SET NOT NULL,
  ALTER COLUMN updated_at            SET NOT NULL;

ALTER TABLE administrators
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE model_versions
  ALTER COLUMN created_at SET NOT NULL;

COMMIT;
