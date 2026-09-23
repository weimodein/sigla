    package com.example.sigla

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.util.UUID

data class CustomCategory(
    val id: String,
    val name: String,
    val wordIds: List<Int> = emptyList()
)

class CustomCategoryManager private constructor(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("sigla_custom_categories", Context.MODE_PRIVATE)
    private val gson = Gson()

    companion object {
        @Volatile private var INSTANCE: CustomCategoryManager? = null
        private const val PREF_KEY = "categories_guest"

        fun getInstance(context: Context): CustomCategoryManager =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: CustomCategoryManager(context.applicationContext).also { INSTANCE = it }
            }
    }

    fun getAll(): List<CustomCategory> {
        val json = prefs.getString(PREF_KEY, null) ?: return emptyList()
        return try {
            val type = object : TypeToken<List<CustomCategory>>() {}.type
            gson.fromJson<List<CustomCategory>>(json, type) ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun create(name: String): CustomCategory {
        val category = CustomCategory(id = UUID.randomUUID().toString(), name = name.trim())
        save(getAll() + category)
        return category
    }

    fun rename(id: String, newName: String) {
        save(getAll().map { if (it.id == id) it.copy(name = newName.trim()) else it })
    }

    fun delete(id: String) {
        save(getAll().filter { it.id != id })
    }

    fun addWord(categoryId: String, wordId: Int) {
        save(getAll().map { cat ->
            if (cat.id == categoryId && wordId !in cat.wordIds)
                cat.copy(wordIds = cat.wordIds + wordId)
            else cat
        })
    }

    fun removeWord(categoryId: String, wordId: Int) {
        save(getAll().map { cat ->
            if (cat.id == categoryId)
                cat.copy(wordIds = cat.wordIds.filter { it != wordId })
            else cat
        })
    }

    fun getWordsFor(categoryId: String): List<Int> =
        getAll().find { it.id == categoryId }?.wordIds ?: emptyList()

    // ADD THIS:
    fun get(id: String): CustomCategory? = getAll().find { it.id == id }

    private fun save(categories: List<CustomCategory>) {
        prefs.edit().putString(PREF_KEY, gson.toJson(categories)).apply()
    }
}
