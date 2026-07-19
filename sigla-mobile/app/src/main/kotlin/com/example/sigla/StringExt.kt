package com.example.sigla

/**
 * Category names come back from the backend in lowercase (e.g. "greetings",
 * "asking for prices"). This capitalizes just the first letter for display,
 * without touching user-typed custom category names.
 */
fun String.capitalizeFirst(): String =
    replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
