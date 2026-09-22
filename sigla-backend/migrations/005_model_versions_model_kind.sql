-- Which vocabulary a model version covers, so two can be deployed at once.
--
-- The FSL day signs are the first letter of the word plus a circular motion, so
-- a letter and its day share a handshape and differ only in movement. Measured
-- on the imported letters, M vs MONDAY separates at 1.06 — below every
-- day-to-day pair and just under TOMORROW vs TEN, which already confuses the
-- deployed model. Rather than train one class list to carry both, the words and
-- the alphabet become separate models and the app chooses between them.
--
-- 'words' is the default because every existing row is a words model, and a
-- NULL here would otherwise have to be guessed at by every reader. Nothing has
-- to backfill: the DEFAULT applies to existing rows on ADD COLUMN.
--
-- reconcileActiveWords treats the deployed version's class list as the whole
-- active word set and deactivates everything outside it. With two kinds
-- deployed that becomes a fight — deploying letters would hide every word and
-- deploying words would hide every letter — so it now reconciles only within
-- the deploying model's kind, and this column is what tells it which slice it
-- owns.

ALTER TABLE model_versions
  ADD COLUMN IF NOT EXISTS model_kind TEXT NOT NULL DEFAULT 'words';

-- Only one version of each kind may be deployed at a time. The application
-- enforces this when deploying, but the constraint keeps a half-finished deploy
-- or a manual UPDATE from leaving two live models of one kind, which would make
-- "the deployed model" ambiguous for the app fetching it.
CREATE UNIQUE INDEX IF NOT EXISTS model_versions_one_deployed_per_kind
  ON model_versions (model_kind)
  WHERE status = 'deployed';
