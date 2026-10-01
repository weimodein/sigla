package com.example.sigla

import android.content.Context

/** Outcome of asking the backend for the word bank. */
sealed interface WordBankRefresh {
    /** A non-empty list that differs from what the screen holds; already cached. */
    data class Updated(val words: List<WordBankWord>) : WordBankRefresh
    /** Same list, or an empty body: keep what is on screen. */
    data object Unchanged : WordBankRefresh
    data object ServerError : WordBankRefresh
    data object NetworkError : WordBankRefresh
}

internal fun classifyWordBankResponse(
    successful: Boolean,
    fresh: List<WordBankWord>?,
    current: List<WordBankWord>,
): WordBankRefresh = when {
    !successful -> WordBankRefresh.ServerError
    fresh.isNullOrEmpty() || fresh == current -> WordBankRefresh.Unchanged
    else -> WordBankRefresh.Updated(fresh)
}

/**
 * Fetches the word bank and caches it when it changed. Each screen used to
 * repeat this fetch-compare-cache sequence; what a screen does with each
 * outcome (toasts, spinners, grids) stays with the screen.
 */
suspend fun refreshWordBank(context: Context, current: List<WordBankWord>): WordBankRefresh {
    val result = try {
        val response = ApiClient.get().getWordBank()
        classifyWordBankResponse(response.isSuccessful, response.body()?.words, current)
    } catch (e: Exception) {
        return WordBankRefresh.NetworkError
    }
    if (result is WordBankRefresh.Updated) ModelUpdateManager.cacheWordBank(context, result.words)
    return result
}
