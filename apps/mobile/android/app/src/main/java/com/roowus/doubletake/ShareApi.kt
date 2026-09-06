package com.roowus.doubletake

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * One `POST /api/ingest` with the paired device token. Shared by the share sheet (fast path) and
 * the offline queue worker (retries), so both send the identical body, including the client-minted
 * `clientId` the server uses to replay a lost response instead of creating a second item.
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
