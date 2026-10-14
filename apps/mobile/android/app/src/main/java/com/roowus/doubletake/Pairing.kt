package com.roowus.doubletake

import android.content.Context
import android.content.SharedPreferences

/**
 * Session state shared between the WebView (written through `@capacitor/preferences`, which
 * stores under the "CapacitorStorage" SharedPreferences group) and the native share sheet.
 * Keys mirror `apps/web/src/native.ts`.
 *
 * Two sessions can exist and they do not overwrite each other:
 *
 * - **hosted** (the default): the app signed in at a Doubletake service — the WebView is on the
 *   service's own origin, which `prefs()` returns as the server URL, with the `dth_` token;
 * - **self-hosted**: the owner chose "Use my own server" and paired with a code, which stores
 *   `serverUrl` + `token`.
 *
 * The WebView reads both. `ShareReceiverActivity` cannot (it never boots the WebView), so it
 * copies this group into [SHARE_GROUP] on first use and reads its own copy from then on; a
 * sign-out clears it and the next share copies again.
 */
object Pairing {
    const val GROUP = "CapacitorStorage"
    const val KEY_SERVER_URL = "doubletake.serverUrl"
    const val KEY_TOKEN = "doubletake.token"
    const val KEY_PENDING_SHARE = "doubletake.pendingShare"
    /** Set by the WebView when it is signed in to a Doubletake service; empty when self-hosted. */
    const val KEY_HOSTED = "doubletake.hosted"
    /** The hosted session token (`dth_…`), kept apart from a paired self-hosted token. */
    const val KEY_HOSTED_TOKEN = "doubletake.hostedToken"

    /** The share sheet's own copy of the session. */
    const val SHARE_GROUP = "doubletake.session"
    private const val KEY_COPIED = "copied"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(GROUP, Context.MODE_PRIVATE)

    private fun sharePrefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(SHARE_GROUP, Context.MODE_PRIVATE)

    data class Paired(val serverUrl: String, val token: String)

    /**
     * Where the share sheet should post, or null when nobody is signed in. Prefers the explicit
     * self-hosted pairing, then the hosted session; both need a server and a token.
     */
    fun get(ctx: Context): Paired? {
        val p = prefs(ctx)
        val server = p.getString(KEY_SERVER_URL, null).trimUrlToNull()
        val deviceToken = p.getString(KEY_TOKEN, null).trimToNull()
        if (server != null && deviceToken != null) return Paired(server, deviceToken)
        val hosted = p.getString(KEY_HOSTED, null).trimUrlToNull()
        val hostedToken = p.getString(KEY_HOSTED_TOKEN, null).trimToNull()
        if (hosted != null && hostedToken != null) return Paired(hosted, hostedToken)
        return null
    }

    /**
     * True when a Doubletake account is signed in on this device. Distinguishes "sign in to
     * Doubletake" from "pair with your server" in the sheet's copy.
     */
    fun isHosted(ctx: Context): Boolean = get(ctx)?.let { signedInHosted(ctx, it) } ?: false

    private fun signedInHosted(ctx: Context, paired: Paired): Boolean {
        val p = prefs(ctx)
        val hosted = p.getString(KEY_HOSTED, null).trimUrlToNull()
        return hosted != null && hosted == paired.serverUrl
    }

    /**
     * A copy of the WebView's session for the share sheet, taken lazily (see [SHARE_GROUP]) and
     * re-taken after any sign-out. Null when nobody is signed in.
     */
    fun session(ctx: Context): Paired? {
        val copy = sharePrefs(ctx)
        if (!copy.getBoolean(KEY_COPIED, false)) {
            val now = get(ctx)
            copy.edit()
                .putBoolean(KEY_COPIED, true)
                .putString(KEY_SERVER_URL, now?.serverUrl ?: "")
                .putString(KEY_TOKEN, now?.token ?: "")
                .putBoolean(KEY_HOSTED, now?.let { signedInHosted(ctx, it) } ?: false)
                .apply()
            return now
        }
        val server = copy.getString(KEY_SERVER_URL, null).trimUrlToNull() ?: return null
        val token = copy.getString(KEY_TOKEN, null).trimToNull() ?: return null
        return Paired(server, token)
    }

    /** Whether the copied session is a hosted account (drives the sheet's copy only). */
    fun sessionIsHosted(ctx: Context): Boolean = sharePrefs(ctx).getBoolean(KEY_HOSTED, false)

    /** The web app signed out: forget the copy so the next share reads the session afresh. */
    fun clearSession(ctx: Context) {
        sharePrefs(ctx).edit().clear().apply()
    }

    /** Stash a share the WebView should pick up after signing in (JSON string). */
    fun setPendingShare(ctx: Context, json: String) {
        prefs(ctx).edit().putString(KEY_PENDING_SHARE, json).apply()
    }

    private fun String?.trimToNull(): String? = this?.trim()?.ifEmpty { null }

    /** Server origins arrive with or without a trailing slash; tokens never carry one. */
    private fun String?.trimUrlToNull(): String? = this?.trim()?.trimEnd('/')?.ifEmpty { null }
}
