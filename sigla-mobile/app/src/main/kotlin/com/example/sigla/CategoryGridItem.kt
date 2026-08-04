package com.example.sigla

data class CategoryGridItem(
    val displayName: String,
    val wordCount: Int,
    val isFavorites: Boolean = false,
    val isAllWords: Boolean = false,
    val dbCategory: CategoryItem? = null // null for Favorites/All Words
)