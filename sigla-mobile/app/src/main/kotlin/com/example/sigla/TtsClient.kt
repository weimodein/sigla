package com.example.sigla

import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.scalars.ScalarsConverterFactory
import java.util.concurrent.TimeUnit

object TtsClient {

    private const val TTS_URL = BuildConfig.TTS_URL

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    fun get(): TtsApiService =
        Retrofit.Builder()
            .baseUrl(TTS_URL)
            .client(client)
            .addConverterFactory(ScalarsConverterFactory.create())
            .build()
            .create(TtsApiService::class.java)
}
