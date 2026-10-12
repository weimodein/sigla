-- Reject a byte-identical hand track stored twice (letter clips).
--
-- WHY
-- ---
-- 004_gesture_samples_dedupe_guard.sql stops a duplicate `sequence` from being stored
-- (after 18.8% of rows turned out to be duplicates, which leaked across cross-validation
-- folds and inflated the reported accuracy). Letter rows now store only `hand_track`
-- and leave `sequence` NULL, and that index skips NULL sequences, so letter clips had no
-- protection: a re-uploaded clip, an interrupted forced import that is re-run, or one
-- clip filed under two letters would all be stored silently and train the letters model
-- on copies.
--
-- WHAT THIS DOES
-- --------------
-- A UNIQUE index over md5(hand_track::text), only for rows that have a track. hand_track
-- is jsonb, so its text form is already normalised (key order, whitespace): a re-formatted
-- copy of the same track hashes the same. Words rows (no track) are not touched.
-- As with 004, the numbers must match exactly: this catches the same stored track twice,
-- and a clip re-extracted on the same machine (extraction is deterministic there). It is a
-- duplicate detector, not a guarantee.
--
-- ORDER OF OPERATIONS
-- -------------------
-- Needs no existing duplicates, or CREATE UNIQUE INDEX fails and rolls back. Checked on
-- 2026-10-12: the 1037 letter rows have none. Run AFTER 011_gesture_samples_hand_track.sql.
-- An insert that collides fails for that one clip (the upload batch reports it and
-- carries on), instead of silently degrading the next training run.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gesture_samples_hand_track_hash
  ON gesture_samples (md5(hand_track::text))
  WHERE hand_track IS NOT NULL;

COMMIT;
