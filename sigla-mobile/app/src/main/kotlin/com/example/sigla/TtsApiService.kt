package com.example.sigla

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Query

interface TtsApiService {
    @GET("speak")
    suspend fun speak(
        @Query("text") text: String,
        @Query("voice") voice: String
    ): Response<ResponseBody>
}
