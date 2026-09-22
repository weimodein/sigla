-- Which model a word belongs to, recorded explicitly rather than inferred.
--
-- The words model and the fingerspelling alphabet are trained separately,
-- because a letter and the day sign built from it differ only in motion — M and
-- MONDAY separate at 1.06, tighter than any day-to-day pair. Until now the split
-- was inferred from the label matching ^[A-Z]$.
--
-- That rule is right for the 26-letter English alphabet and wrong for FSL as it
-- grows. The Filipino alphabet also has Ñ and NG: "NG" is a single letter but
-- two characters, so it would have been trained as an ordinary word sitting
-- right next to the vocabulary it is meant to be separate from. A word whose
-- label is legitimately one character has the mirror problem.
--
-- An explicit column also means an admin can correct a misfiled word instead of
-- having to rename it, and that adding a letter is a deliberate act rather than
-- a side effect of how its label happens to be spelled.
--
-- Backfilled with the rule it replaces, so existing rows keep their current
-- classification exactly: the five imported letters stay letters and everything
-- else stays a word.

ALTER TABLE words
  ADD COLUMN IF NOT EXISTS vocabulary TEXT NOT NULL DEFAULT 'words';

UPDATE words
   SET vocabulary = 'letters'
 WHERE vocabulary = 'words'
   AND label ~ '^[A-Z]$';

-- Reads are "every word of this kind", on a table small enough that this is a
-- convenience rather than a necessity.
CREATE INDEX IF NOT EXISTS idx_words_vocabulary ON words (vocabulary);
