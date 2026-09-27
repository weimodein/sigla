package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class HomeContentTest {

    private val manila: TimeZone = TimeZone.getTimeZone("Asia/Manila")

    private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        Calendar.getInstance(manila).apply {
            clear()
            set(year, month - 1, day, hour, minute)
        }.timeInMillis

    private fun entry(ts: Long, word: String = "HELLO") =
        TranslationEntry(word = word, confidence = 90, gestureType = "motion", timestamp = ts)

    private fun word(id: Int, category: String) = WordBankWord(id = id, label = "W$id", category = category)

    // ── Greeting ──────────────────────────────────────────────────────────────

    @Test
    fun timeOfDayBoundaries() {
        assertEquals("Good morning", homeGreeting(0, null).title)
        assertEquals("Good morning", homeGreeting(11, null).title)
        assertEquals("Good afternoon", homeGreeting(12, null).title)
        assertEquals("Good afternoon", homeGreeting(17, null).title)
        assertEquals("Good evening", homeGreeting(18, null).title)
        assertEquals("Good evening", homeGreeting(23, null).title)
    }

    @Test
    fun nameMovesTimeLineToSubtitle() {
        val g = homeGreeting(9, "  Maria ")
        assertEquals("Hi Maria!", g.title)
        assertEquals("Good morning", g.subtitle)
    }

    @Test
    fun noNameMeansNoSubtitle() {
        val g = homeGreeting(20, null)
        assertEquals("Good evening", g.title)
        assertNull(g.subtitle)
    }

    // Review Focus 4.
    @Test
    fun blankNameTreatedAsNoName() {
        val g = homeGreeting(14, "   ")
        assertEquals("Good afternoon", g.title)
        assertNull(g.subtitle)
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    // Review Focus 3.
    @Test
    fun todayCountsByLocalCalendarDate() {
        val now = at(2026, 9, 28, 10, 0)
        val entries = listOf(
            entry(at(2026, 9, 28, 9, 59)),   // today
            entry(at(2026, 9, 28, 0, 5)),    // today, just after midnight
            entry(at(2026, 9, 27, 23, 59)),  // yesterday, within 24h
            entry(at(2025, 9, 28, 10, 0)),   // same date, last year
        )
        val stats = homeStats(entries, favoritesCount = 9, nowMillis = now, timeZone = manila)
        assertEquals(HomeStats(today = 2, saved = 4, favorites = 9), stats)
    }

    @Test
    fun statsForEmptyHistory() {
        assertEquals(HomeStats(0, 0, 0), homeStats(emptyList(), 0, at(2026, 1, 1, 8, 0), manila))
    }

    @Test
    fun sameLocalDayUsesTheGivenTimeZone() {
        val a = at(2026, 9, 28, 23, 30)
        val b = at(2026, 9, 29, 0, 30)
        assertFalse(isSameLocalDay(a, b, manila))
        assertTrue(isSameLocalDay(a, at(2026, 9, 28, 0, 0), manila))
    }

    // ── Categories ────────────────────────────────────────────────────────────

    @Test
    fun categoriesOrderedByCountThenNameAndLimited() {
        val words = listOf(
            word(1, "Greetings"), word(2, "greetings"), word(3, "GREETINGS"),
            word(4, "Family"),
            word(5, "Questions"), word(6, "Questions"),
            word(7, "Days"), word(8, "days"),
        )
        val names = listOf("Family", "Questions", "Greetings", "Days", "Colors")
        val result = homeCategories(words, names, limit = 3)
        assertEquals(
            listOf(HomeCategory("Greetings", 3), HomeCategory("Days", 2), HomeCategory("Questions", 2)),
            result,
        )
    }

    @Test
    fun categoriesWithNoWordsAreExcluded() {
        val result = homeCategories(listOf(word(1, "Family")), listOf("Family", "Colors"))
        assertEquals(listOf(HomeCategory("Family", 1)), result)
    }

    @Test
    fun categoriesFallBackToWordCategoriesWhenNamesMissing() {
        val words = listOf(word(1, "Days"), word(2, "Family"), word(3, "family"))
        assertEquals(
            listOf(HomeCategory("Family", 2), HomeCategory("Days", 1)),
            homeCategories(words, emptyList()),
        )
    }

    // Review Focus 2.
    @Test
    fun homeCategoriesEmptyWhenNoWords() {
        assertTrue(homeCategories(emptyList(), listOf("Family")).isEmpty())
        assertTrue(homeCategories(emptyList(), emptyList()).isEmpty())
    }

    // ── Recent ────────────────────────────────────────────────────────────────

    @Test
    fun recentTakesNewestThree() {
        val all = (5 downTo 1).map { entry(it.toLong(), "W$it") } // newest first, as stored
        assertEquals(listOf("W5", "W4", "W3"), recentEntries(all).map { it.word })
        assertEquals(1, recentEntries(all.take(1)).size)
    }
}
