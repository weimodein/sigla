package com.example.sigla

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {

    // Change to your backend server address
    private const val BASE_URL = "http://192.168.100.163:3000/api/"

    private fun buildClient(token: String? = null): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        return OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(logging)
            .addInterceptor { chain ->
                val request = chain.request().newBuilder().apply {
                    token?.let { addHeader("Authorization", "Bearer $it") }
                }.build()
                chain.proceed(request)
            }
            .build()
    }

    fun get(token: String? = null): ApiService =
        Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(buildClient(token))
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
}
