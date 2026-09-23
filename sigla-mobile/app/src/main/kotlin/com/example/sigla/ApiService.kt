package com.example.sigla

import retrofit2.Response
import retrofit2.http.GET

data class CategoryItem(
    val id: Int,
    val name: String,
    val description: String? = null,
    val word_count: Int = 0
)

data class CategoriesResponse(val categories: List<CategoryItem>)

data class WordBankWord(
    val id: Int,
    val label: String,
    val description: String? = null,
    val sign_type: String = "FSL",
    val category: String = "additional words",
    val thumbnail_url: String? = null,
    val video_url: String? = null,
    val filipino_translation: String? = null
)

data class WordBankResponse(val words: List<WordBankWord>)

data class ModelInfo(
    val id: Int,
    val version_number: String,
    val tflite_url: String? = null,
    val motion_tflite_url: String? = null,
    val labels_motion_url: String? = null,
    val accuracy: Double? = null,
    val total_classes: Int? = null,
    val checksum: String? = null,
    val deployed_at: String? = null
)

data class DeployedModels(
    val words: ModelInfo? = null,
    val letters: ModelInfo? = null
)

data class ModelResponse(
    val model: ModelInfo,
    val models: DeployedModels? = null,
    val deployment_version: String? = null
)

interface ApiService {
    @GET("words/word-bank")
    suspend fun getWordBank(): Response<WordBankResponse>

    @GET("categories")
    suspend fun getCategories(): Response<CategoriesResponse>

    @GET("models/latest")
    suspend fun getLatestModel(): Response<ModelResponse>
}
