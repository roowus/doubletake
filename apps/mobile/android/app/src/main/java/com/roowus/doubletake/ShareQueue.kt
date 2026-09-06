package com.roowus.doubletake

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Offline queue for the share sheet. A share that could not reach the server is stored here as the
 * exact `/api/ingest` body it will be sent with (including its `clientId`) and a WorkManager job
 * drains the queue once the network is back, with exponential backoff between attempts. Storage is
 * a JSON array in its own SharedPreferences file: a handful of small records that a worker reads
 * whole and rewrites whole, which does not warrant a Room database.
 */
object ShareQueue {
    private const val FILE = "doubletake.shareQueue"
    private const val KEY = "items"
    const val WORK_NAME = "doubletake-share-queue"
    private val lock = Any()

    /** Queued `/api/ingest` bodies, oldest first. */
    fun list(ctx: Context): List<JSONObject> = synchronized(lock) {
        val raw = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
        val arr = try { JSONArray(raw) } catch (_: Exception) { return emptyList() }
        List(arr.length()) { arr.getJSONObject(it) }
    }

    fun size(ctx: Context): Int = list(ctx).size

    /** Append a body and make sure a drain is scheduled. */
    fun add(ctx: Context, body: JSONObject) {
        synchronized(lock) { write(ctx, list(ctx) + body) }
        schedule(ctx)
    }

    /** Drop the record with this `clientId` (after a 2xx or a permanent rejection). */
    fun remove(ctx: Context, clientId: String) = synchronized(lock) {
        write(ctx, list(ctx).filter { it.optString("clientId") != clientId })
    }

    /**
     * Ensure a drain job exists. Unique work so at most one drain runs at a time; a request added
     * while one is running is appended behind it, so a share queued mid-drain is not forgotten.
     */
    fun schedule(ctx: Context) {
        val request = OneTimeWorkRequestBuilder<ShareUploadWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    /** Called when the app opens: if anything is still waiting, make sure a drain is scheduled. */
    fun kick(ctx: Context) {
        if (size(ctx) > 0) schedule(ctx)
    }

    private fun write(ctx: Context, items: List<JSONObject>) {
        val arr = JSONArray()
        items.forEach { arr.put(it) }
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
    }
}
