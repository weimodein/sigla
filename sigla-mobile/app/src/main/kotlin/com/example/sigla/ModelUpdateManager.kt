package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

object ModelUpdateManager {

    private const val TAG         = "ModelUpdateManager"
    private const val PREFS       = "model_cache"
    private const val KEY_VERSION = "cached_version"

    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    // Files downloaded from the deployed/ Supabase folder
    private val MODEL_FILES = listOf(
        "tflite_url"        to "sign_model_static.tflite",
        "motion_tflite_url" to "sign_model_motion.tflite",
        "labels_static_url" to "labels_static.json",
        "labels_motion_url" to "labels_motion.json",
        "word_bank_url"     to "word_bank.json",
    )

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun getCachedVersion(context: Context): String? =
        prefs(context).getString(KEY_VERSION, null)

    /**
     * Check if a newer model is deployed. If so, download all model files +
     * word_bank.json to internal storage and save the new version number.
     * Safe to call on every app launch — no-op if already up-to-date.
     */
    /**
     * Returns true if all required local model files exist on disk.
     */
    fun hasLocalModel(context: Context): Boolean {
        return listOf(
            "sign_model_static.tflite",
            "labels_static.json"
        ).all { File(context.filesDir, it).exists() }
    }

    suspend fun checkAndUpdate(context: Context, token: String?): Boolean {
        return withContext(Dispatchers.IO) {
            try {
                Log.i(TAG, "Checking for model updates…")
                val response = ApiClient.get(token).getLatestModel()
                Log.i(TAG, "getLatestModel HTTP ${response.code()}")
                if (!response.isSuccessful) {
                    Log.e(TAG, "getLatestModel failed: ${response.errorBody()?.string()}")
                    return@withContext hasLocalModel(context)
                }

                val model = response.body()?.model
                if (model == null) {
                    Log.e(TAG, "getLatestModel body is null")
                    return@withContext hasLocalModel(context)
                }
                Log.i(TAG, "Remote: ${model.version_number} tflite=${model.tflite_url} labels=${model.labels_static_url}")

                val remoteVersion    = model.version_number
                val cachedVersion    = getCachedVersion(context)
                val versionChanged   = remoteVersion != cachedVersion
                val modelFileMissing = !hasLocalModel(context)

                // Always re-download word_bank.json — tiny file, updated every deploy
                model.word_bank_url?.let { downloadFile(context, it, "word_bank.json") }

                if (!versionChanged && !modelFileMissing) {
                    Log.i(TAG, "Model up-to-date: $remoteVersion")
                    return@withContext true
                }

                Log.i(TAG, "Downloading model $remoteVersion (newVersion=$versionChanged, missing=$modelFileMissing)")

                val urlMap = mapOf(
                    "tflite_url"        to model.tflite_url,
                    "motion_tflite_url" to model.motion_tflite_url,
                    "labels_static_url" to model.labels_static_url,
                    "labels_motion_url" to model.labels_motion_url,
                )

                for ((key, filename) in MODEL_FILES.filter { it.second != "word_bank.json" }) {
                    val url = urlMap[key] ?: continue
                    val ok  = downloadFile(context, url, filename)
                    if (!ok && (filename == "sign_model_static.tflite" || filename == "labels_static.json")) {
                        Log.e(TAG, "Critical download failed: $filename")
                        return@withContext hasLocalModel(context)
                    }
                }

                prefs(context).edit().putString(KEY_VERSION, remoteVersion).apply()
                Log.i(TAG, "Model ready: $remoteVersion")
                true

            } catch (e: Exception) {
                Log.e(TAG, "Model update failed: ${e.message}", e)
                hasLocalModel(context)
            }
        }
    }

    private suspend fun downloadFile(context: Context, url: String, filename: String): Boolean =
        withContext(Dispatchers.IO) {
            try {
                Log.i(TAG, "Downloading $filename from $url")
                val request  = Request.Builder().url(url).build()
                val response = http.newCall(request).execute()
                if (!response.isSuccessful) {
                    Log.w(TAG, "Skipping $filename — HTTP ${response.code}")
                    response.close()
                    return@withContext false
                }
                val bytes = response.body?.bytes() ?: run {
                    Log.w(TAG, "Empty body for $filename")
                    response.close()
                    return@withContext false
                }
                response.close()
                File(context.filesDir, filename).writeBytes(bytes)
                Log.i(TAG, "Saved $filename (${bytes.size / 1024} KB)")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to download $filename: ${e.message}")
                false
            }
        }

    /**
     * Returns the local cached file if it exists, otherwise null.
     * PredictionService uses this to prefer downloaded models over bundled assets.
     */
    fun getLocalFile(context: Context, filename: String): File? {
        val file = File(context.filesDir, filename)
        return if (file.exists()) file else null
    }

    /**
     * Load word_bank.json from local cache. Returns null if not cached yet.
     */
    fun loadCachedWordBank(context: Context): List<WordBankWord>? {
        val file = getLocalFile(context, "word_bank.json") ?: return null
        return try {
            val json  = org.json.JSONObject(file.readText())
            val array = json.optJSONArray("words") ?: return null
            (0 until array.length()).map { i ->
                val obj = array.getJSONObject(i)
                WordBankWord(
                    id                   = obj.getInt("id"),
                    label                = obj.getString("label"),
                    description          = obj.optString("description").takeIf { it.isNotBlank() },
                    sign_type            = obj.optString("sign_type", "FSL"),
                    category             = obj.optString("category", "Additional Words"),
                    hands_count          = obj.optInt("hands_count", 1),
                    gesture_type         = obj.optString("gesture_type", "static"),
                    thumbnail_url        = obj.optString("thumbnail_url").takeIf { it.isNotBlank() },
                    video_url            = obj.optString("video_url").takeIf { it.isNotBlank() },
                    filipino_translation = obj.optString("filipino_translation").takeIf { it.isNotBlank() },
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse cached word bank: ${e.message}")
            null
        }
    }
}
