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

    fun getAll(): Set<Int> {
        val json = prefs.getString(prefKey, null) ?: return emptySet()
        return try {
            val type = object : TypeToken<Set<Int>>() {}.type
            gson.fromJson<Set<Int>>(json, type) ?: emptySet()
        } catch (_: Exception) {
            emptySet()
        }
    }

    fun isFavorite(wordId: Int): Boolean = wordId in getAll()

    /** Returns the new favorite state (true = now favorited). */
    fun toggle(wordId: Int): Boolean {
        val current = getAll()
        val isNowFavorite = wordId !in current
        val updated = if (isNowFavorite) current + wordId else current - wordId
        prefs.edit().putString(prefKey, gson.toJson(updated)).apply()
        return isNowFavorite
    }
}
