package com.roowus.doubletake

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * Drains [ShareQueue]: posts every stored body in order. A share the server accepts or rejects
 * (4xx: bad token, bad body) leaves the queue; the first one the server cannot be reached for
 * stops the pass and asks WorkManager to retry with backoff, keeping the order intact.
 */
class ShareUploadWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val paired = Pairing.get(ctx) ?: return Result.retry() // unpaired: keep the shares until paired
        var sent = 0
        for (body in ShareQueue.list(ctx)) {
            val clientId = body.optString("clientId")
            val file = body.optString("file")
            val out = if (file.isNotEmpty()) {
                val f = java.io.File(file)
                if (!f.isFile) { ShareQueue.remove(ctx, clientId); continue } // copy vanished: nothing to send
                ShareApi.upload(paired, body, body.optString("contentType").ifEmpty { "application/octet-stream" }, f.length()) { f.inputStream() }
            } else ShareApi.ingest(paired, body)
            when (out) {
                ShareApi.Outcome.Sent -> { ShareQueue.remove(ctx, clientId); sent++ }
                is ShareApi.Outcome.Rejected -> {
                    if (out.code in 500..599 || out.code == 429 || out.code == 408) {
                        notifyProgress(ctx, sent)
                        return Result.retry()
                    }
                    ShareQueue.remove(ctx, clientId)
                    notify(ctx, "dropped-$clientId", ctx.getString(R.string.queue_dropped_title),
                        ctx.getString(R.string.queue_dropped_body, preview(body), out.message))
                }
                is ShareApi.Outcome.Unreachable -> {
                    notifyProgress(ctx, sent)
                    return Result.retry()
                }
            }
        }
        notifyProgress(ctx, sent)
        return Result.success()
    }

    private fun notifyProgress(ctx: Context, sent: Int) {
        if (sent > 0) {
            notify(ctx, "queue-sent", ctx.resources.getQuantityString(R.plurals.queue_sent, sent, sent),
                ctx.getString(R.string.queue_sent_body))
        }
    }

    private fun preview(body: org.json.JSONObject): String =
        body.optString("url").ifEmpty { body.optString("text") }.ifEmpty { body.optString("note") }
            .ifEmpty { if (body.has("file")) "shared file" else "" }.take(80)

    companion object {
        /** Same channel id the web layer creates for FCM, so users see one "Doubletake" channel. */
        const val CHANNEL = "doubletake"

        fun notify(ctx: Context, tag: String, title: String, text: String) {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Doubletake", NotificationManager.IMPORTANCE_DEFAULT))
            }
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_doubletake)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .build()
            nm.notify(tag, 0, n)
        }
    }
}
