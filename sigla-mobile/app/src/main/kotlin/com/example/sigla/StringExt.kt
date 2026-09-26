package com.example.sigla

/**
 * Category names come back from the backend in lowercase (e.g. "greetings",
 * "asking for prices"). This capitalizes just the first letter for display,
 * without touching user-typed custom category names.
 */
fun String.capitalizeFirst(): String =
    replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }

/**
 * Title-cases a server category name for display ("RELATIONSHIPS" ->
 * "Relationships", "asking for prices" -> "Asking For Prices").
 *
 * Backend category names are stored either all-lowercase or all-uppercase, so
 * capitalizeFirst() alone left multi-word names as e.g. "ASKING FOR PRICES",
 * and single long all-caps names (RELATIONSHIPS, TRANSACTIONAL) filled the
 * category grid card's width so tightly that Android had to hyphenate them
 * mid-word — see item_category_card.xml. Lowercasing first means each word's
 * capitalizeFirst() sees a genuinely lowercase word, so this is safe to call
 * on a name in ANY case, not just the backend's usual lowercase.
 *
 * User-typed custom category names must NOT go through this — same reason
 * capitalizeFirst() doesn't touch them: it would silently rewrite a name the
 * user chose on purpose (e.g. deliberately-cased branding).
 */
fun String.toTitleCase(): String =
    lowercase().split(" ").joinToString(" ") { it.capitalizeFirst() }
