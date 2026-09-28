package com.example.sigla

import java.util.Calendar
import java.util.TimeZone

// Pure logic behind the Home screen (spec §6–7). No Android types, so every rule
// here is unit-tested in HomeContentTest.

data class Greeting(val title: String, val subtitle: String?)

private fun timeOfDayLine(hour: Int): String = when {
    hour < 12 -> "Good morning"
    hour < 18 -> "Good afternoon"
    else -> "Good evening"
}

/** "Hi Maria!" over "Good morning", or just "Good morning" when there is no name. */
internal fun homeGreeting(hour: Int, name: String?): Greeting {
    val timeLine = timeOfDayLine(hour)
    val cleanName = name?.trim()?.takeIf { it.isNotEmpty() }
    return if (cleanName == null) Greeting(timeLine, null) else Greeting("Hi $cleanName!", timeLine)
}

/**
 * The Home stat banner. SigLa bridges signers and non-signers in the moment,
 * not a learning app, so these three describe capability and lifetime use
 * rather than a streak or a "words learned" score: words available (the word
 * bank's current size, what SigLa can recognize right now), translated today
 * (successful translations since local midnight, unaffected by deleting
 * history — see TranslationHistoryManager.getTranslatedToday), and favorites. Each
 * value comes from its own on-device source (word bank cache, history
 * manager, favorites manager) at a different point in HomeActivity.refresh(),
 * so there is no single function here to compute it — this struct is just
 * the three numbers the banner binds.
 */
data class HomeStats(val wordsAvailable: Int, val totalTranslated: Int, val favorites: Int)

/** True when both instants fall on the same calendar date in [timeZone]. */
internal fun isSameLocalDay(aMillis: Long, bMillis: Long, timeZone: TimeZone): Boolean {
    val a = Calendar.getInstance(timeZone).apply { timeInMillis = aMillis }
    val b = Calendar.getInstance(timeZone).apply { timeInMillis = bMillis }
    return a.get(Calendar.YEAR) == b.get(Calendar.YEAR) &&
        a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
}

/** Identifies the calendar date of [millis] in [timeZone], e.g. "2026-271". */
internal fun localDayKey(millis: Long, timeZone: TimeZone): String {
    val c = Calendar.getInstance(timeZone).apply { timeInMillis = millis }
    return "${c.get(Calendar.YEAR)}-${c.get(Calendar.DAY_OF_YEAR)}"
}

data class HomeCategory(val name: String, val wordCount: Int)

/**
 * Categories for the Home grid: those with at least one word, most words first,
 * ties by name, at most [limit]. Counts come from the word bank itself (case-
 * insensitive, like WordBankActivity), not from CategoryItem.word_count, so they
 * match what the word lists actually show. When the category list is not cached,
 * the categories named on the words are used instead.
 */
internal fun homeCategories(
    words: List<WordBankWord>,
    categoryNames: List<String>,
    limit: Int = 4,
): List<HomeCategory> {
    val counts = HashMap<String, Int>()
    val firstSpelling = LinkedHashMap<String, String>()
    for (w in words) {
        val key = w.category.lowercase()
        counts[key] = (counts[key] ?: 0) + 1
        if (key !in firstSpelling) firstSpelling[key] = w.category
    }
    val names = if (categoryNames.isNotEmpty()) {
        categoryNames.distinctBy { it.lowercase() }
    } else {
        firstSpelling.values.toList()
    }
    return names
        .map { HomeCategory(it, counts[it.lowercase()] ?: 0) }
        .filter { it.wordCount > 0 }
        .sortedWith(compareByDescending<HomeCategory> { it.wordCount }.thenBy { it.name.lowercase() })
        .take(limit)
}

/** History is stored newest-first, so the first entries are the most recent. */
internal fun recentEntries(entries: List<TranslationEntry>, limit: Int = 3): List<TranslationEntry> =
    entries.take(limit)
