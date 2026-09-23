package com.example.sigla

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {

    // Set BASE_URL via buildConfigField in build.gradle.kts (debug/release buildTypes)
    private const val BASE_URL = BuildConfig.BASE_URL
    val SERVER_URL = BASE_URL.removeSuffix("api/")

    /** Resolve a server-relative path (e.g. /uploads/…) to a full URL. */
    fun resolveUrl(path: String?): String? {
        if (path.isNullOrBlank()) return null
        return if (path.startsWith("http")) path else SERVER_URL.trimEnd('/') + path
    }

    /**
     * One client for the whole process. Building an OkHttpClient allocates a
     * connection pool, a dispatcher and a thread pool, so a per-call instance
     * meant connections were never reused and every request paid a fresh
     * TCP+TLS handshake.
     */
    private val client: OkHttpClient by lazy {
        val logging = HttpLoggingInterceptor().apply {
            // BODY stringifies entire word-bank responses into logcat. Useful
            // when actively debugging the API, far too expensive by default.
            level = HttpLoggingInterceptor.Level.NONE
        }
        OkHttpClient.Builder()
            // A shorter connect timeout keeps an unreachable server (BASE_URL is
            // a LAN address) from stalling a screen for half a minute.
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(logging)
            .build()
    }

    /** Retrofit and its generated proxy are also built once, not per call. */
    private val service: ApiService by lazy {
        Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }

    fun get(): ApiService = service
}
