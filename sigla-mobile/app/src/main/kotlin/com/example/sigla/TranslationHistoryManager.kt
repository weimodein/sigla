package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.text.SimpleDateFormat
import java.util.*

data class TranslationEntry(
    val word: String,
    val confidence: Int,        // percentage 0-100
    val gestureType: String,    // "static" or "motion"
    val timestamp: Long = System.currentTimeMillis()
)

class TranslationHistoryManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("sigla_history", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val listType = object : TypeToken<MutableList<TranslationEntry>>() {}.type

    companion object {
        private const val KEY_HISTORY = "translation_history"
        private const val MAX_ENTRIES = 200

        @Volatile private var INSTANCE: TranslationHistoryManager? = null

        fun getInstance(context: Context): TranslationHistoryManager =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: TranslationHistoryManager(context.applicationContext).also {
                    INSTANCE = it
                }
            }

        fun formatDate(ts: Long): String {
            val sdf = SimpleDateFormat("MMM dd, yyyy", Locale.getDefault())
            return sdf.format(Date(ts))
        }

        fun formatTime(ts: Long): String {
            val sdf = SimpleDateFormat("hh:mm a", Locale.getDefault())
            return sdf.format(Date(ts))
        }
    }

    fun getAll(): List<TranslationEntry> {
        val json = prefs.getString(KEY_HISTORY, null) ?: return emptyList()
        return try { gson.fromJson(json, listType) } catch (e: Exception) { emptyList() }
    }

    fun add(word: String, confidence: Int, gestureType: String) {
        val list = getAll().toMutableList()
        list.add(0, TranslationEntry(word, confidence, gestureType))
        // Trim to max
        val trimmed = if (list.size > MAX_ENTRIES) list.take(MAX_ENTRIES) else list
        prefs.edit().putString(KEY_HISTORY, gson.toJson(trimmed)).apply()
    }

    fun deleteAt(index: Int) {
        val list = getAll().toMutableList()
        if (index in list.indices) {
            list.removeAt(index)
            prefs.edit().putString(KEY_HISTORY, gson.toJson(list)).apply()
        }
    }

    fun clearAll() {
        prefs.edit().remove(KEY_HISTORY).apply()
    }

    /** Groups entries by date string (e.g. "Mar 30, 2026") */
    fun getGrouped(): List<Pair<String, List<TranslationEntry>>> {
        val all = getAll()
        val grouped = LinkedHashMap<String, MutableList<TranslationEntry>>()
        for (entry in all) {
            val date = formatDate(entry.timestamp)
            grouped.getOrPut(date) { mutableListOf() }.add(entry)
        }
        return grouped.map { (date, entries) -> date to entries }
    }
}
