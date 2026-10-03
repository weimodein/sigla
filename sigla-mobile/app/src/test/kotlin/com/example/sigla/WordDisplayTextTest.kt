package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class WordDisplayTextTest {

    private fun word(label: String, vocabulary: String? = null) =
        WordBankWord(id = 1, label = label, vocabulary = vocabulary)

    // ── wordDisplayLabel ──────────────────────────────────────────────────────

    @Test
    fun allCapsWordsBecomeTitleCase() {
        assertEquals("Good Afternoon", wordDisplayLabel(word("GOOD AFTERNOON", "words")))
        assertEquals("How Are You", wordDisplayLabel(word("how are you", "words")))
    }

    @Test
    fun lettersKeepTheirStoredCase() {
        // NG is one FSL letter written with two characters; "Ng" would misname it.
        assertEquals("NG", wordDisplayLabel(word("NG", "letters")))
        assertEquals("G", wordDisplayLabel(word("G")))
    }

    // ── labelDisplay (History and the translator, which know only the label) ──

    @Test
    fun recognisedWordsBecomeTitleCase() {
        assertEquals("Blue", labelDisplay("BLUE"))
        assertEquals("No", labelDisplay("NO"))
        assertEquals("Good Afternoon", labelDisplay("GOOD AFTERNOON"))
    }

    @Test
    fun singleLettersStayCapital() {
        assertEquals("N", labelDisplay("N"))
        assertEquals("B", labelDisplay("B"))
    }

    // ── filipinoDisplay ───────────────────────────────────────────────────────

    @Test
    fun allCapsFilipinoBecomesTitleCase() {
        assertEquals("Magandang Tanghali", filipinoDisplay("MAGANDANG TANGHALI"))
        assertEquals("Okay Lang Ako", filipinoDisplay("OKAY LANG AKO"))
    }

    @Test
    fun anyCasingMatchesTheWordStyle() {
        assertEquals("Magandang Umaga", filipinoDisplay("Magandang umaga"))
        assertEquals("Salamat Po", filipinoDisplay("salamat po"))
    }

    @Test
    fun surroundingSpacesAreTrimmed() {
        assertEquals("Kamusta", filipinoDisplay("  KAMUSTA "))
    }

    @Test
    fun emptyOrNumericTextIsUnchanged() {
        assertEquals("", filipinoDisplay(""))
        assertEquals("123", filipinoDisplay("123"))
    }
}
