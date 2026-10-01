package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class WordBankRefreshTest {

    private val a = WordBankWord(id = 1, label = "A")
    private val b = WordBankWord(id = 2, label = "B")

    @Test
    fun unsuccessfulResponseIsAServerError() {
        assertEquals(WordBankRefresh.ServerError, classifyWordBankResponse(false, listOf(a), emptyList()))
    }

    @Test
    fun emptyOrMissingBodyLeavesTheCurrentListAlone() {
        assertEquals(WordBankRefresh.Unchanged, classifyWordBankResponse(true, null, listOf(a)))
        assertEquals(WordBankRefresh.Unchanged, classifyWordBankResponse(true, emptyList(), listOf(a)))
    }

    @Test
    fun identicalListIsUnchanged() {
        assertEquals(WordBankRefresh.Unchanged, classifyWordBankResponse(true, listOf(a, b), listOf(a, b)))
    }

    @Test
    fun differentListIsAnUpdate() {
        assertEquals(
            WordBankRefresh.Updated(listOf(a, b)),
            classifyWordBankResponse(true, listOf(a, b), listOf(a)),
        )
    }
}
