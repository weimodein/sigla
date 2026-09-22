-- A version number now names a PAIR of models, not a single one.
--
-- One training run produces both the words model and the alphabet model, so
-- that the two cannot drift apart — with separate runs it was possible to end
-- up with a words model from today and a letters model from last week, and
-- nothing said they disagreed. Both rows carry the same version_number and
-- differ by model_kind.
--
-- The old UNIQUE(version_number) forbids exactly that, so it widens to
-- UNIQUE(version_number, model_kind): "1.7.0" may exist once as words and once
-- as letters, and a second words 1.7.0 is still refused.
--
-- Safe on existing data: every current row is model_kind 'words' (migration
-- 005's default), so no two rows can collide under the new key either.

ALTER TABLE model_versions
  DROP CONSTRAINT IF EXISTS model_versions_version_number_key;

-- Named explicitly rather than left to Postgres so a re-run finds it.
ALTER TABLE model_versions
  DROP CONSTRAINT IF EXISTS model_versions_version_kind_key;

ALTER TABLE model_versions
  ADD CONSTRAINT model_versions_version_kind_key
  UNIQUE (version_number, model_kind);
