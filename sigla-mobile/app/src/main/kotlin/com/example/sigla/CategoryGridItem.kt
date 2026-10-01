package com.example.sigla

data class CategoryGridItem(
    val displayName: String,
    val wordCount: Int,
    val isFavorites: Boolean = false,
    val isAllWords: Boolean = false
)