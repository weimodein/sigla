package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** LetterHand / LetterSegmenter must decide exactly as sigla-ml letters.py. */
class LetterParityTest {

    @Test
    fun selectMatchesPython() {
        for ((n, c) in LETTER_SELECT_CASES.withIndex()) {
            val got = LetterHand.select(c.hands, c.width, c.height)
            if (c.expected == null) { assertNull("case $n", got); continue }
            for (i in c.expected.indices) assertEquals("case $n [$i]", c.expected[i], got!![i], 1e-5f)
        }
    }
}
