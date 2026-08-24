-- Stop duplicate and cross-labelled gesture samples from being stored.
--
-- WHY
-- ---
-- 335 of 1786 rows (18.8%) held sequences that already existed elsewhere in the
-- table, and 25 sequences were stored under TWO different words:
--
--   * 21 sequences under both KNOW and DON'T UNDERSTAND. The KNOW copies (ids
--     248-268) were DON'T UNDERSTAND footage; checked against the FSL-105 source
--     clips with the production extractor, they sit on the DON'T UNDERSTAND
--     centroid 20-1 while KNOW's other batch sits on the KNOW centroid 21-0.
--     This one fault was ~49% of all cross-validation errors and pinned KNOW's
--     recall at 50.3% -- identically across four architectures, because no model
--     can separate classes that share input vectors.
--   * 4 sequences under both FOUR and SEVEN, matching the 8 SEVEN->FOUR errors.
--
-- The rest were a re-upload of 15 whole classes under new ids (originals
-- submitted_by=NULL, copies submitted_by=1). Those did not corrupt labels, but
-- identical rows landed on both sides of every cross-validation fold, so the
-- reported 97.52% was scored partly on rows the model had trained on.
--
-- This supersedes the guess recorded in 002_gesture_samples_session_id.sql, which
-- attributed KNOW's recall to one signer performing the sign differently. The rows
-- are byte-identical duplicates, not stylistic variants. session_id is still worth
-- populating -- grouped CV remains the right way to measure a NEW signer -- but it
-- was never the cause of this.
--
-- WHAT THIS DOES
-- --------------
-- Adds a generated MD5 of the sequence and a UNIQUE index over it, so the database
-- refuses a byte-identical sequence outright -- whether re-uploaded under the same
-- word or filed under a different one. An insert that collides now fails loudly at
-- ingest instead of silently degrading the next training run.
--
-- The column is `json`, not `jsonb`, so Postgres stores the submitted text
-- verbatim -- whitespace and number formatting included. Casting through ::jsonb
-- first normalises that, so a re-serialised copy of the same clip still hashes the
-- same; hashing `sequence::text` directly would let a reformatted duplicate
-- through. MD5 here is a duplicate detector, not a security primitive.
--
-- The float VALUES must still match exactly. This catches a re-upload of the same
-- stored sequence, which is the failure that occurred; it does not catch the same
-- clip re-extracted through MediaPipe, where tiny numeric differences are expected.
--
-- ORDER OF OPERATIONS -- IMPORTANT
-- --------------------------------
-- Run tools/dedupe_samples.py FIRST. The unique index cannot be created while
-- duplicates are still present; CREATE UNIQUE INDEX will fail and roll back.
--
--     venv/Scripts/python.exe tools/dedupe_samples.py --backup bak.json   # dry run
--     venv/Scripts/python.exe tools/dedupe_samples.py --apply --backup bak.json
--     psql "$PG_URI" -f migrations/004_gesture_samples_dedupe_guard.sql
--
-- Then re-run tools/cross_validate.py for an honest baseline. Expect the number to
-- DROP: the old one was inflated by fold leakage.

BEGIN;

-- Stored generated column: Postgres keeps it in step with `sequence` on every
-- write, so there is no application code to forget.
ALTER TABLE gesture_samples
  ADD COLUMN IF NOT EXISTS sequence_hash TEXT
  GENERATED ALWAYS AS (md5(sequence::jsonb::text)) STORED;

COMMENT ON COLUMN gesture_samples.sequence_hash IS
  'MD5 of the canonical jsonb form of `sequence`. Backs the uniqueness guard that '
  'keeps one clip from being stored twice, or under two different words. '
  'Duplicate detection only -- not a security hash.';

-- Rejects a byte-identical sequence anywhere in the table, which covers both
-- failure modes at once: the same clip re-uploaded under its own word, and the
-- same clip filed under a second word.
--
-- Deliberately NOT scoped to (word_id, sequence_hash): that would still have
-- allowed the KNOW/DON'T UNDERSTAND collision, which is the expensive one.
--
-- Rows with a NULL sequence are excluded; nothing can be said about their content.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gesture_samples_sequence_hash
  ON gesture_samples (sequence_hash)
  WHERE sequence IS NOT NULL;

COMMIT;
