package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.io.File
import java.net.URL

object ModelUpdateManager {

    private const val TAG         = "ModelUpdateManager"
    private const val PREFS       = "model_cache"
    private const val KEY_VERSION = "cached_version"

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
    suspend fun checkAndUpdate(context: Context, token: String?) {
        try {
            val response = ApiClient.get(token).getLatestModel()
            if (!response.isSuccessful) return

            val model = response.body()?.model ?: return
            val remoteVersion = model.version_number
            val cachedVersion = getCachedVersion(context)

            if (remoteVersion == cachedVersion) {
                Log.i(TAG, "Model up-to-date: $remoteVersion")
                return
            }

            Log.i(TAG, "New model available: $remoteVersion (was: $cachedVersion)")

            // Build URL map from the model response
            val urlMap = mapOf(
                "tflite_url"        to model.tflite_url,
                "motion_tflite_url" to model.motion_tflite_url,
                "labels_static_url" to model.labels_static_url,
                "labels_motion_url" to model.labels_motion_url,
                "word_bank_url"     to model.word_bank_url,
            )

            var allSuccess = true
            for ((key, filename) in MODEL_FILES) {
                val url = urlMap[key] ?: continue
                val ok  = downloadFile(context, url, filename)
                if (!ok && filename.endsWith(".tflite")) {
                    // Critical file failed — abort, keep old version
                    Log.e(TAG, "Critical download failed: $filename — keeping current version")
                    allSuccess = false
                    break
                }
            }

            if (allSuccess) {
                prefs(context).edit().putString(KEY_VERSION, remoteVersion).apply()
                Log.i(TAG, "Model updated to $remoteVersion")
            }

        } catch (e: Exception) {
            Log.e(TAG, "Model update check failed: ${e.message}")
        }
    }

    private fun downloadFile(context: Context, url: String, filename: String): Boolean {
        return try {
            val bytes = URL(url).readBytes()
            File(context.filesDir, filename).writeBytes(bytes)
            Log.i(TAG, "Downloaded: $filename (${bytes.size / 1024} KB)")
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
