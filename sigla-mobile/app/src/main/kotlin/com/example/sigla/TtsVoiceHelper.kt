package com.example.sigla

import android.speech.tts.TextToSpeech
import android.speech.tts.Voice

/**
 * Best-effort Male/Female voice selection. Android's TextToSpeech API exposes
 * no gender metadata on Voice, so this first tries a name-based hint (works
 * on engines — like Google's — that embed "male"/"female" in the voice
 * name), then falls back to a deterministic split across the available
 * English voices so toggling the setting always audibly changes something,
 * even on engines/devices whose voice names carry no gender hint at all.
 */
object TtsVoiceHelper {

    // Resolving a voice requires engine.voices — a synchronous binder call into
    // the TTS engine process that returns the entire voice set (often 100+
    // Voice objects) before we filter and sort it. That is far too expensive to
    // repeat, so the result is cached against the preference it was resolved
    // for. Volatile because resolution happens off the main thread while
    // playback is triggered from it.
    @Volatile private var cachedVoice: Voice? = null
    @Volatile private var cachedForVoiceType: String? = null

    /**
     * Applies the preferred voice to [tts].
     *
     * Only queries the engine when the preference changed since the last
     * resolution (or nothing is cached yet). **Call this off the main thread**
     * the first time — the underlying query blocks.
     */
    fun applyPreferredVoice(tts: TextToSpeech?, appSettings: AppSettings) {
        val engine = tts ?: return
        val voiceType = appSettings.voiceType

        // Fast path: preference unchanged, so reuse the voice we already picked.
        cachedVoice?.let {
            if (cachedForVoiceType == voiceType) {
                engine.voice = it
                return
            }
        }

        val preferFemale = voiceType == AppSettings.VOICE_FEMALE
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

        val chosen = byName ?: fallback
        cachedVoice        = chosen
        cachedForVoiceType = voiceType
        engine.voice       = chosen
    }

    /**
     * Drops the cached voice so the next [applyPreferredVoice] re-resolves.
     * Call when the user changes the voice preference.
     */
    fun invalidate() {
        cachedVoice = null
        cachedForVoiceType = null
    }
}
