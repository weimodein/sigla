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

data class CategoryItem(
    val id: Int,
    val name: String,
    val description: String? = null,
    val word_count: Int = 0
)

data class CategoriesResponse(val categories: List<CategoryItem>)

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


data class ModelInfo(
    val id: Int,
    val version_number: String,
    val tflite_url: String? = null,
    val motion_tflite_url: String? = null,
    val labels_motion_url: String? = null,
    val word_bank_url: String? = null,
    val accuracy: Double? = null,
    val checksum: String? = null,
    val deployed_at: String? = null,
    // Static (MLP) model — not tracked in the backend DB (no schema changes);
    // the backend always advertises this fixed path, and it 404s harmlessly if
    // this deployed version never produced one (see ModelUpdateManager).
    val static_tflite_url: String? = null,
    val labels_static_url: String? = null
)

data class ModelResponse(val model: ModelInfo)

data class MeResponse(val user: UserResponse)

data class ChangePasswordRequest(
    val email: String,
    val code: String,
    val new_password: String
)

data class MessageResponse(val message: String)


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

    // Categories (public read)
    @GET("categories")
    suspend fun getCategories(): Response<CategoriesResponse>

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
}