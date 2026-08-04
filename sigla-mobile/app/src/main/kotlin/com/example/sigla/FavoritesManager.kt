package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

class FavoritesManager private constructor(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("sigla_favorites", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val session = SessionManager.getInstance(context)

    companion object {
        @Volatile private var INSTANCE: FavoritesManager? = null

        // Hoisted: allocating an anonymous TypeToken per call is pure waste in
        // a method invoked once per word.
        private val FAVORITES_TYPE = object : TypeToken<Set<Int>>() {}.type

        fun getInstance(context: Context): FavoritesManager =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: FavoritesManager(context.applicationContext).also { INSTANCE = it }
            }
    }

    private val prefKey: String
        get() {
            val uid = session.userId
            return if (uid == -1) "favorites_guest" else "favorites_$uid"
        }

    // In-memory copy of the favorites set, plus the pref key it was loaded
    // from. isFavorite() is called once per word while filtering and building
    // the category grid, and each call used to cost a SharedPreferences read, a
    // Gson parse, and an AES decrypt (prefKey reads the encrypted session), all
    // on the main thread. Caching makes those calls free.
    //
    // Keyed by prefKey so signing in or out — which changes the key — reloads
    // rather than serving the previous account's favorites.
    private var cachedFavorites: Set<Int>? = null
    private var cachedForKey: String? = null

    @Synchronized
    fun getAll(): Set<Int> {
        val key = prefKey
        cachedFavorites?.let { if (cachedForKey == key) return it }

        val json = prefs.getString(key, null)
        val loaded = if (json == null) emptySet() else try {
            gson.fromJson<Set<Int>>(json, FAVORITES_TYPE) ?: emptySet()
        } catch (_: Exception) {
            emptySet()
        }
        cachedFavorites = loaded
        cachedForKey    = key
        return loaded
    }

    fun isFavorite(wordId: Int): Boolean = wordId in getAll()

    /** Returns the new favorite state (true = now favorited). */
    @Synchronized
    fun toggle(wordId: Int): Boolean {
        val current = getAll()
        val isNowFavorite = wordId !in current
        val updated = if (isNowFavorite) current + wordId else current - wordId
        prefs.edit().putString(prefKey, gson.toJson(updated)).apply()
        cachedFavorites = updated
        cachedForKey    = prefKey
        return isNowFavorite
    }
}
