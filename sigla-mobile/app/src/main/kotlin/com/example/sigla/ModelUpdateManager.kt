package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

object ModelUpdateManager {

    private const val TAG = "ModelUpdateManager"
    private const val PREFS = "model_cache"
    private const val KEY_VERSION = "cached_version"
    private const val KEY_STATIC_URL = "cached_static_url"
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

    private fun getCachedStaticUrl(context: Context): String? =
        prefs(context).getString(KEY_STATIC_URL, null)

    // The motion model is the only model. hasLocalModel and hasLocalMotionModel
    // are kept as aliases so existing callers compile unchanged.
    fun hasLocalModel(context: Context): Boolean {
        return listOf(
            "sign_model_motion.tflite",
            "labels_motion.json"
        ).all { File(context.filesDir, it).exists() }
    }

    fun hasLocalMotionModel(context: Context): Boolean = hasLocalModel(context)

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

                // model.tflite_url is the (motion) LSTM model — the only model.
                val remoteModelUrl = model.tflite_url
                if (remoteVersion == cachedVersion && remoteModelUrl == getCachedStaticUrl(context)) {
                    Log.i(TAG, "Model up-to-date (v$remoteVersion)")
                    return@withContext hasLocalModel(context)
                }

                Log.i(TAG, "New model version detected: $remoteVersion (cached: $cachedVersion) — downloading")

                // ── Motion model (required) ───────────────────────────────────
                if (remoteModelUrl.isNullOrBlank()) {
                    Log.e(TAG, "Backend returned no model URL — check SUPABASE_URL on server")
                    return@withContext hasLocalModel(context)
                }
                val modelDest = File(context.filesDir, "sign_model_motion.tflite")
                val modelOk = downloadToFile(remoteModelUrl, modelDest)
                if (!modelOk) {
                    Log.e(TAG, "Motion model download failed")
                    return@withContext hasLocalModel(context)
                }

                // ── Verify SHA256 integrity before accepting the new model ─────
                val expectedChecksum = model.checksum
                if (!expectedChecksum.isNullOrBlank()) {
                    val actualChecksum = computeSha256(modelDest)
                    if (actualChecksum != expectedChecksum) {
                        Log.e(TAG, "Checksum mismatch! Expected=$expectedChecksum Actual=$actualChecksum — discarding download")
                        modelDest.delete()
                        return@withContext hasLocalModel(context)
                    }
                    Log.i(TAG, "Checksum verified OK")
                } else {
                    Log.w(TAG, "No checksum provided by server — skipping integrity check")
                }

                Log.i(TAG, "Motion TFLite downloaded")

                // ── Motion labels (required) ──────────────────────────────────
                val labelsMotionUrl = model.labels_motion_url
                if (labelsMotionUrl.isNullOrBlank()) {
                    Log.e(TAG, "Backend returned no motion labels URL — check SUPABASE_URL on server")
                    return@withContext false
                }
                val labelsMotionOk = downloadToFile(labelsMotionUrl, File(context.filesDir, "labels_motion.json"))
                if (!labelsMotionOk) {
                    Log.e(TAG, "Motion labels download failed — cannot run inference without labels")
                    return@withContext false
                }
                Log.i(TAG, "Motion labels downloaded")

                // ── Save version + URL only after all required files succeeded ──
                prefs(context).edit()
                    .putString(KEY_VERSION, remoteVersion)
                    .putString(KEY_STATIC_URL, remoteModelUrl)
                    .apply()
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

    private fun computeSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream ->
            val buffer = ByteArray(8192)
            var read: Int
            while (stream.read(buffer).also { read = it } != -1) {
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
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
