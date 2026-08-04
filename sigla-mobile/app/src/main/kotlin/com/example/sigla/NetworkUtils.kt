package com.example.sigla

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/**
 * NetworkUtils.kt
 *
 * Small read-only helpers around ConnectivityManager, used to decide whether a
 * bulk download should run at all and whether to warn about mobile-data usage.
 * ACCESS_NETWORK_STATE is already declared in the manifest.
 */
object NetworkUtils {

    private fun capabilities(context: Context): NetworkCapabilities? {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return null
        val network = cm.activeNetwork ?: return null
        return cm.getNetworkCapabilities(network)
    }

    /** True when there is an active network that can actually reach the internet. */
    fun isOnline(context: Context): Boolean {
        val caps = capabilities(context) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /**
     * True when the active connection is metered (typically cellular), i.e. a large
     * download may cost the user data. Defaults to true when the state is unknown —
     * warning unnecessarily is cheaper than silently burning someone's data.
     */
    fun isMetered(context: Context): Boolean {
        val caps = capabilities(context) ?: return true
        return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }
}
