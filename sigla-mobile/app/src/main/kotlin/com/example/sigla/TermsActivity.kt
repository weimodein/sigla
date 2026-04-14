package com.example.sigla

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class TermsActivity : AppCompatActivity() {
    
    private lateinit var webView: WebView
    
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_terms)
        
        webView = findViewById(R.id.webViewTerms)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
        }
        
        // Add JavaScript bridge to close activity when button is clicked
        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun closeTermsDialog() {
                runOnUiThread {
                    setResult(RESULT_OK)
                    finish()
                }
            }
        }, "Android")
        
        webView.webViewClient = WebViewClient()
        
        // Load the HTML from assets
        webView.loadUrl("file:///android_asset/terms_conditions.html")
    }
}