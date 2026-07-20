package com.example.sigla

import android.content.Context
import android.media.MediaPlayer
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

private const val TAG = "SpeechHelper"

// Single, process-scoped TTS entry point shared by every screen that speaks
// (MainActivity, WordDetailActivity). Uses the cloud API voice when online,
// automatically falling back to the on-device TextToSpeech engine when
// offline or if the cloud call fails. The local engine is built once, lazily,
// with applicationContext, and never rebuilt or explicitly shut down
// per-Activity.
object SpeechHelper {
    private var engine: TextToSpeech? = null
    private var appliedVoiceType: String? = null
    private var mediaPlayer: MediaPlayer? = null

    fun speak(context: Context, text: String, appSettings: AppSettings, scope: CoroutineScope) {
        if (text.isBlank()) return

        if (!hasActiveNetwork(context)) {
            ensureInit(context) { speakLocally(text, appSettings) }
            return
        }

        val voice = if (appSettings.voiceType == AppSettings.VOICE_FEMALE) "female" else "male"
        scope.launch(Dispatchers.IO) {
            try {
                val response = TtsClient.get().speak(text, voice)
                if (!response.isSuccessful) {
                    Log.e(TAG, "Cloud TTS request failed: ${response.code()}")
                    withContext(Dispatchers.Main) { ensureInit(context) { speakLocally(text, appSettings) } }
                    return@launch
                }
                val body = response.body() ?: return@launch
                val tempFile = File.createTempFile("tts_", ".mp3", context.cacheDir)
                tempFile.outputStream().use { out -> body.byteStream().copyTo(out) }
                withContext(Dispatchers.Main) { playAudio(tempFile, appSettings) }
            } catch (e: Exception) {
                Log.e(TAG, "Cloud TTS error: ${e.message}", e)
                withContext(Dispatchers.Main) { ensureInit(context) { speakLocally(text, appSettings) } }
            }
        }
    }

    fun stop() {
        engine?.stop()
        mediaPlayer?.let { mp ->
            try {
                mp.reset()
            } catch (_: Exception) {
                Log.w(TAG, "Error resetting MediaPlayer")
            }
            try {
                mp.release()
            } catch (_: Exception) {
                Log.w(TAG, "Error releasing MediaPlayer")
            }
        }
        mediaPlayer = null
    }

    private fun hasActiveNetwork(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun speakLocally(text: String, appSettings: AppSettings) {
        applyVoiceIfNeeded(appSettings)
        val volume = (appSettings.volume / 100f).coerceIn(0f, 1f)
        val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume) }
        engine?.speak(text, TextToSpeech.QUEUE_FLUSH, params, "sigla_tts")
    }

    private fun playAudio(file: File, appSettings: AppSettings) {
        mediaPlayer?.release()
        mediaPlayer = MediaPlayer().apply {
            setDataSource(file.absolutePath)
            val volume = (appSettings.volume / 100f).coerceIn(0f, 1f)
            setVolume(volume, volume)
            setOnPreparedListener { start() }
            setOnCompletionListener {
                it.release()
                file.delete()
            }
            setOnErrorListener { mp, _, _ ->
                mp.release()
                file.delete()
                true
            }
            prepareAsync()
        }
    }

    private fun ensureInit(context: Context, onReady: () -> Unit) {
        if (engine != null) {
            onReady()
            return
        }
        engine = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                engine?.language = Locale.ENGLISH
                onReady()
            }
        }
    }

    private fun applyVoiceIfNeeded(appSettings: AppSettings) {
        if (appliedVoiceType == appSettings.voiceType) return
        TtsVoiceHelper.applyPreferredVoice(engine, appSettings)
        appliedVoiceType = appSettings.voiceType
    }
}
