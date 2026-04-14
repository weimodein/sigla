package com.example.sigla

import retrofit2.Response
import retrofit2.http.*

// ── Request / Response models ─────────────────────────────────

data class RegisterRequest(val username: String, val email: String)
data class VerifyEmailRequest(val email: String, val code: String)
data class SetPasswordRequest(val username: String, val email: String, val password: String)
data class LoginRequest(val identifier: String, val password: String)
data class ForgotPasswordRequest(val email: String)
data class VerifyResetRequest(val email: String, val code: String)
data class ResetPasswordRequest(val email: String, val password: String)
data class ResendCodeRequest(val email: String, val type: String = "registration")

data class AuthResponse(
    val message: String? = null,
    val token: String? = null,
    val user: UserResponse? = null
)

data class UserResponse(
    val id: Int = 0,
    val username: String = "",
    val email: String = "",
    val name: String? = null,
    val status: String = "active"
)

data class UpdateProfileRequest(val username: String, val name: String)

data class WordBankWord(
    val id: Int,
    val label: String,
    val description: String? = null,
    val sign_type: String = "FSL",
    val category: String = "additional words",
    val hands_count: Int = 1,
    val gesture_type: String = "static",
    val thumbnail_url: String? = null,
    val video_url: String? = null,
    val filipino_translation: String? = null
)

data class WordBankResponse(val words: List<WordBankWord>)

data class NotificationItem(
    val id: Int,
    val title: String,
    val message: String,
    val is_read: Boolean = false,
    val created_at: String = ""
)

data class NotificationsResponse(val notifications: List<NotificationItem>)

data class UnreadCountResponse(val unread: Int)

data class SubmitWordRequest(
    val label: String,
    val description: String,
    val hands_count: Int,
    val gesture_type: String,
    val sign_type: String = "FSL"
)

data class SubmitWordResponse(
    val message: String,
    val word: WordBankWord? = null,
    val word_id: Int? = null,
    val exists: Boolean = false
)

// FIX: Changed images type from List<String>? to Any? to accept both flat and nested lists
data class UploadSamplesRequest(
    val file_url: String? = null,
    val landmark_url: String? = null,
    val sample_count: Int,
    val landmarks: List<List<Float>>? = null,
    val sequence: List<List<List<Float>>>? = null,
    val images: Any? = null   // Can be List<String> (static) or List<List<String>> (motion)
)

data class ModelInfo(
    val id: Int,
    val version_number: String,
    val tflite_url: String? = null,
    val motion_tflite_url: String? = null,
    val labels_static_url: String? = null,
    val labels_motion_url: String? = null,
    val gesture_config_url: String? = null,
    val word_bank_url: String? = null,
    val accuracy: Double? = null,
    val checksum: String? = null,
    val deployed_at: String? = null
)

data class ModelResponse(val model: ModelInfo)

data class MeResponse(val user: UserResponse)

data class ChangePasswordRequest(
    val email: String,
    val code: String,
    val new_password: String
)

data class MessageResponse(val message: String)

// ── NEW: History models ─────────────────────────────────────────

data class HistoryEntryRequest(
    val word: String,
    val confidence: Int,
    val gesture_type: String,
    val timestamp: Long
)

data class HistoryEntryResponse(
    val id: String,
    val word: String,
    val confidence: Int,
    val gesture_type: String,
    val timestamp: Long,
    val created_at: String
)

data class HistoryResponse(
    val entries: List<HistoryEntryResponse>,
    val total: Int? = null
)

// ── API Service ───────────────────────────────────────────────

interface ApiService {

    // Auth
    @POST("auth/register")
    suspend fun register(@Body body: RegisterRequest): Response<AuthResponse>

    @POST("auth/verify-email")
    suspend fun verifyEmail(@Body body: VerifyEmailRequest): Response<AuthResponse>

    @POST("auth/set-password")
    suspend fun setPassword(@Body body: SetPasswordRequest): Response<AuthResponse>

    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): Response<AuthResponse>

    @POST("auth/forgot-password")
    suspend fun forgotPassword(@Body body: ForgotPasswordRequest): Response<AuthResponse>

    @POST("auth/verify-reset-code")
    suspend fun verifyResetCode(@Body body: VerifyResetRequest): Response<AuthResponse>

    @POST("auth/reset-password")
    suspend fun resetPassword(@Body body: ResetPasswordRequest): Response<AuthResponse>

    @POST("auth/resend-code")
    suspend fun resendCode(@Body body: ResendCodeRequest): Response<AuthResponse>

    @GET("auth/me")
    suspend fun getMe(): Response<MeResponse>

    // Words (public)
    @GET("words/word-bank")
    suspend fun getWordBank(): Response<WordBankResponse>

    // Words (auth)
    @POST("words")
    suspend fun submitWord(@Body body: SubmitWordRequest): Response<SubmitWordResponse>

    @POST("words/{id}/samples")
    suspend fun uploadSamples(
        @Path("id") wordId: Int,
        @Body body: UploadSamplesRequest
    ): Response<MessageResponse>

    // Notifications (auth)
    @GET("notifications")
    suspend fun getNotifications(): Response<NotificationsResponse>

    @GET("notifications/unread-count")
    suspend fun getUnreadCount(): Response<UnreadCountResponse>

    @PATCH("notifications/read-all")
    suspend fun markAllRead(): Response<MessageResponse>

    @PATCH("notifications/{id}/read")
    suspend fun markRead(@Path("id") id: Int): Response<MessageResponse>

    @DELETE("notifications/{id}")
    suspend fun deleteNotification(@Path("id") id: Int): Response<MessageResponse>

    // Profile (auth)
    @PUT("users/{id}")
    suspend fun updateProfile(
        @Path("id") id: Int,
        @Body body: UpdateProfileRequest
    ): Response<MessageResponse>

    // Model (for update check)
    @GET("models/latest")
    suspend fun getLatestModel(): Response<ModelResponse>

    // ── NEW: History endpoints ─────────────────────────────────

    /**
     * Get user's translation history
     * Optional query parameters:
     * @param limit - Number of entries to return (default 50)
     * @param offset - Pagination offset (default 0)
     */
    @GET("history")
    suspend fun getUserHistory(
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null
    ): Response<HistoryResponse>

    /**
     * Save a new translation entry to history
     */
    @POST("history")
    suspend fun saveHistoryEntry(@Body body: HistoryEntryRequest): Response<HistoryEntryResponse>

    /**
     * Delete a specific history entry by ID
     */
    @DELETE("history/{id}")
    suspend fun deleteHistoryEntry(@Path("id") id: String): Response<MessageResponse>

    /**
     * Clear all user history
     */
    @DELETE("history/clear")
    suspend fun clearHistory(): Response<MessageResponse>

    /**
     * Delete multiple history entries at once
     */
    @DELETE("history/bulk-delete")
    suspend fun bulkDeleteHistory(@Body body: Map<String, List<String>>): Response<MessageResponse>

    /**
     * Get history statistics (total count, most common words, etc.)
     */
    @GET("history/stats")
    suspend fun getHistoryStats(): Response<Map<String, Any>>
}