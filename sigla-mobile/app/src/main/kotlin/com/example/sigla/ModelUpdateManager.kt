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
    private const val KEY_ACTIVE_BUNDLE = "active_model_bundle"
    private const val BUNDLE_ROOT = "model_bundles"
    // Kept only so an upgrade can clean up the superseded independent version.
    private const val KEY_LETTERS_VERSION = "cached_letters_version"
    private const val WORD_BANK_CACHE_FILE = "word_bank_cache.json"
    private const val CATEGORIES_CACHE_FILE = "categories_cache.json"

    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private val gson = Gson()

    // Hoisted out of the load functions: an anonymous TypeToken was being
    // allocated on every cache read.
    private val WORD_BANK_TYPE  = object : TypeToken<List<WordBankWord>>() {}.type
    private val CATEGORIES_TYPE = object : TypeToken<List<CategoryItem>>() {}.type

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun getCachedVersion(context: Context): String? =
        prefs(context).getString(KEY_VERSION, null)

    private fun activeBundleDir(context: Context): File? =
        prefs(context).getString(KEY_ACTIVE_BUNDLE, null)?.let { name ->
            File(File(context.filesDir, BUNDLE_ROOT), name)
        }

    /** Resolve a model file from the active bundle, falling back to legacy installs. */
    fun getInstalledModelFile(context: Context, filename: String): File {
        val bundle = activeBundleDir(context)
        return if (bundle != null) File(bundle, filename) else File(context.filesDir, filename)
    }

    fun hasActiveModelBundle(context: Context): Boolean = activeBundleDir(context) != null

    fun hasLocalModel(context: Context): Boolean {
        return getInstalledModelFile(context, "sign_model_motion.tflite").exists()
    }

    /**
     * The model is unusable without its label map — the .tflite emits class
     * indices and only labels_motion.json says what those indices mean.
     */
    private fun hasLocalLabels(context: Context): Boolean =
        getInstalledModelFile(context, "labels_motion.json").exists()

    fun hasLocalMotionModel(context: Context): Boolean = hasLocalModel(context)

    private fun hasCompleteLocalPair(context: Context): Boolean =
        hasLocalModel(context) &&
            hasLocalLabels(context) &&
            getInstalledModelFile(context, "sign_model_letters.tflite").exists() &&
            getInstalledModelFile(context, "labels_letters.json").exists()

    /**
     * Set by [checkAndUpdate] when the deployed version differs from what this
     * device last cached — including a REVERT to an older version, which changes
     * the word bank just as much as an upgrade does.
     *
     * The word bank is derived server-side from the deployed model, so a version
     * change invalidates the cached word list. Callers read this immediately
     * after checkAndUpdate() to force a refetch in the same pass, instead of
     * showing words the newly-installed model cannot predict until some later
     * screen visit happens to refresh them.
     */
    @Volatile
    var lastCheckChangedVersion: Boolean = false
        private set

    /**
     * elapsedRealtime of the last check that actually reached the backend, or 0
     * when none has. Process-level rather than per-Activity, so leaving the
     * camera screen and coming back does not reset it.
     */
    @Volatile
    private var lastCheckAt: Long = 0L

    /**
     * How long a successful check stays good for.
     *
     * The camera screen releases its models in onStop and rebuilds them in
     * onStart, so every return to it used to make a fresh /models/latest round
     * trip before anything could load — a network wait on a path where nothing
     * has usually changed. A deploy is a deliberate, infrequent act by an
     * administrator, so a few minutes of staleness costs nothing and the check
     * still happens often enough to pick one up within a session.
     */
    private const val CHECK_INTERVAL_MS = 5 * 60 * 1000L

    /**
     * Drops the throttle so the next [checkAndUpdate] talks to the backend.
     *
     * Used when a caller explicitly asks to check for updates.
     */
    fun invalidateCheckThrottle() {
        lastCheckAt = 0L
    }

    /**
     * @param force skip the throttle and always reach the backend.
     */
    suspend fun checkAndUpdate(
        context: Context,
        force: Boolean = false,
    ): Boolean = withContext(Dispatchers.IO) {
        lastCheckChangedVersion = false
        val sinceLast = android.os.SystemClock.elapsedRealtime() - lastCheckAt
        if (!force && lastCheckAt > 0L && sinceLast < CHECK_INTERVAL_MS && hasCompleteLocalPair(context)) {
            return@withContext true
        }

        try {
            val response = ApiClient.get().getLatestModel()
            if (!response.isSuccessful) {
                Log.w(TAG, "Failed to fetch model pair: ${response.code()}")
                return@withContext hasCompleteLocalPair(context)
            }

            val body = response.body() ?: return@withContext hasCompleteLocalPair(context)
            val words = body.models?.words ?: body.model
            val letters = body.models?.letters
            val deploymentVersion = body.deployment_version ?: words.version_number
            if (letters == null ||
                words.version_number != deploymentVersion ||
                letters.version_number != deploymentVersion
            ) {
                Log.e(TAG, "Backend returned an incomplete or mixed model pair")
                return@withContext hasCompleteLocalPair(context)
            }

            val current = getCachedVersion(context)
            val wordsFile = getInstalledModelFile(context, "sign_model_motion.tflite")
            val lettersFile = getInstalledModelFile(context, "sign_model_letters.tflite")
            val checksumsMatch =
                (words.checksum.isNullOrBlank() ||
                    (wordsFile.exists() && computeSha256(wordsFile).equals(words.checksum, true))) &&
                (letters.checksum.isNullOrBlank() ||
                    (lettersFile.exists() && computeSha256(lettersFile).equals(letters.checksum, true)))

            if (!force && current == deploymentVersion && hasCompleteLocalPair(context) && checksumsMatch) {
                lastCheckAt = android.os.SystemClock.elapsedRealtime()
                return@withContext true
            }

            val wordsUrl = words.tflite_url
            val wordsLabelsUrl = words.labels_motion_url
            val lettersUrl = letters.tflite_url
            val lettersLabelsUrl = letters.labels_motion_url
            if (wordsUrl.isNullOrBlank() || wordsLabelsUrl.isNullOrBlank() ||
                lettersUrl.isNullOrBlank() || lettersLabelsUrl.isNullOrBlank()
            ) {
                Log.e(TAG, "Backend returned a model pair with missing artifact URLs")
                return@withContext hasCompleteLocalPair(context)
            }

            val root = File(context.filesDir, BUNDLE_ROOT).apply { mkdirs() }
            val safeVersion = deploymentVersion.replace(Regex("[^A-Za-z0-9._-]"), "_")
            val bundleName = "$safeVersion-${System.nanoTime()}"
            val staging = File(root, ".$bundleName.staging")
            if (staging.exists()) staging.deleteRecursively()
            if (!staging.mkdirs()) {
                Log.e(TAG, "Could not create model staging directory")
                return@withContext hasCompleteLocalPair(context)
            }

            val stagedWords = File(staging, "sign_model_motion.tflite")
            val stagedWordsLabels = File(staging, "labels_motion.json")
            val stagedLetters = File(staging, "sign_model_letters.tflite")
            val stagedLettersLabels = File(staging, "labels_letters.json")

            val staged =
                downloadAndVerifyToStaging(wordsUrl, stagedWords, words.checksum) &&
                downloadToFile(wordsLabelsUrl, stagedWordsLabels) &&
                downloadAndVerifyToStaging(lettersUrl, stagedLetters, letters.checksum) &&
                downloadToFile(lettersLabelsUrl, stagedLettersLabels)
            if (!staged ||
                !labelsFileIsValid(stagedWordsLabels, words.total_classes) ||
                !labelsFileIsValid(stagedLettersLabels, letters.total_classes)
            ) {
                Log.e(TAG, "Model pair download or validation failed; keeping the active bundle")
                staging.deleteRecursively()
                return@withContext hasCompleteLocalPair(context)
            }

            val installed = File(root, bundleName)
            if (installed.exists() && !installed.deleteRecursively()) {
                staging.deleteRecursively()
                return@withContext hasCompleteLocalPair(context)
            }
            if (!staging.renameTo(installed)) {
                Log.e(TAG, "Could not finalize the staged model bundle")
                staging.deleteRecursively()
                return@withContext hasCompleteLocalPair(context)
            }

            // One synchronous preference commit is the activation point. Until
            // it succeeds, PredictionService continues resolving the old bundle.
            val activated = prefs(context).edit()
                .putString(KEY_ACTIVE_BUNDLE, bundleName)
                .putString(KEY_VERSION, deploymentVersion)
                .remove(KEY_LETTERS_VERSION)
                .commit()
            if (!activated) {
                installed.deleteRecursively()
                return@withContext hasCompleteLocalPair(context)
            }

            root.listFiles()?.forEach { candidate ->
                if (candidate != installed) candidate.deleteRecursively()
            }
            lastCheckChangedVersion = current != deploymentVersion
            if (lastCheckChangedVersion) invalidateWordBankCache(context)
            lastCheckAt = android.os.SystemClock.elapsedRealtime()
            Log.i(TAG, "Activated complete model pair $deploymentVersion")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Model pair update failed: ${e.message}", e)
            hasCompleteLocalPair(context)
        }
    }

    private fun labelsFileIsValid(file: File, expectedCount: Int?): Boolean {
        return try {
            val labels = org.json.JSONObject(file.readText())
            if (labels.length() == 0 || (expectedCount != null && labels.length() != expectedCount)) {
                return false
            }
            (0 until labels.length()).all { index ->
                labels.has(index.toString()) && labels.optString(index.toString()).isNotBlank()
            }
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Download [url] into [staging] and verify its SHA-256 against [expectedChecksum].
     *
     * Leaves verified bytes in [staging]. The bundle pointer changes only after
     * every file has passed validation, so no live file is touched here.
     *
     * On checksum mismatch it retries once with a cache-busting query parameter.
     *
     * Returns true only when [staging] holds verified bytes. If [expectedChecksum]
     * is blank, integrity checking is skipped but the download still lands in staging.
     */
    private fun downloadAndVerifyToStaging(url: String, staging: File, expectedChecksum: String?): Boolean {
        // Try the plain URL first, then a cache-busted URL if the checksum fails.
        val attempts = listOf(url, appendCacheBuster(url))
        for ((index, attemptUrl) in attempts.withIndex()) {
            if (!downloadToFile(attemptUrl, staging)) {
                Log.w(TAG, "Download attempt ${index + 1} failed for model")
                continue
            }
            if (expectedChecksum.isNullOrBlank()) {
                Log.w(TAG, "No checksum provided by server — skipping integrity check")
                return true
            }
            val actual = computeSha256(staging)
            if (actual == expectedChecksum) {
                Log.i(TAG, "Checksum verified OK")
                return true
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
    // Append a cache-busting query param, preserving any existing query string.
    private fun appendCacheBuster(url: String): String {
        val sep = if (url.contains("?")) "&" else "?"
        return "$url${sep}cb=${System.nanoTime()}"
    }

    /**
     * Download [url] to [dest], retrying ONCE with a cache-buster on failure. The retry
     * rides out a transient network blip and also defeats a stale CDN copy, mirroring the
     * attempt list in [downloadAndVerifyToStaging].
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

    // Suspend + IO: this reads and Gson-parses the entire word bank, and was
    // being called from lifecycleScope.launch (the Main dispatcher) during
    // WordBankActivity.onCreate — blocking the first frame.
    suspend fun loadCachedWordBank(context: Context): List<WordBankWord>? =
        withContext(Dispatchers.IO) {
            val file = File(context.filesDir, WORD_BANK_CACHE_FILE)
            if (!file.exists()) return@withContext null
            try {
                gson.fromJson<List<WordBankWord>>(file.readText(), WORD_BANK_TYPE)
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

    /**
     * Drops the cached word list after the deployed model version changes.
     *
     * The server derives the word bank from the deployed version, so a cache
     * written under the previous version may name words the new model cannot
     * predict — or omit ones it can. Deleting it means the offline fallback
     * cannot serve a mismatched list; the next fetch repopulates it.
     *
     * Called from checkAndUpdate, which already runs on Dispatchers.IO.
     */
    private fun invalidateWordBankCache(context: Context) {
        val file = File(context.filesDir, WORD_BANK_CACHE_FILE)
        if (file.exists() && file.delete()) {
            Log.i(TAG, "Word bank cache invalidated — deployed model version changed")
        }
    }

    suspend fun loadCachedCategories(context: Context): List<CategoryItem>? =
        withContext(Dispatchers.IO) {
            val file = File(context.filesDir, CATEGORIES_CACHE_FILE)
            if (!file.exists()) return@withContext null
            try {
                gson.fromJson<List<CategoryItem>>(file.readText(), CATEGORIES_TYPE)
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
    suspend fun forceDownloadModel(context: Context): Boolean {
        return checkAndUpdate(context, force = true)
    }
}
