package com.example.sigla

import android.speech.tts.TextToSpeech

/**
 * Best-effort Male/Female voice selection. Android's TextToSpeech API exposes
 * no gender metadata on Voice, so this first tries a name-based hint (works
 * on engines — like Google's — that embed "male"/"female" in the voice
 * name), then falls back to a deterministic split across the available
 * English voices so toggling the setting always audibly changes something,
 * even on engines/devices whose voice names carry no gender hint at all.
 */
object TtsVoiceHelper {
    fun applyPreferredVoice(tts: TextToSpeech?, appSettings: AppSettings) {
        val engine = tts ?: return
        val preferFemale = appSettings.voiceType == AppSettings.VOICE_FEMALE
        val enVoices = engine.voices
            ?.filter { it.locale.language == "en" }
            ?.sortedBy { it.name }
            ?: return
        if (enVoices.isEmpty()) return

        val byName = enVoices.firstOrNull { v ->
            val n = v.name.lowercase()
            if (preferFemale) n.contains("female") else n.contains("male") && !n.contains("female")
        }

        val fallback = if (enVoices.size > 1) {
            if (preferFemale) enVoices.last() else enVoices.first()
        } else {
            enVoices.first()
        }

        engine.voice = byName ?: fallback
    }
}
