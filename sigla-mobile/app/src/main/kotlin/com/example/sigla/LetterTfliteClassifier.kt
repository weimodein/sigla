package com.example.sigla

import org.tensorflow.lite.Interpreter

/**
 * The letters .tflite with two signatures (spec "Two letter models in one file"):
 *   static(landmarks[1,63])      -> probabilities[1,N]
 *   motion(frames[1,32,63])      -> probabilities[1,N+1]  (last = _none)
 * Reuses its buffers, so callers must serialise access (PredictionService's lock).
 */
internal class LetterTfliteClassifier(
    private val interp: Interpreter,
    override val labels: List<String>,
) : LetterClassifier {
    private val staticIn = arrayOf(FloatArray(LETTER_FLOATS))
    private val staticOut = arrayOf(FloatArray(labels.size))
    private val motionIn = arrayOf(Array(LETTER_MOTION_FRAMES) { FloatArray(LETTER_FLOATS) })
    private val motionOut = arrayOf(FloatArray(labels.size + 1))

    override fun classifyStatic(hand: FloatArray): FloatArray {
        hand.copyInto(staticIn[0])
        interp.runSignature(mapOf<String, Any>(IN_STATIC to staticIn), mapOf<String, Any>(OUT to staticOut), SIG_STATIC)
        return staticOut[0].copyOf()
    }

    override fun classifyMotion(frames: Array<FloatArray>): FloatArray {
        for (i in 0 until LETTER_MOTION_FRAMES) frames[i].copyInto(motionIn[0][i])
        interp.runSignature(mapOf<String, Any>(IN_MOTION to motionIn), mapOf<String, Any>(OUT to motionOut), SIG_MOTION)
        return motionOut[0].copyOf()
    }

    companion object {
        private const val SIG_STATIC = "static"
        private const val SIG_MOTION = "motion"
        private const val IN_STATIC = "landmarks"
        private const val IN_MOTION = "frames"
        private const val OUT = "probabilities"

        fun isLetterModel(interp: Interpreter): Boolean =
            interp.signatureKeys.toSet().containsAll(listOf(SIG_STATIC, SIG_MOTION))

        /** null when the file matches this build and [labelCount]; otherwise why not. */
        fun validate(interp: Interpreter, labelCount: Int): String? = try {
            val sIn = interp.getInputTensorFromSignature(IN_STATIC, SIG_STATIC).shape()
            val sOut = interp.getOutputTensorFromSignature(OUT, SIG_STATIC).shape()
            val mIn = interp.getInputTensorFromSignature(IN_MOTION, SIG_MOTION).shape()
            val mOut = interp.getOutputTensorFromSignature(OUT, SIG_MOTION).shape()
            when {
                !sIn.contentEquals(intArrayOf(1, LETTER_FLOATS)) -> "static input ${sIn.contentToString()}"
                !mIn.contentEquals(intArrayOf(1, LETTER_MOTION_FRAMES, LETTER_FLOATS)) -> "motion input ${mIn.contentToString()}"
                sOut.last() != labelCount -> "static output ${sOut.last()} != $labelCount labels"
                mOut.last() != labelCount + 1 -> "motion output ${mOut.last()} != ${labelCount + 1}"
                else -> null
            }
        } catch (e: Exception) {
            "signature check failed: ${e.message}"
        }
    }
}
