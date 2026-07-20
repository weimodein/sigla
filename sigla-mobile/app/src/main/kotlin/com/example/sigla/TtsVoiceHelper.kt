package com.example.sigla

import android.speech.tts.TextToSpeech

/**
 * Male/Female voice selection for the offline TextToSpeech engine. Prefers a
 * genuinely different installed voice for each gender over faking one with
 * pitch — pitch/rate adjustment is only ever a last-resort, subtle nudge when
 * the device doesn't have enough distinct voices to tell them apart.
 */
object TtsVoiceHelper {
    // Used only when 2+ distinct voices exist but neither has a confirmable
    // gender hint in its name — a light disambiguator, not a fake voice.
    private const val MULTI_VOICE_MALE_PITCH = 0.96f
    private const val MULTI_VOICE_FEMALE_PITCH = 1.06f

    // Used only when the device has just one voice installed total, so both
    // genders would otherwise sound identical. Kept subtle and at a normal
    // speaking rate — combining a heavy pitch drop with a slowed rate is
    // what makes synthetic speech sound like a robotic old man, not a
    // natural young male voice.
    private const val SINGLE_VOICE_MALE_PITCH = 0.97f
    private const val SINGLE_VOICE_FEMALE_PITCH = 1.12f
    private const val SINGLE_VOICE_MALE_RATE = 1.0f

    fun applyPreferredVoice(tts: TextToSpeech?, appSettings: AppSettings) {
        val engine = tts ?: return
        val preferFemale = appSettings.voiceType == AppSettings.VOICE_FEMALE
        val allVoices = engine.voices?.toList().orEmpty()
        val enVoices = allVoices.filter { it.locale.language == "en" }.sortedBy { it.name }
        val candidates = if (enVoices.size > 1) enVoices else allVoices.sortedBy { it.name }

        val byName = candidates.firstOrNull { v ->
            val n = v.name.lowercase()
            if (preferFemale) {
                (n.contains("female") || n.contains("woman") || n.contains("girl"))
            } else {
                (n.contains("male") || n.contains("man") || n.contains("boy")) && !n.contains("female")
            }
        }

        if (byName != null) {
            // A real, name-confirmed voice — trust it, no artificial shift.
            engine.voice = byName
            engine.setPitch(1.0f)
            engine.setSpeechRate(1.0f)
            return
        }

        if (candidates.size > 1) {
            // No confirmed gender hint, but genuinely different voice models
            // are available — assign a distinct one per gender and apply
            // only a small nudge to reinforce the intended difference.
            val chosen = if (preferFemale) candidates.last() else candidates.first()
            engine.voice = chosen
            engine.setPitch(if (preferFemale) MULTI_VOICE_FEMALE_PITCH else MULTI_VOICE_MALE_PITCH)
            engine.setSpeechRate(1.0f)
            return
        }

        // Only one voice available on the whole device — same voice for
        // both, so pitch/rate is the only way to keep them distinguishable.
        candidates.firstOrNull()?.let { engine.voice = it }
        engine.setPitch(if (preferFemale) SINGLE_VOICE_FEMALE_PITCH else SINGLE_VOICE_MALE_PITCH)
        engine.setSpeechRate(if (preferFemale) 1.0f else SINGLE_VOICE_MALE_RATE)
    }
}
