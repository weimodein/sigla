package com.example.sigla

// Pure decisions for the word screens and "Try it yourself" (spec §5–6).

const val VOCAB_WORDS = "words"
const val VOCAB_LETTERS = "letters"

private val SINGLE_CAPITAL_LETTER = Regex("^[A-Z]$")

/**
 * Which model a word belongs to. The backend's `vocabulary` wins when it is one
 * of the two known values; otherwise (word banks cached before the field was
 * sent) the rule migration 007 used to backfill it: a single capital A–Z is a
 * letter, everything else is a word.
 */
internal fun effectiveVocabulary(word: WordBankWord): String =
    when (word.vocabulary?.lowercase()) {
        VOCAB_WORDS -> VOCAB_WORDS
        VOCAB_LETTERS -> VOCAB_LETTERS
        else -> if (SINGLE_CAPITAL_LETTER.matches(word.label)) VOCAB_LETTERS else VOCAB_WORDS
    }

/**
 * The vocabulary "Try it yourself" should switch the translator to, or null to
 * leave it as it opens (Words). Letters only when a letters model is loaded.
 */
internal fun translatorStartVocabulary(requested: String?, hasLetters: Boolean): PredictionService.Vocabulary? =
    if (requested == VOCAB_LETTERS && hasLetters) PredictionService.Vocabulary.LETTERS else null

enum class VocabularyFilter { ALL, WORDS, LETTERS }

data class GridCategory(val name: String, val wordCount: Int)

/**
 * Word Bank's category cards for the selected filter pill. ALL keeps every
 * category in the given order, with total counts, including empty ones (as the
 * grid always has). WORDS / LETTERS count only words of that vocabulary and drop
 * categories left with none. Categories match words case-insensitively.
 */
internal fun gridCategories(
    words: List<WordBankWord>,
    categoryNames: List<String>,
    filter: VocabularyFilter,
): List<GridCategory> {
    val wanted = when (filter) {
        VocabularyFilter.ALL -> null
        VocabularyFilter.WORDS -> VOCAB_WORDS
        VocabularyFilter.LETTERS -> VOCAB_LETTERS
    }
    val counts = HashMap<String, Int>()
    for (w in words) {
        if (wanted != null && effectiveVocabulary(w) != wanted) continue
        val key = w.category.lowercase()
        counts[key] = (counts[key] ?: 0) + 1
    }
    val all = categoryNames.map { GridCategory(it, counts[it.lowercase()] ?: 0) }
    return if (wanted == null) all else all.filter { it.wordCount > 0 }
}
