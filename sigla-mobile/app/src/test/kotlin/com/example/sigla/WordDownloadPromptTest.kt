package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WordDownloadPromptTest {

    @Test
    fun onWiFiItNamesTheWordAndOffersAPlainDownload() {
        val p = wordDownloadPrompt(wordName = "Good morning", metered = false)
        assertEquals("Download this video?", p.title)
        assertEquals("The demo video for \"Good morning\" will be saved for offline use.", p.message)
        assertEquals("Download", p.action)
    }

    @Test
    fun onMobileDataItWarnsAndTheButtonSaysAnyway() {
        val p = wordDownloadPrompt(wordName = "Hello", metered = true)
        assertTrue(p.message.startsWith("The demo video for \"Hello\" will be saved for offline use."))
        assertTrue(p.message.contains("You're on mobile data"))
        assertEquals("Download anyway", p.action)
    }

    @Test
    fun theWiFiMessageCarriesNoDataWarning() {
        assertFalse(wordDownloadPrompt(wordName = "Hello", metered = false).message.contains("mobile data"))
    }
}
