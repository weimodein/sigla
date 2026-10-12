-- One-hand letter track per clip (letter words only). NULL for words and for
-- letter clips imported before this column existed.
-- docs-internal/specs/2026-10-11-letters-accuracy-design.md
ALTER TABLE gesture_samples ADD COLUMN IF NOT EXISTS hand_track JSONB;
