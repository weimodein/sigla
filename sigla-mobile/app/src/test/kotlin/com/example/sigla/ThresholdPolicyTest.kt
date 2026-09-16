package com.example.sigla

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins the live firing thresholds to their DEPLOYMENT values.
 *
 * On 2026-09-12 these were lowered (0.80/0.80/0.15 -> 0.40/0.40/0.08) to evaluate the
 * weak classes of the v1.0.0-greetings model, with a comment saying "RESTORE BEFORE ANY
 * REAL DEPLOYMENT". Nothing enforced that, so the test values sat on main for three
 * days and would have shipped silently — the app emitting confident wrong predictions
 * on exactly the GOOD AFTERNOON / GOOD EVENING pair it confuses most.
 *
 * This test is the enforcement. It reads the Kotlin SOURCE rather than referencing the
 * constants, for two reasons:
 *   * they are `private const val`, so a test in the same package still cannot see them
 *     without widening production visibility purely for a test;
 *   * reading the text catches the exact failure mode — someone editing the literal for
 *     a quick experiment — which a compiled reference would happily follow.
 *
 * To run a threshold experiment, change the values AND this test in the same commit.
 * Making the pin deliberate to defeat is the entire point: the previous mechanism was a
 * comment, and a comment lost.
 */
class ThresholdPolicyTest {

    private val source: String by lazy {
        // These constants are `private const val`, so they are compiled away — the
        // source file is the only place the literal survives, and the test must find
        // it on disk.
        //
        // Gradle runs unit tests with the working directory set to the MODULE dir
        // (app/), so the first candidate normally hits. The fallbacks cover being run
        // from the repo root or from an IDE that sets a different working directory.
        // A missing file FAILS rather than skipping: a test that silently finds
        // nothing would report green while enforcing nothing, which is exactly the
        // failure mode this class exists to prevent.
        val relative = "src/main/kotlin/com/example/sigla/PredictionService.kt"
        val candidates = listOf(
            File(relative),
            File("app/$relative"),
            File("sigla-mobile/app/$relative"),
        )
        val file = candidates.firstOrNull { it.isFile }
        assertTrue(
            "PredictionService.kt not found. Looked in: " +
                candidates.joinToString(", ") { it.absolutePath } +
                ". If the file moved, update this path rather than deleting the test.",
            file != null,
        )
        file!!.readText()
    }

    private fun floatConst(name: String): Float {
        val m = Regex("""\bval\s+${Regex.escape(name)}\s*(?::\s*Float\s*)?=\s*([0-9.]+)f""")
            .find(source)
        assertTrue("constant $name not found in PredictionService.kt", m != null)
        return m!!.groupValues[1].toFloat()
    }

    private fun intConst(name: String): Int {
        val m = Regex("""\bval\s+${Regex.escape(name)}\s*(?::\s*Int\s*)?=\s*(\d+)\b""")
            .find(source)
        assertTrue("constant $name not found in PredictionService.kt", m != null)
        return m!!.groupValues[1].toInt()
    }

    @Test
    fun acceptanceThresholdIsAtDeploymentValue() {
        assertEquals(
            "MOTION_THRESHOLD is not at its deployment value. If this is a deliberate " +
                "threshold change, update this test in the same commit; if it is a " +
                "leftover experiment, restore 0.80.",
            0.80f, floatConst("MOTION_THRESHOLD"), 0.0001f,
        )
    }

    @Test
    fun evidenceGateIsAtDeploymentValue() {
        assertEquals(
            "MOTION_EARLY_CONF is the evidence gate — lowering it degenerates the " +
                "10-frame streak into '10 frames happened' and re-opens the " +
                "shared-opening misfire (GOOD EVENING/GOOD AFTERNOON).",
            0.80f, floatConst("MOTION_EARLY_CONF"), 0.0001f,
        )
    }

    @Test
    fun runnerUpMarginIsAtDeploymentValue() {
        assertEquals(
            "MOTION_MIN_MARGIN is what separates visually similar phrases. At 0.08 the " +
                "GOOD AFTERNOON / GOOD EVENING pair fires as each other.",
            0.15f, floatConst("MOTION_MIN_MARGIN"), 0.0001f,
        )
    }

    /**
     * The two confidence tiers must stay mutually exclusive and correctly ordered:
     * EARLY_EXIT_THRESHOLD above MOTION_EARLY_CONF, or the high-confidence tier can
     * never fire on its own merit (see the EARLY_EXIT_STREAK comment in the source).
     */
    @Test
    fun confidenceTiersStayOrdered() {
        val earlyExit = floatConst("EARLY_EXIT_THRESHOLD")
        val earlyConf = floatConst("MOTION_EARLY_CONF")
        assertTrue(
            "EARLY_EXIT_THRESHOLD ($earlyExit) must exceed MOTION_EARLY_CONF ($earlyConf), " +
                "otherwise the high-confidence tier is unreachable.",
            earlyExit > earlyConf,
        )
        assertTrue(
            "EARLY_EXIT_STREAK must be shorter than MOTION_EARLY_STREAK, or the " +
                "high-confidence tier arrives no sooner than the normal path.",
            intConst("EARLY_EXIT_STREAK") < intConst("MOTION_EARLY_STREAK"),
        )
    }

    /**
     * A prediction must clear the acceptance threshold AND the margin. Pinning the
     * values alone is not enough — this checks they still compose into a gate that
     * rejects the near-tie the margin exists to catch.
     */
    @Test
    fun thresholdAndMarginTogetherRejectANearTie() {
        val nearTie = floatArrayOf(0.52f, 0.48f)
        assertTrue(
            "a 0.52/0.48 split must fail the margin gate",
            topPredictionMargin(nearTie, 0) < floatConst("MOTION_MIN_MARGIN"),
        )

        val clear = floatArrayOf(0.88f, 0.05f, 0.07f)
        assertTrue(
            "a 0.88 top-1 must clear both gates",
            clear[0] >= floatConst("MOTION_THRESHOLD") &&
                topPredictionMargin(clear, 0) >= floatConst("MOTION_MIN_MARGIN"),
        )
    }
}
