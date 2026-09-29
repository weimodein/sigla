package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * XML animations cannot read Motion's Kotlin constants, so res/values/motion.xml
 * mirrors them. This fails if either side is edited alone.
 */
class MotionTokensTest {

    private val values: Map<String, Long> by lazy {
        // Unit tests run with the module directory (sigla-mobile/app) as cwd.
        val xml = File("src/main/res/values/motion.xml").readText()
        Regex("""<integer name="(\w+)">(\d+)</integer>""").findAll(xml)
            .associate { it.groupValues[1] to it.groupValues[2].toLong() }
    }

    @Test
    fun quickMatchesMotion() = assertEquals(Motion.QUICK, values["motion_quick"])

    @Test
    fun standardMatchesMotion() = assertEquals(Motion.STANDARD, values["motion_standard"])

    @Test
    fun theOtherTimingsHaveTheirSpecValues() {
        assertEquals(180L, values["motion_screen_exit"])
        assertEquals(150L, values["motion_tab"])
        assertEquals(40L, values["motion_list_stagger"])
    }
}
