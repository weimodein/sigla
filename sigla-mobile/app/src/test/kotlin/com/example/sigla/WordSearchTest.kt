package com.example.sigla

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WordSearchTest {

    private val word = WordBankWord(
        id = 1,
        label = "Good Morning",
        description = "Greeting used before noon",
        filipino_translation = "Magandang umaga",
    )

    @Test
    fun emptyQueryMatchesEverything() {
        assertTrue(word.matchesSearch(""))
    }

    @Test
    fun matchesLabelTranslationAndDescriptionIgnoringCase() {
        assertTrue(word.matchesSearch("good"))
        assertTrue(word.matchesSearch("MAGANDANG"))
        assertTrue(word.matchesSearch("noon"))
    }

    @Test
    fun missingOptionalFieldsDoNotMatchOrCrash() {
        val bare = WordBankWord(id = 2, label = "Hello")
        assertFalse(bare.matchesSearch("umaga"))
        assertTrue(bare.matchesSearch("hell"))
    }

    @Test
    fun blankButNotEmptyQueryIsASearchForSpace() {
        // Matches the old inline filters, which tested isEmpty(), not isBlank().
        assertTrue(word.matchesSearch(" "))
        assertFalse(WordBankWord(id = 3, label = "Hi").matchesSearch(" "))
    }
}
