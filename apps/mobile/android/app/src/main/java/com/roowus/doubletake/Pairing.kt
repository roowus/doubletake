package com.roowus.doubletake

import android.content.Context
import android.content.SharedPreferences

/**
 * Pairing state shared between the WebView (written through `@capacitor/preferences`, which
 * stores under the "CapacitorStorage" SharedPreferences group) and the native share sheet.
 * Keys mirror `apps/web/src/native.ts`.
 */
object Pairing {
    const val GROUP = "CapacitorStorage"
    const val KEY_SERVER_URL = "doubletake.serverUrl"
    const val KEY_TOKEN = "doubletake.token"
    const val KEY_PENDING_SHARE = "doubletake.pendingShare"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(GROUP, Context.MODE_PRIVATE)

    data class Paired(val serverUrl: String, val token: String)

    fun get(ctx: Context): Paired? {
        val p = prefs(ctx)
        val url = p.getString(KEY_SERVER_URL, null)?.trim()?.trimEnd('/')
        val token = p.getString(KEY_TOKEN, null)?.trim()
        if (url.isNullOrEmpty() || token.isNullOrEmpty()) return null
        return Paired(url, token)
    }

    /** Stash a share the WebView should pick up after pairing (JSON string). */
    fun setPendingShare(ctx: Context, json: String) {
        prefs(ctx).edit().putString(KEY_PENDING_SHARE, json).apply()
    }
}
