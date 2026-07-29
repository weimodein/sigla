-- Records which words each model version was trained on — the same set that
-- version's labels_motion.json names.
--
-- The mobile word bank (GET /api/words/word-bank) is derived from the currently
-- deployed version's list, so deploying or reverting a model changes the visible
-- words automatically. Before this, visibility lived only in Word.is_active,
-- which deploy set to true and nothing ever set back: reverting to an older
-- model left the phone advertising words that model was never trained on.
--
-- NULL means "trained before this column existed". Callers must fall back to
-- Word.is_active rather than treating NULL as an empty set, so pre-existing
-- versions keep behaving exactly as they did.

ALTER TABLE model_versions
  ADD COLUMN IF NOT EXISTS trained_word_ids JSONB;
