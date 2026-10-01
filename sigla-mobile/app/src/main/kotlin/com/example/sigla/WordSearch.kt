package com.example.sigla

/**
 * The search every word list uses: English label, Filipino translation, or
 * description, ignoring case. An empty query matches everything.
 */
fun WordBankWord.matchesSearch(query: String): Boolean =
    query.isEmpty() ||
        label.contains(query, ignoreCase = true) ||
        filipino_translation?.contains(query, ignoreCase = true) == true ||
        description?.contains(query, ignoreCase = true) == true
