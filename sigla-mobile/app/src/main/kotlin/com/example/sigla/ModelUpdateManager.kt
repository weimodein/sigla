package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

object ModelUpdateManager {

    private const val TAG = "ModelUpdateManager"
    private const val PREFS = "model_cache"
    private const val KEY_VERSION = "cached_version"
    private const val WORD_BANK_CACHE_FILE = "word_bank_cache.json"

    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private val gson = Gson()

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun getCachedVersion(context: Context): String? =
        prefs(context).getString(KEY_VERSION, null)

    fun hasLocalModel(context: Context): Boolean {
        return listOf(
            "sign_model_static.tflite",
            "labels_static.json"
        ).all { File(context.filesDir, it).exists() }
    }

    fun hasLocalMotionModel(context: Context): Boolean {
        return listOf(
            "sign_model_motion.tflite",
            "labels_motion.json"
        ).all { File(context.filesDir, it).exists() }
    }

    suspend fun checkAndUpdate(context: Context, token: String?): Boolean {
        return withContext(Dispatchers.IO) {
            try {
                Log.i(TAG, "Checking for model updates…")
                val response = ApiClient.get(token).getLatestModel()
                if (!response.isSuccessful) {
                    Log.w(TAG, "Failed to fetch model info: ${response.code()}")
                    return@withContext hasLocalModel(context)
                }
                val model = response.body()?.model ?: run {
                    Log.w(TAG, "No model info in response body")
                    return@withContext hasLocalModel(context)
                }

                val remoteVersion = model.version_number
                val cachedVersion = getCachedVersion(context)
                val versionChanged = remoteVersion != cachedVersion
                val modelFileMissing = !hasLocalModel(context)

                if (!versionChanged && !modelFileMissing) {
                    Log.i(TAG, "Model up-to-date: $remoteVersion")
                    return@withContext true
                }

                Log.i(TAG, "Downloading model version: $remoteVersion")

                // ── Static model (required) ───────────────────────────────────
                val staticUrl = model.tflite_url
                if (staticUrl.isNullOrBlank()) {
                    Log.e(TAG, "Backend returned no static model URL — check SUPABASE_URL on server")
                    return@withContext hasLocalModel(context)
                }
                val staticOk = downloadToFile(staticUrl, File(context.filesDir, "sign_model_static.tflite"))
                if (!staticOk) {
                    Log.e(TAG, "Static model download failed")
                    return@withContext hasLocalModel(context)
                }
                Log.i(TAG, "Static TFLite downloaded")

                // ── Static labels (required) ──────────────────────────────────
                val labelsStaticUrl = model.labels_static_url
                if (labelsStaticUrl.isNullOrBlank()) {
                    Log.e(TAG, "Backend returned no static labels URL — check SUPABASE_URL on server")
                    return@withContext false
                }
                val labelsStaticOk = downloadToFile(labelsStaticUrl, File(context.filesDir, "labels_static.json"))
                if (!labelsStaticOk) {
                    Log.e(TAG, "Static labels download failed — cannot run inference without labels")
                    return@withContext false
                }
                Log.i(TAG, "Static labels downloaded")

                // ── Motion model (optional) ───────────────────────────────────
                val motionUrl = model.motion_tflite_url
                if (!motionUrl.isNullOrBlank()) {
                    val motionOk = downloadToFile(motionUrl, File(context.filesDir, "sign_model_motion.tflite"))
                    if (motionOk) Log.i(TAG, "Motion TFLite downloaded")
                    else Log.w(TAG, "Motion model download failed — only static gestures will work")
                } else {
                    Log.w(TAG, "No motion model URL provided — skipping motion model")
                }

                // ── Motion labels (optional, only if motion model downloaded) ─
                val labelsMotionUrl = model.labels_motion_url
                if (!labelsMotionUrl.isNullOrBlank() && File(context.filesDir, "sign_model_motion.tflite").exists()) {
                    val labelsMotionOk = downloadToFile(labelsMotionUrl, File(context.filesDir, "labels_motion.json"))
                    if (!labelsMotionOk) Log.w(TAG, "Motion labels download failed")
                    else Log.i(TAG, "Motion labels downloaded")
                }

                // ── Gesture config (optional) ─────────────────────────────────
                val gestureConfigUrl = model.gesture_config_url
                if (!gestureConfigUrl.isNullOrBlank()) {
                    val ok = downloadToFile(gestureConfigUrl, File(context.filesDir, "gesture_config.json"))
                    if (ok) Log.i(TAG, "Gesture config downloaded")
                    else Log.w(TAG, "Gesture config download failed — motion type detection may be inaccurate")
                } else {
                    Log.w(TAG, "No gesture config URL — skipping")
                }

                // ── Save version only after all required files succeeded ───────
                prefs(context).edit().putString(KEY_VERSION, remoteVersion).apply()
                Log.i(TAG, "Model updated to $remoteVersion")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Model update failed: ${e.message}", e)
                hasLocalModel(context)
            }
        }
    }

    private fun downloadToFile(url: String, dest: File): Boolean {
        return try {
            val request = Request.Builder().url(url).build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "Download failed for $url: ${response.code}")
                    return false
                }
                val body = response.body ?: run {
                    Log.w(TAG, "Empty response body for $url")
                    return false
                }
                val tmp = File(dest.parent, dest.name + ".tmp")
                tmp.outputStream().use { out -> body.byteStream().copyTo(out) }
                val renamed = tmp.renameTo(dest)
                if (!renamed) {
                    Log.e(TAG, "Failed to rename tmp file to ${dest.name} — disk full or permission error?")
                    tmp.delete()
                    return false
                }
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "downloadToFile error for $url: ${e.message}", e)
            false
        }
    }

    fun getLocalFile(context: Context, filename: String): File? {
        val file = File(context.filesDir, filename)
        return if (file.exists()) file else null
    }

    fun getLocalThumb(context: Context, wordId: Int): File? {
        val file = File(context.filesDir, "wb_thumb_$wordId")
        return if (file.exists()) file else null
    }

    suspend fun downloadWordBankImages(context: Context, words: List<WordBankWord>) {
        withContext(Dispatchers.IO) {
            for (word in words) {
                val thumbUrl = word.thumbnail_url ?: continue
                val dest = File(context.filesDir, "wb_thumb_${word.id}")
                if (dest.exists()) continue
                val ok = downloadToFile(thumbUrl, dest)
                if (!ok) Log.w(TAG, "Thumbnail download failed for word ${word.id}")
            }
            Log.i(TAG, "Word bank thumbnail download complete")
        }
    }

    fun loadCachedWordBank(context: Context): List<WordBankWord>? {
        val file = File(context.filesDir, WORD_BANK_CACHE_FILE)
        if (!file.exists()) return null
        return try {
            val type = object : TypeToken<List<WordBankWord>>() {}.type
            gson.fromJson<List<WordBankWord>>(file.readText(), type)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load cached word bank: ${e.message}")
            null
        }
    }

    suspend fun cacheWordBank(context: Context, words: List<WordBankWord>) {
        withContext(Dispatchers.IO) {
            try {
                val file = File(context.filesDir, WORD_BANK_CACHE_FILE)
                file.writeText(gson.toJson(words))
                Log.i(TAG, "Word bank cached (${words.size} words)")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to cache word bank: ${e.message}")
            }
        }
    }
}
