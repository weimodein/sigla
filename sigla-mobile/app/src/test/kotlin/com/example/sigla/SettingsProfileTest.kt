package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsProfileTest {

    @Test
    fun displayNameShowsTheStoredNameWhenPresent() {
        assertEquals("Jhoren", profileDisplayName("Jhoren"))
        assertEquals("Jhoren", profileDisplayName("  Jhoren  "))
    }

    @Test
    fun displayNameFallsBackWhenNoNameIsStored() {
        assertEquals("Add your name", profileDisplayName(null))
        assertEquals("Add your name", profileDisplayName(""))
        assertEquals("Add your name", profileDisplayName("   "))
    }

    @Test
    fun initialIsTheFirstLetterUppercased() {
        assertEquals("J", profileInitial("Jhoren"))
        assertEquals("M", profileInitial("maria"))
        assertEquals("J", profileInitial("  jhoren  "))
    }

    @Test
    fun initialFallsBackWhenNoNameIsStored() {
        assertEquals("?", profileInitial(null))
        assertEquals("?", profileInitial(""))
        assertEquals("?", profileInitial("   "))
    }
}
