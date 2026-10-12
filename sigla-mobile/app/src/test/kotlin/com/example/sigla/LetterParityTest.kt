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

    @Test
    fun segmenterMatchesPython() {
        val s = LetterSegmenter()
        val got = ArrayList<Triple<Long, Long, Double>>()
        for ((t, hand) in LETTER_SEGMENT_TRACK) {
            s.onFrame(t, hand).segment?.let { seg ->
                var sum = 0.0
                for (f in seg.frames) for (v in f) sum += v
                got.add(Triple(seg.startMs, seg.endMs, sum))
            }
        }
        assertEquals(LETTER_SEGMENT_EXPECTED.size, got.size)
        for (i in got.indices) {
            assertEquals(LETTER_SEGMENT_EXPECTED[i].first, got[i].first)
            assertEquals(LETTER_SEGMENT_EXPECTED[i].second, got[i].second)
            assertEquals(LETTER_SEGMENT_EXPECTED[i].third, got[i].third, 1e-2)
        }
    }
}
