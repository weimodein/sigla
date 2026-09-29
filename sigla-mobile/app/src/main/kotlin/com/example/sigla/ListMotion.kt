package com.example.sigla

/** Items past this index share its delay, so a long list never waits to appear. */
internal const val LIST_STAGGER_CAP = 8

/**
 * A list plays its entrance once per screen instance, on its first non-empty
 * data. Search keystrokes, tab returns and refreshes arrive with it already
 * played; an empty first load does not spend it.
 */
internal fun shouldPlayListEntrance(alreadyPlayed: Boolean, itemCount: Int): Boolean =
    !alreadyPlayed && itemCount > 0

/** Start delay for the item at [index]: one [stepMs] per item, capped. */
internal fun staggerDelayMs(index: Int, stepMs: Long, cap: Int = LIST_STAGGER_CAP): Long =
    minOf(maxOf(index, 0), cap - 1) * stepMs
