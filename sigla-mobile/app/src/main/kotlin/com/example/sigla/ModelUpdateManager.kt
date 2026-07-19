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
    private const val CATEGORIES_CACHE_FILE = "categories_cache.json"

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
                // ── Download to a staging file, verify checksum, THEN swap in ──
                // Never overwrite/delete the live model before we have verified
                // replacement bytes. If verification fails we keep the last-good
                // model, so a bad deploy or a stale CDN copy can't brick the app.
                val modelDest = File(context.filesDir, "sign_model_motion.tflite")
                val expectedChecksum = model.checksum
                val verifiedModel = downloadAndVerify(remoteModelUrl, modelDest, expectedChecksum)
                if (!verifiedModel) {
                    Log.e(TAG, "Motion model download/verify failed — keeping existing model if any")
                    return@withContext hasLocalModel(context)
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
                    Log.e(TAG, "Motion labels download failed — falling back to any existing local model+labels")
                    return@withContext hasLocalModel(context)
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

    /**
     * Download [url] to a staging file, verify its SHA-256 against [expectedChecksum],
     * and only then atomically replace [dest] with the verified bytes. The live
     * [dest] is never touched unless verification succeeds, so a bad/stale download
     * cannot destroy the last-good model.
     *
     * On checksum mismatch it retries ONCE with a cache-busting query param, which
     * defeats a stale Supabase CDN copy served at the fixed deployed/ path.
     *
     * Returns true only when [dest] now holds verified bytes. If [expectedChecksum]
     * is blank, integrity checking is skipped (the download still goes tmp→swap).
     */
    private fun downloadAndVerify(url: String, dest: File, expectedChecksum: String?): Boolean {
        val staging = File(dest.parent, dest.name + ".staging")
        // Try the plain URL first, then a cache-busted URL if the checksum fails.
        val attempts = listOf(url, appendCacheBuster(url))
        for ((index, attemptUrl) in attempts.withIndex()) {
            if (!downloadToFile(attemptUrl, staging)) {
                Log.w(TAG, "Download attempt ${index + 1} failed for model")
                continue
            }
            if (expectedChecksum.isNullOrBlank()) {
                Log.w(TAG, "No checksum provided by server — skipping integrity check")
                return swapIntoPlace(staging, dest)
            }
            val actual = computeSha256(staging)
            if (actual == expectedChecksum) {
                Log.i(TAG, "Checksum verified OK")
                return swapIntoPlace(staging, dest)
            }
            Log.e(
                TAG,
                "Checksum mismatch (attempt ${index + 1})! Expected=$expectedChecksum Actual=$actual" +
                    if (index == 0) " — retrying with cache-buster" else " — giving up, keeping last-good model"
            )
            staging.delete()
        }
        return false
    }

    // Atomically move the verified staging file onto the live destination.
    private fun swapIntoPlace(staging: File, dest: File): Boolean {
        if (staging.renameTo(dest)) return true
        // Cross-filesystem or existing-dest edge case: copy then clean up.
        return try {
            staging.inputStream().use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
            staging.delete()
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to move verified model into place: ${e.message}", e)
            staging.delete()
            false
        }
    }

    // Append a cache-busting query param, preserving any existing query string.
    private fun appendCacheBuster(url: String): String {
        val sep = if (url.contains("?")) "&" else "?"
        return "$url${sep}cb=${System.nanoTime()}"
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

    fun loadCachedCategories(context: Context): List<CategoryItem>? {
        val file = File(context.filesDir, CATEGORIES_CACHE_FILE)
        if (!file.exists()) return null
        return try {
            val type = object : TypeToken<List<CategoryItem>>() {}.type
            gson.fromJson<List<CategoryItem>>(file.readText(), type)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load cached categories: ${e.message}")
            null
        }
    }

    suspend fun cacheCategories(context: Context, categories: List<CategoryItem>) {
        withContext(Dispatchers.IO) {
            try {
                val file = File(context.filesDir, CATEGORIES_CACHE_FILE)
                file.writeText(gson.toJson(categories))
                Log.i(TAG, "Categories cached (${categories.size})")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to cache categories: ${e.message}")
            }
        }
    }

    // Add this function to ModelUpdateManager.kt
    suspend fun forceDownloadModel(context: Context, token: String?): Boolean {
        return withContext(Dispatchers.IO) {
            try {
                Log.d(TAG, "=== FORCE DOWNLOADING MODEL ===")
                val response = ApiClient.get(token).getLatestModel()
                if (!response.isSuccessful) {
                    Log.e(TAG, "Failed to fetch model info: ${response.code()}")
                    return@withContext false
                }
                
                val model = response.body()?.model ?: run {
                    Log.e(TAG, "No model in response")
                    return@withContext false
                }
                
                Log.d(TAG, "Model version: ${model.version_number}")
                Log.d(TAG, "Model URL: ${model.tflite_url}")
                Log.d(TAG, "Expected checksum: ${model.checksum}")
                
                // Download without checksum verification first
                val modelUrl = model.tflite_url
                if (modelUrl.isNullOrBlank()) {
                    Log.e(TAG, "Model URL is null or blank")
                    return@withContext false
                }
                
                val modelDest = File(context.filesDir, "sign_model_motion.tflite")
                Log.d(TAG, "Downloading to: ${modelDest.absolutePath}")
                
                // Download the model
                val downloadSuccess = downloadToFile(modelUrl, modelDest)
                if (!downloadSuccess) {
                    Log.e(TAG, "Download failed!")
                    return@withContext false
                }
                
                Log.d(TAG, "Download successful! File size: ${modelDest.length()} bytes")
                
                // Check if file exists
                if (!modelDest.exists()) {
                    Log.e(TAG, "File doesn't exist after download!")
                    return@withContext false
                }
                
                // Download labels
                val labelsUrl = model.labels_motion_url
                if (!labelsUrl.isNullOrBlank()) {
                    val labelsDest = File(context.filesDir, "labels_motion.json")
                    downloadToFile(labelsUrl, labelsDest)
                    Log.d(TAG, "Labels downloaded: ${labelsDest.exists()}")
                }
                
                // Save version
                prefs(context).edit()
                    .putString(KEY_VERSION, model.version_number)
                    .putString(KEY_STATIC_URL, modelUrl)
                    .apply()
                
                Log.d(TAG, "=== MODEL DOWNLOAD COMPLETE ===")
                return@withContext true
                
            } catch (e: Exception) {
                Log.e(TAG, "Force download error: ${e.message}", e)
                return@withContext false
            }
        }
    }
}
