package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Call
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
    // The model file is the minimum requirement. Labels are optional because the
    // app can fall back to the backend word-bank endpoint at runtime.
    fun hasLocalModel(context: Context): Boolean {
        return File(context.filesDir, "sign_model_motion.tflite").exists()
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

                // ── Motion labels (optional for the current flow) ─────────────
                // The app can still initialize the model and fetch labels from the
                // backend word-bank endpoint, so a missing labels URL should not
                // block the model download flow.
                val labelsMotionUrl = model.labels_motion_url
                if (labelsMotionUrl.isNullOrBlank()) {
                    Log.w(TAG, "Backend returned no motion labels URL — continuing without downloading labels.json")
                } else {
                    val labelsMotionOk = downloadToFile(labelsMotionUrl, File(context.filesDir, "labels_motion.json"))
                    if (!labelsMotionOk) {
                        Log.w(TAG, "Motion labels download failed — the app will fall back to backend labels")
                    } else {
                        Log.i(TAG, "Motion labels downloaded")
                    }
                }

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
        if (dest.exists()) dest.delete()
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

    /**
     * Download [url] to [dest], retrying ONCE with a cache-buster on failure. The retry
     * rides out a transient network blip and also defeats a stale CDN copy, mirroring the
     * attempt list in [downloadAndVerify].
     *
     * [onCall] receives each attempt's [Call] so a caller can abort an in-flight download.
     * [shouldRetry] gates the second attempt: the bulk path uses it to avoid firing a fresh
     * request after the user cancelled, since a cancelled call fails exactly like a flaky one.
     */
    private fun downloadWithRetry(
        url: String,
        dest: File,
        onCall: ((Call) -> Unit)? = null,
        shouldRetry: () -> Boolean = { true }
    ): Boolean {
        if (downloadToFile(url, dest, onCall)) return true
        if (!shouldRetry()) return false
        Log.w(TAG, "Retrying ${dest.name} with cache-buster")
        return downloadToFile(appendCacheBuster(url), dest, onCall)
    }

    /**
     * Streams [url] into [dest] via a `.tmp` staging file, then renames it into place so a
     * truncated download is never visible as [dest].
     *
     * [onCall] is invoked with the in-flight [Call] before it executes, letting a caller
     * cancel it mid-stream. A cancelled call surfaces here as an IOException; the `finally`
     * block removes the partial `.tmp` on every failure path.
     */
    private fun downloadToFile(url: String, dest: File, onCall: ((Call) -> Unit)? = null): Boolean {
        val parent = dest.parentFile ?: run {
            Log.e(TAG, "No parent directory for ${dest.name}")
            return false
        }
        if (!parent.exists()) parent.mkdirs()
        val tmp = File(parent, dest.name + ".tmp")
        return try {
            val request = Request.Builder().url(url).build()
            val call = http.newCall(request)
            onCall?.invoke(call)
            call.execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "Download failed for $url: ${response.code}")
                    return@use false
                }
                val body = response.body ?: run {
                    Log.w(TAG, "Empty response body for $url")
                    return@use false
                }
                if (tmp.exists()) tmp.delete()
                tmp.outputStream().use { out -> body.byteStream().copyTo(out) }
                if (dest.exists()) dest.delete()
                if (tmp.renameTo(dest)) return@use true
                // Cross-filesystem or existing-dest edge case: copy then clean up.
                try {
                    tmp.inputStream().use { input ->
                        dest.outputStream().use { output -> input.copyTo(output) }
                    }
                    true
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to copy tmp file to ${dest.name}: ${e.message}", e)
                    false
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "downloadToFile error for $url: ${e.message}", e)
            false
        } finally {
            // Covers the cancelled-mid-stream case: never leave a partial .tmp behind.
            if (tmp.exists()) tmp.delete()
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

    // ── Demo video cache ─────────────────────────────────────────
    // Videos are downloaded only when the user explicitly taps the
    // placeholder, then cached for offline playback on later visits.

    fun getLocalVideo(context: Context, wordId: Int): File? {
        val file = File(context.filesDir, "wb_video_$wordId")
        return if (file.exists() && file.length() > 0) file else null
    }

    suspend fun downloadWordVideo(context: Context, wordId: Int, url: String): File? {
        return withContext(Dispatchers.IO) {
            val dest = File(context.filesDir, "wb_video_$wordId")
            // Same retry as the bulk path, so both behave alike on a flaky connection.
            val ok = downloadWithRetry(url, dest)
            if (ok) dest else null
        }
    }

    // ── Bulk demo-video download ─────────────────────────────────
    // Same cache keys as the single tap-to-download path above, so the two
    // interoperate: whatever the batch saves, WordDetailActivity plays offline,
    // and whatever the batch failed to fetch stays tappable per-word.

    /** Snapshot of a bulk download in flight. [currentLabel] is the word being fetched. */
    data class VideoDownloadProgress(
        val completed: Int,
        val total: Int,
        val failed: Int,
        val currentLabel: String?
    )

    /**
     * Words that have a demo video on the server but no cached copy on disk yet.
     *
     * A word whose URL cannot be resolved is excluded rather than counted as a failure:
     * no amount of retrying fixes it, so including it would only inflate the batch total
     * and make the completion message read as if the network misbehaved.
     */
    fun pendingVideoDownloads(context: Context, words: List<WordBankWord>): List<WordBankWord> =
        words.filter {
            !it.video_url.isNullOrBlank() &&
                !ApiClient.resolveUrl(it.video_url).isNullOrBlank() &&
                getLocalVideo(context, it.id) == null
        }

    /** How many of [words] already have their demo video cached locally. */
    fun cachedVideoCount(context: Context, words: List<WordBankWord>): Int =
        words.count { getLocalVideo(context, it.id) != null }

    /** Total bytes on disk for the cached demo videos of [words]. */
    fun cachedVideoBytes(context: Context, words: List<WordBankWord>): Long =
        words.sumOf { getLocalVideo(context, it.id)?.length() ?: 0L }

    /** Deletes every cached demo video for [words]. Returns how many files were removed. */
    suspend fun clearCachedVideos(context: Context, words: List<WordBankWord>): Int {
        return withContext(Dispatchers.IO) {
            var removed = 0
            for (word in words) {
                val file = getLocalVideo(context, word.id) ?: continue
                if (file.delete()) removed++ else Log.w(TAG, "Could not delete video for word ${word.id}")
            }
            Log.i(TAG, "Cleared $removed cached demo video(s)")
            removed
        }
    }

    /**
     * Downloads every missing demo video in [words], one at a time.
     *
     * Already-cached files are skipped, so cancelling and re-running resumes
     * where it left off instead of starting over. A single failure never aborts
     * the batch — it is counted in [VideoDownloadProgress.failed] and the loop
     * continues, matching how [downloadWordBankImages] treats thumbnails.
     *
     * Cancellation takes effect immediately, including mid-file: the in-flight OkHttp call
     * is aborted so the user never waits out the 120s read timeout, and the partial `.tmp`
     * is discarded. Whole files already on disk are kept.
     *
     * [onProgress] is invoked on the IO dispatcher — callers touching views must
     * hop to the main thread themselves.
     */
    suspend fun downloadAllWordVideos(
        context: Context,
        words: List<WordBankWord>,
        onProgress: (VideoDownloadProgress) -> Unit
    ): VideoDownloadProgress {
        return withContext(Dispatchers.IO) {
            val pending = pendingVideoDownloads(context, words)
            val total = pending.size
            var completed = 0
            var failed = 0

            // Abort whatever download is in flight the moment this coroutine is cancelled,
            // instead of letting copyTo run to completion on a file nobody wants anymore.
            val inFlight = java.util.concurrent.atomic.AtomicReference<Call?>(null)
            val cancelHandle = coroutineContext[Job]?.invokeOnCompletion { cause ->
                if (cause != null) inFlight.get()?.cancel()
            }

            try {
                onProgress(VideoDownloadProgress(0, total, 0, null))

                for (word in pending) {
                    ensureActive()
                    onProgress(VideoDownloadProgress(completed, total, failed, word.label))

                    val dest = File(context.filesDir, "wb_video_${word.id}")
                    val job = coroutineContext[Job]

                    // pendingVideoDownloads guarantees this resolves; count it rather than
                    // skipping so completed + failed always reconciles with total, even if
                    // that filter and this loop ever drift apart.
                    val url = ApiClient.resolveUrl(word.video_url)
                    val ok = if (url.isNullOrBlank()) {
                        Log.w(TAG, "Unresolvable video URL for word ${word.id} reached the batch loop")
                        false
                    } else {
                        downloadWithRetry(
                            url,
                            dest,
                            onCall = { call -> inFlight.set(call) },
                            shouldRetry = { job?.isActive != false }
                        )
                    }
                    inFlight.set(null)

                    // Cancelling aborts the in-flight call, which reads as an ordinary
                    // failure above. Bail out before tallying it so a cancelled word is
                    // never counted as failed.
                    ensureActive()

                    if (ok) {
                        completed++
                    } else {
                        failed++
                        Log.w(TAG, "Demo video download failed for word ${word.id}")
                    }
                    onProgress(VideoDownloadProgress(completed, total, failed, word.label))
                }
            } finally {
                cancelHandle?.dispose()
            }

            Log.i(TAG, "Bulk demo-video download finished: $completed ok, $failed failed of $total")
            VideoDownloadProgress(completed, total, failed, null)
        }
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
                
                // Download labels only if the backend provides a URL.
                val labelsUrl = model.labels_motion_url
                if (!labelsUrl.isNullOrBlank()) {
                    val labelsDest = File(context.filesDir, "labels_motion.json")
                    downloadToFile(labelsUrl, labelsDest)
                    Log.d(TAG, "Labels downloaded: ${labelsDest.exists()}")
                } else {
                    Log.w(TAG, "No labels URL returned by backend; continuing")
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
