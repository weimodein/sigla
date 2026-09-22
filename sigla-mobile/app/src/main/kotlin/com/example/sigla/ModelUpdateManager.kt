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
    // Tracked separately from KEY_VERSION: the alphabet is deployed on its own
    // schedule, so its version moves independently of the words model's and one
    // key could not say whether either was current.
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

    private fun getCachedStaticUrl(context: Context): String? =
        prefs(context).getString(KEY_STATIC_URL, null)

    // The motion model is the only model. hasLocalModel and hasLocalMotionModel
    // are kept as aliases so existing callers compile unchanged.
    //
    // NOTE: this checks the .tflite ONLY. Labels are NOT optional — the word-bank
    // fallback this comment used to describe was deleted, and PredictionService now
    // refuses to load a model without labels_motion.json. Callers that need to know
    // the model is actually usable must check hasLocalLabels() too.
    fun hasLocalModel(context: Context): Boolean {
        return File(context.filesDir, "sign_model_motion.tflite").exists()
    }

    /**
     * The model is unusable without its label map — the .tflite emits class
     * indices and only labels_motion.json says what those indices mean.
     */
    private fun hasLocalLabels(context: Context): Boolean =
        File(context.filesDir, "labels_motion.json").exists()

    fun hasLocalMotionModel(context: Context): Boolean = hasLocalModel(context)

    /**
     * Whether the locally-installed alphabet matches the deployed one.
     *
     * The words model being current does NOT mean the device is current: the
     * alphabet is deployed on its own schedule and lives in its own files, so
     * "up to date" has to account for both or a phone with the right words model
     * never downloads the letters at all.
     *
     * A null `info` means the backend has no alphabet deployed, in which case
     * having no local copy IS current — and having one means it must be removed.
     */
    private fun lettersUpToDate(context: Context, info: ModelInfo?): Boolean {
        val modelFile  = File(context.filesDir, "sign_model_letters.tflite")
        val labelsFile = File(context.filesDir, "labels_letters.json")
        if (info == null || info.tflite_url.isNullOrBlank()) {
            return !modelFile.exists() && !labelsFile.exists()
        }
        return info.version_number == prefs(context).getString(KEY_LETTERS_VERSION, null) &&
            modelFile.exists() &&
            labelsFile.exists()
    }

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
     * For the cases where waiting minutes would be wrong: a fresh login, or a
     * user explicitly asking to check for updates.
     */
    fun invalidateCheckThrottle() {
        lastCheckAt = 0L
    }

    /**
     * @param force skip the throttle and always reach the backend.
     */
    suspend fun checkAndUpdate(
        context: Context,
        token: String?,
        force: Boolean = false,
    ): Boolean {
        return withContext(Dispatchers.IO) {
            // Reset per call — a failed check must not leave a stale "changed"
            // flag from a previous launch telling the caller to refetch.
            lastCheckChangedVersion = false

            // Skip the round trip when a recent check already confirmed this
            // device is current. Only when the model is actually USABLE: a
            // device missing its .tflite or labels must keep asking, or a failed
            // first download would leave it stuck with no model until the
            // interval expired.
            //
            // Whether an ALPHABET is deployed cannot be known without asking, so
            // a device that has none installed never skips. Otherwise a phone
            // that was current before the alphabet existed would sit behind this
            // throttle and never discover it. Once one is installed, a later
            // change to it is picked up when the interval lapses.
            val sinceLast = android.os.SystemClock.elapsedRealtime() - lastCheckAt
            if (!force &&
                lastCheckAt > 0L &&
                sinceLast < CHECK_INTERVAL_MS &&
                hasLocalModel(context) &&
                hasLocalLabels(context) &&
                File(context.filesDir, "sign_model_letters.tflite").exists() &&
                File(context.filesDir, "labels_letters.json").exists()
            ) {
                Log.i(TAG, "Skipping model check — last one was ${sinceLast / 1000}s ago")
                return@withContext true
            }
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
                val localModelFile = File(context.filesDir, "sign_model_motion.tflite")
                val expectedChecksum = model.checksum
                val localChecksumMatches = expectedChecksum.isNullOrBlank() ||
                    (localModelFile.exists() &&
                        computeSha256(localModelFile).equals(expectedChecksum, ignoreCase = true))

                // A matching version/URL is only "up to date" if BOTH files are
                // present and the local model checksum still matches the deployed
                // bytes. Retraining under the same version otherwise left the phone
                // permanently using its old cached model.
                // Without the labels check, a device missing labels_motion.json (the
                // labels download used to be optional) would report itself current
                // forever and never recover.
                val lettersInfo = response.body()?.models?.letters

                if (remoteVersion == cachedVersion &&
                    remoteModelUrl == getCachedStaticUrl(context) &&
                    hasLocalModel(context) &&
                    hasLocalLabels(context) &&
                    localChecksumMatches
                ) {
                    // The WORDS model is current — but the alphabet is deployed
                    // separately and may not be. This early return used to fire
                    // here and skip syncLettersModel entirely, so a phone with the
                    // right words model never downloaded the letters at all.
                    if (!lettersUpToDate(context, lettersInfo)) {
                        Log.i(TAG, "Words model current but alphabet is not — syncing it")
                        if (syncLettersModel(context, lettersInfo)) {
                            lastCheckChangedVersion = true
                            invalidateWordBankCache(context)
                        }
                    }
                    Log.i(TAG, "Model up-to-date (v$remoteVersion)")
                    // Timestamped only on a check that actually reached the
                    // backend and found this device current, so a failed request
                    // or a partial download never buys silence.
                    lastCheckAt = android.os.SystemClock.elapsedRealtime()
                    return@withContext true
                }

                Log.i(TAG, "New model version detected: $remoteVersion (cached: $cachedVersion) — downloading")

                // A version change means the server-side word bank changed with
                // it. Drop the cached list now so no code path can serve words
                // belonging to the version being replaced; the caller refetches
                // once the new model is in place. Note this fires on a REVERT
                // too — remoteVersion simply differs from cachedVersion.
                if (remoteVersion != cachedVersion) {
                    lastCheckChangedVersion = true
                    invalidateWordBankCache(context)
                }

                // ── Motion model (required) ───────────────────────────────────
                if (remoteModelUrl.isNullOrBlank()) {
                    Log.e(TAG, "Backend returned no model URL — check SUPABASE_URL on server")
                    return@withContext hasLocalModel(context)
                }
                // ── Motion labels URL must exist before we download anything ──
                // This file is the class-index → word map the model was trained
                // with. There is no fallback: PredictionService refuses to load a
                // model without it, because guessing the mapping from another
                // source reports real predictions under the wrong words.
                val labelsMotionUrl = model.labels_motion_url
                if (labelsMotionUrl.isNullOrBlank()) {
                    Log.e(TAG, "Backend returned no motion labels URL — cannot use this model version")
                    return@withContext hasLocalModel(context) && hasLocalLabels(context)
                }

                // ── Stage BOTH files, verify BOTH, then swap BOTH in ─────────
                // The model and its labels are a matched pair: index N only means
                // the right word if both came from the same training run. This used
                // to swap the model into place first and download labels after, so a
                // failed labels download left a NEW model live against OLD labels —
                // every prediction confidently mislabelled. PredictionService's count
                // check only catches that when the class count also changed, which is
                // exactly the case a word-swap retrain does not produce.
                val modelDest  = localModelFile
                val labelsDest = File(context.filesDir, "labels_motion.json")
                val modelStaging  = File(context.filesDir, "sign_model_motion.tflite.staging")
                val labelsStaging = File(context.filesDir, "labels_motion.json.staging")

                if (!downloadAndVerifyToStaging(remoteModelUrl, modelStaging, expectedChecksum)) {
                    Log.e(TAG, "Motion model download/verify failed — keeping existing model if any")
                    modelStaging.delete()
                    return@withContext hasLocalModel(context)
                }
                Log.i(TAG, "Motion TFLite downloaded + verified (staged)")

                if (!downloadToFile(labelsMotionUrl, labelsStaging)) {
                    Log.e(TAG, "Motion labels download failed — keeping the previous model/labels pair")
                    modelStaging.delete()
                    labelsStaging.delete()
                    return@withContext hasLocalModel(context) && hasLocalLabels(context)
                }
                Log.i(TAG, "Motion labels downloaded (staged)")

                // Both verified — commit them together.
                if (!swapIntoPlace(modelStaging, modelDest)) {
                    Log.e(TAG, "Failed to install staged model — keeping existing pair")
                    modelStaging.delete()
                    labelsStaging.delete()
                    return@withContext hasLocalModel(context) && hasLocalLabels(context)
                }
                if (!swapIntoPlace(labelsStaging, labelsDest)) {
                    // The model is already live and now outranks its labels. Delete the
                    // labels so PredictionService refuses to load rather than pairing the
                    // new model with the old map, and so the next check re-downloads both.
                    Log.e(TAG, "Failed to install staged labels — removing labels to force a clean retry")
                    labelsDest.delete()
                    labelsStaging.delete()
                    return@withContext false
                }
                Log.i(TAG, "Model + labels installed together")

                // ── Alphabet model (optional) ────────────────────────────────
                // Deployed separately from the words model, because a letter and
                // the day sign built from it differ only in motion and separate
                // too tightly to share a class list. Absent on any backend with
                // no letters model deployed, and on older backends that do not
                // send the `models` map at all — in both cases the app stays
                // words-only and the toggle hides itself.
                //
                // Deliberately NOT fatal: the words model is already live and
                // usable at this point, so a failed alphabet download must not
                // make the whole update report failure and roll the user back to
                // no recognition at all.
                // The word bank is the UNION of both deployed models' words, so a
                // changed alphabet invalidates it just as a changed words model
                // does — otherwise letters never appear in browsing until the
                // words version happens to move.
                if (syncLettersModel(context, response.body()?.models?.letters)) {
                    lastCheckChangedVersion = true
                    invalidateWordBankCache(context)
                }

                // ── Save version + URL only after all required files succeeded ──
                // Recorded last, and skipped entirely on any failure above, so a
                // half-updated device retries instead of believing it is current.
                prefs(context).edit()
                    .putString(KEY_VERSION, remoteVersion)
                    .putString(KEY_STATIC_URL, remoteModelUrl)
                    .apply()
                Log.i(TAG, "Model updated to $remoteVersion")
                lastCheckAt = android.os.SystemClock.elapsedRealtime()
                true
            } catch (e: Exception) {
                Log.e(TAG, "Model update failed: ${e.message}", e)
                hasLocalModel(context)
            }
        }
    }

    /**
     * Download [url] into [staging] and verify its SHA-256 against [expectedChecksum].
     *
     * Leaves the verified bytes in [staging] WITHOUT installing them — the caller
     * commits it with [swapIntoPlace] only once every file in the update has been
     * verified, so the model and its labels always land together. No live file is
     * touched here, so a bad or stale download cannot destroy the last-good model.
     *
     * On checksum mismatch it retries ONCE with a cache-busting query param, which
     * defeats a stale Supabase CDN copy served at the fixed deployed/ path.
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
    /**
     * Installs (or removes) the optional alphabet model.
     *
     * Same staged matched-pair discipline as the words model: the .tflite and
     * its labels are downloaded to staging, verified, and only then swapped in
     * together, because index N only means the right letter if both came from
     * the same training run.
     *
     * Never throws and never reports failure upward. It runs after the words
     * model is already live, so a failed alphabet download leaves the app fully
     * usable with words alone — turning that into an update failure would roll
     * the user back to no recognition at all.
     *
     * A null `info` means the backend has no alphabet deployed (or predates the
     * split). The local files are then DELETED rather than left behind, so
     * reverting the alphabet server-side actually takes it off the phone instead
     * of leaving a stale model the toggle still offers.
     */
    private fun syncLettersModel(context: Context, info: ModelInfo?): Boolean {
        val modelDest  = File(context.filesDir, "sign_model_letters.tflite")
        val labelsDest = File(context.filesDir, "labels_letters.json")

        try {
            val url = info?.tflite_url
            val labelsUrl = info?.labels_motion_url
            if (info == null || url.isNullOrBlank() || labelsUrl.isNullOrBlank()) {
                if (modelDest.exists() || labelsDest.exists()) {
                    Log.i(TAG, "No alphabet model deployed — removing the local copy")
                    modelDest.delete()
                    labelsDest.delete()
                    prefs(context).edit().remove(KEY_LETTERS_VERSION).apply()
                    // The alphabet just left the phone, so the word bank —
                    // which is the union of both models — is now stale.
                    return true
                }
                return false
            }

            // Up to date when the version matches AND both files are present —
            // the same two-part check the words model uses, for the same reason:
            // a version match alone would strand a device that lost one file.
            if (info.version_number == prefs(context).getString(KEY_LETTERS_VERSION, null) &&
                modelDest.exists() && labelsDest.exists()
            ) {
                Log.i(TAG, "Alphabet model up-to-date (v${info.version_number})")
                return false
            }

            val modelStaging  = File(context.filesDir, "sign_model_letters.tflite.staging")
            val labelsStaging = File(context.filesDir, "labels_letters.json.staging")

            if (!downloadAndVerifyToStaging(url, modelStaging, info.checksum)) {
                Log.w(TAG, "Alphabet model download/verify failed — keeping words-only")
                modelStaging.delete()
                return false
            }
            if (!downloadToFile(labelsUrl, labelsStaging)) {
                Log.w(TAG, "Alphabet labels download failed — keeping words-only")
                modelStaging.delete()
                labelsStaging.delete()
                return false
            }
            if (!swapIntoPlace(modelStaging, modelDest)) {
                Log.w(TAG, "Failed to install staged alphabet model")
                modelStaging.delete()
                labelsStaging.delete()
                return false
            }
            if (!swapIntoPlace(labelsStaging, labelsDest)) {
                // The model is live and now outranks its labels. Delete BOTH so
                // PredictionService skips the alphabet entirely rather than
                // pairing it with a stale map, and the next check retries clean.
                Log.w(TAG, "Failed to install staged alphabet labels — removing the pair")
                modelDest.delete()
                labelsStaging.delete()
                // The pair was removed, so whatever the word bank held for the
                // alphabet is no longer backed by a model on this device.
                return true
            }

            prefs(context).edit()
                .putString(KEY_LETTERS_VERSION, info.version_number)
                .apply()
            Log.i(TAG, "Alphabet model installed (v${info.version_number})")
            return true
        } catch (e: Exception) {
            Log.w(TAG, "Alphabet sync failed — continuing words-only: ${e.message}")
            return false
        }
    }

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
