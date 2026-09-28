package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.text.SimpleDateFormat
import java.util.*

data class TranslationEntry(
    val word: String,
    val confidence: Int,
    val gestureType: String,
    val timestamp: Long = System.currentTimeMillis()
)

class TranslationHistoryManager private constructor(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("sigla_history", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val listType = object : TypeToken<MutableList<TranslationEntry>>() {}.type

    /** Opened once. setTranslation() is called in a loop over the whole word bank. */
    private val translationPrefs: SharedPreferences =
        context.getSharedPreferences("sigla_translations", Context.MODE_PRIVATE)

    /**
     * In-memory mirror of the stored list, newest-first.
     *
     * add() previously re-read the prefs string, Gson-parsed up to MAX_ENTRIES
     * entries and re-sorted them on every recognition — on the UI thread, at the
     * moment the result card appears. The cache makes add() a prepend plus one
     * serialize. Null means "not loaded yet"; the first read populates it.
     *
     * Guarded by the instance monitor: reads now come from both the UI thread and
     * the IO dispatcher (MainActivity writes history from a coroutine).
     */
    private var cache: List<TranslationEntry>? = null

    companion object {
        private const val KEY_HISTORY = "translation_history"
        private const val KEY_TOTAL_TRANSLATED = "total_translated"
        private const val KEY_TODAY_DAY = "translated_today_day"
        private const val KEY_TODAY_COUNT = "translated_today_count"
        private const val MAX_ENTRIES = 200

        @Volatile private var INSTANCE: TranslationHistoryManager? = null

        fun getInstance(context: Context): TranslationHistoryManager =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: TranslationHistoryManager(context.applicationContext).also {
                    INSTANCE = it
                }
            }

        // Hoisted: these were allocated per RecyclerView bind. SimpleDateFormat is
        // not thread-safe, so every use below is synchronized on the formatter.
        private val DATE_FORMAT = SimpleDateFormat("MMM dd, yyyy", Locale.getDefault())
        private val TIME_FORMAT = SimpleDateFormat("hh:mm a", Locale.getDefault())

        fun formatDate(ts: Long): String = synchronized(DATE_FORMAT) {
            DATE_FORMAT.format(Date(ts))
        }

        fun formatTime(ts: Long): String = synchronized(TIME_FORMAT) {
            TIME_FORMAT.format(Date(ts))
        }
    }

    /** Always returns newest-first, regardless of the order entries were stored in. */
    @Synchronized
    fun getAll(): List<TranslationEntry> {
        cache?.let { return it }

        val json = prefs.getString(KEY_HISTORY, null)
        val list: List<TranslationEntry> = if (json == null) {
            emptyList()
        } else {
            try {
                gson.fromJson<List<TranslationEntry>>(json, listType)
                    .sortedByDescending { it.timestamp }
            } catch (e: Exception) {
                emptyList()
            }
        }
        cache = list
        return list
    }

    @Synchronized
    fun add(word: String, confidence: Int, gestureType: String) {
        // Read before the new entry is saved: a first-ever call seeds from today's
        // history, which must not already include this entry.
        val todayBefore = getTranslatedToday()

        // getAll() is newest-first and the new entry is the newest, so prepending
        // preserves the ordering without a re-sort.
        val current = getAll()
        val updated = ArrayList<TranslationEntry>(minOf(current.size + 1, MAX_ENTRIES))
        updated.add(TranslationEntry(word, confidence, gestureType))
        for (entry in current) {
            if (updated.size >= MAX_ENTRIES) break
            updated.add(entry)
        }
        saveToPrefs(updated)

        // Counters kept separate from the capped/editable list above: neither is
        // reduced by the 200-entry cap, deleteAt() or clearAll(), so they reflect
        // what SigLa actually translated, not just what is still kept in history.
        prefs.edit()
            .putInt(KEY_TOTAL_TRANSLATED, getTotalTranslated() + 1)
            .putString(KEY_TODAY_DAY, localDayKey(System.currentTimeMillis(), TimeZone.getDefault()))
            .putInt(KEY_TODAY_COUNT, todayBefore + 1)
            .apply()
    }

    /**
     * Successful translations since local midnight — Home's "Translated today".
     * The count is stored with the day it belongs to, so the first read on a new
     * day returns 0 without any midnight job. A phone that never wrote this
     * counter (installed before it existed) is seeded from today's history
     * entries instead of reporting 0.
     */
    @Synchronized
    fun getTranslatedToday(now: Long = System.currentTimeMillis()): Int {
        val zone = TimeZone.getDefault()
        val today = localDayKey(now, zone)
        val storedDay = prefs.getString(KEY_TODAY_DAY, null)
        if (storedDay == today) return prefs.getInt(KEY_TODAY_COUNT, 0)
        if (storedDay != null) return 0
        val seeded = getAll().count { localDayKey(it.timestamp, zone) == today }
        prefs.edit().putString(KEY_TODAY_DAY, today).putInt(KEY_TODAY_COUNT, seeded).apply()
        return seeded
    }

    /**
     * Lifetime count of every successful translation, uncapped (see add()).
     * A phone whose history predates this counter (KEY_TOTAL_TRANSLATED never
     * written) is seeded from its current history size instead of reporting 0 —
     * an undercount for anyone who already rolled past the 200-entry cap, but
     * still closer to the truth than "0" for someone with a full history.
     */
    @Synchronized
    fun getTotalTranslated(): Int {
        val stored = prefs.getInt(KEY_TOTAL_TRANSLATED, -1)
        if (stored >= 0) return stored
        val seeded = getAll().size
        prefs.edit().putInt(KEY_TOTAL_TRANSLATED, seeded).apply()
        return seeded
    }

    @Synchronized
    fun deleteAt(index: Int) {
        val list = getAll().toMutableList()
        if (index in list.indices) {
            list.removeAt(index)
            saveToPrefs(list)
        }
    }

    @Synchronized
    fun clearAll() {
        saveToPrefs(emptyList())
    }

    fun getGrouped(): List<Pair<String, List<TranslationEntry>>> {
        val all = getAll()
        val grouped = LinkedHashMap<String, MutableList<TranslationEntry>>()
        for (entry in all) {
            val date = formatDate(entry.timestamp)
            grouped.getOrPut(date) { mutableListOf() }.add(entry)
        }
        return grouped.map { (date, entries) -> date to entries }
    }

    /** Caller must hold the instance monitor. */
    private fun saveToPrefs(entries: List<TranslationEntry>) {
        cache = entries
        val json = gson.toJson(entries)
        prefs.edit().putString(KEY_HISTORY, json).apply()
    }

    fun getCount(): Int = getAll().size

    fun setTranslation(word: String, translation: String) {
        translationPrefs.edit().putString(word.lowercase(), translation).apply()
    }

    /**
     * The Filipino translation for [word], if one was cached the last time the
     * word bank loaded (see MainActivity's setTranslation loop). Null for a
     * word never seen since the cache was last populated, or one with no
     * Filipino translation in the word bank.
     */
    fun getTranslation(word: String): String? = translationPrefs.getString(word.lowercase(), null)
}