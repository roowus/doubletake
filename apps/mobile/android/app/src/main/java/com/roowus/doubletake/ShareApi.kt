package com.roowus.doubletake

import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * One `POST /api/ingest` (link or text) or `POST /api/ingest/upload` (a photo or video, the body is
 * the file and the note/mode/channel/clientId travel in `x-doubletake-*` headers) with the paired
 * device token. Shared by the share sheet (fast path) and the offline queue worker (retries), so
 * both send the identical request, including the client-minted `clientId` the server uses to
 * replay a lost response instead of creating a second item.
 */
object ShareApi {
    sealed class Outcome {
        /** 2xx. */
        object Sent : Outcome()
        /** The server answered with a non-2xx status: retrying the same body will not help for 4xx. */
        data class Rejected(val code: Int, val message: String) : Outcome()
        /** Nothing reached the server (offline, DNS, tunnel down, timeout): safe to retry later. */
        data class Unreachable(val message: String) : Outcome()
    }

    /** Upload one media file. `meta` carries note, modeHint, channel and clientId; `open` yields the bytes. */
    fun upload(paired: Pairing.Paired, meta: JSONObject, contentType: String, length: Long, open: () -> InputStream?): Outcome {
        val conn = try {
            URL("${paired.serverUrl}/api/ingest/upload").openConnection() as HttpURLConnection
        } catch (e: Exception) {
            return Outcome.Unreachable(e.message ?: e.javaClass.simpleName)
        }
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 8000
            conn.readTimeout = 60000
            conn.doOutput = true
            if (length > 0) conn.setFixedLengthStreamingMode(length) else conn.setChunkedStreamingMode(1 shl 16)
            conn.setRequestProperty("Content-Type", contentType)
            conn.setRequestProperty("Authorization", "Bearer ${paired.token}")
            fun header(name: String, key: String) {
                val v = meta.optString(key)
                if (v.isNotEmpty()) conn.setRequestProperty(name, URLEncoder.encode(v, "UTF-8").replace("+", "%20"))
            }
            header("X-Doubletake-Note", "note")
            header("X-Doubletake-Mode", "modeHint")
            header("X-Doubletake-Channel", "channel")
            header("X-Doubletake-Client-Id", "clientId")
            // A content-URI grant can expire or be missing (SecurityException), the file can be gone
            // (FileNotFoundException): report it instead of crashing the sheet.
            val input = try {
                open()
            } catch (e: Exception) {
                return Outcome.Rejected(0, "Could not read the shared file (${e.javaClass.simpleName})")
            } ?: return Outcome.Rejected(0, "Could not read the shared file")
            input.use { src -> conn.outputStream.use { dst -> src.copyTo(dst, 1 shl 16) } }
            val code = conn.responseCode
            if (code in 200..299) return Outcome.Sent
            val err = try {
                conn.errorStream?.bufferedReader()?.readText()?.let { JSONObject(it).optString("error") }
            } catch (_: Exception) { null }
            return Outcome.Rejected(code, if (err.isNullOrEmpty()) "HTTP $code" else err)
        } catch (e: IOException) {
            return Outcome.Unreachable(e.message ?: e.javaClass.simpleName)
        } finally {
            conn.disconnect()
        }
    }

    fun ingest(paired: Pairing.Paired, body: JSONObject): Outcome {
        val conn = try {
            URL("${paired.serverUrl}/api/ingest").openConnection() as HttpURLConnection
        } catch (e: Exception) {
            return Outcome.Unreachable(e.message ?: e.javaClass.simpleName)
        }
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 8000
            conn.readTimeout = 15000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer ${paired.token}")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code in 200..299) return Outcome.Sent
            val err = try {
                conn.errorStream?.bufferedReader()?.readText()?.let { JSONObject(it).optString("error") }
            } catch (_: Exception) { null }
            return Outcome.Rejected(code, if (err.isNullOrEmpty()) "HTTP $code" else err)
        } catch (e: IOException) {
            return Outcome.Unreachable(e.message ?: e.javaClass.simpleName)
        } finally {
            conn.disconnect()
        }
    }
}
