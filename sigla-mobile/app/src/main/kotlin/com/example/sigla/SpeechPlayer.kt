package com.example.sigla

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.concurrent.Executors

// One serial lane for every voice change and utterance, so a speak() can never
// overtake the voice change queued just before it. Daemon: it must not hold the
// process open.
private val speechLane = Executors.newSingleThreadExecutor { r ->
    Thread(r, "sigla-tts").apply { isDaemon = true }
}.asCoroutineDispatcher()

/**
 * The app's text-to-speech: English, the user's preferred voice and volume.
 * MainActivity and WordDetailActivity each built and tore this down by hand.
 *
 * The voice is applied before every utterance. After the first call this is
 * TtsVoiceHelper's cached fast path, and it means a voice changed in Settings
 * takes effect on the next utterance on either screen.
 */
class SpeechPlayer(
    context: Context,
    private val appSettings: AppSettings,
    private val scope: CoroutineScope,
) {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var pending: String? = null

    init {
        // applicationContext: release() shuts the engine down off the main thread,
        // so the unbind can land after the Activity is gone. Bound through the
        // Activity, that would leak its ServiceConnection.
        tts = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.ENGLISH
                ready = true
                pending?.let { speak(it) }
                pending = null
            }
        }
    }

    /**
     * Speaks [text]. Before the engine is ready it is dropped, or held and spoken
     * once ready when [queueUntilReady] (only the latest held text survives).
     */
    fun speak(text: String, queueUntilReady: Boolean = false) {
        if (!ready) {
            if (queueUntilReady) pending = text
            return
        }
        val engine = tts ?: return
        val params = Bundle().apply {
            putFloat(
                TextToSpeech.Engine.KEY_PARAM_VOLUME,
                (appSettings.volume / 100f).coerceIn(0f, 1f),
            )
        }
        // Resolving the voice can block on a query into the TTS engine process
        // (cached after the first time), so it must not run on the main thread.
        scope.launch(speechLane) {
            TtsVoiceHelper.applyPreferredVoice(engine, appSettings)
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, null)
        }
    }

    /**
     * shutdown() blocks until the engine connection started in the constructor
     * has finished binding, so leaving right after entering stalled the main
     * thread for 0.6-1.25 s. Shut down on teardownExecutor instead.
     */
    fun release() {
        val doomed = tts
        tts = null
        ready = false
        pending = null
        if (doomed != null) teardownExecutor.execute { doomed.shutdown() }
    }
}
