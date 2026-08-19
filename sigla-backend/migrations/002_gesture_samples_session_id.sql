-- Records which signer (and sitting) produced each gesture sample.
--
-- WHY
-- ---
-- The dataset has 4 signers, ~5 clips each per word, but nothing in the row says
-- which. `submitted_by` is the ADMIN ACCOUNT that performed the upload (1 for 1664
-- of 1726 samples, NULL for the rest), and `file_url` is a synthetic
-- "video_upload_<ms>" placeholder. Upload timestamps do not help either: they
-- cluster into 8 upload sessions spanning 2026-07-28 to 2026-08-16, which reflects
-- when clips were UPLOADED, not who signed them.
--
-- Consequence: cross-validation shuffles clips at random, so the same signer lands
-- in both the train and test halves of every fold. The model can score by
-- recognising "this is how signer 3 performs HELLO", and the reported accuracy
-- (97.52% +/- 0.86%) therefore overstates what a NEW signer would experience.
-- Grouping folds by signer (StratifiedGroupKFold) is the standard fix, and it needs
-- this column.
--
-- It may also explain the KNOW class's 50.3% recall: at ~5 clips per signer per
-- word, a single signer performing KNOW differently from the other three puts ~25%
-- of that class in contradiction with the rest. That hypothesis is untestable
-- without attribution.
--
-- NULL means "provenance unknown". Treat each NULL as its own group; never merge
-- NULLs into one pseudo-signer, which would assert a grouping that was never
-- observed.
--
-- NOTE: apply this migration AND restart the backend before training. Sequelize
-- emits every declared column in its SELECTs, so a model that declares session_id
-- against a table that lacks it fails with Postgres 42703, which surfaces as a
-- generic 500 from GET /api/ml/dataset.

ALTER TABLE gesture_samples
  ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Grouped cross-validation scans by session. Partial, to keep the index off the
-- NULL backlog.
CREATE INDEX IF NOT EXISTS idx_gesture_samples_session_id
  ON gesture_samples (session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN gesture_samples.session_id IS
  'Groups clips recorded by one signer in one sitting, for StratifiedGroupKFold. '
  'NULL = unknown provenance; treat as its own group, never merge NULLs.';
