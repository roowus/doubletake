package com.roowus.doubletake

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.regex.Pattern

/**
 * The Doubletake share sheet. Deliberately tiny and native: Instagram (and Reddit, YouTube,
 * Chrome…) hand us a `text/plain` URL; we show a compact sheet with a note field and mode chips,
 * POST to `/api/ingest` with the paired device token, toast, and finish. The WebView is never
 * started, so the sheet appears in well under a second on top of the source app.
 *
 * Media files (image/video) are accepted by the manifest filters so the app appears in those
 * share sheets, but uploads land in M3; until then only the note travels.
 *
 * When the server cannot be reached (offline, tunnel down) the exact body is parked in
 * [ShareQueue] and a WorkManager job posts it later; the `clientId` minted here lets the server
 * recognise a retry of a request whose response was lost, so nothing is ever saved twice.
 */
class ShareReceiverActivity : AppCompatActivity() {
    private val io = Executors.newSingleThreadExecutor()

    private var sharedUrl: String? = null
    private var sharedText: String? = null
    private var mediaOnly = false
    /** Idempotency key for this share; the same one is reused across retries. */
    private val clientId = "share-" + UUID.randomUUID().toString().replace("-", "")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_share)
        window.setGravity(Gravity.BOTTOM)
        window.setLayout(
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
        )

        parseIntent(intent)

        val paired = Pairing.get(this)
        if (paired == null) {
            // Preserve the share and hand off to the app's pairing screen.
            Pairing.setPendingShare(this, pendingShareJson())
            Toast.makeText(this, R.string.share_unpaired, Toast.LENGTH_LONG).show()
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
            return
        }

        val preview = findViewById<TextView>(R.id.preview)
        val note = findViewById<EditText>(R.id.note)
        val modes = findViewById<RadioGroup>(R.id.modes)
        val warning = findViewById<TextView>(R.id.warning)
        val send = findViewById<Button>(R.id.send)

        preview.text = sharedUrl ?: sharedText?.take(200) ?: intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
        if (mediaOnly) {
            warning.setText(R.string.share_media_only)
            warning.visibility = View.VISIBLE
        }

        val doSend = {
            val modeHint = when (modes.checkedRadioButtonId) {
                R.id.mode_quick -> "quick"
                R.id.mode_standard -> "standard"
                R.id.mode_deep -> "deep"
                else -> "auto"
            }
            submit(paired, note.text.toString().trim(), modeHint, send)
        }
        send.setOnClickListener { doSend() }
        note.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                doSend(); true
            } else false
        }
    }

    private fun parseIntent(i: Intent) {
        val text = i.getStringExtra(Intent.EXTRA_TEXT)?.trim()
        val hasStream = i.action == Intent.ACTION_SEND_MULTIPLE ||
            (i.action == Intent.ACTION_SEND && i.type?.startsWith("text/") != true)
        if (!text.isNullOrEmpty()) {
            val url = firstUrl(text)
            if (url != null) {
                sharedUrl = url
                // Chrome sends "<title>\n<url>"; keep any leftover text as context.
                val rest = text.replace(url, "").trim()
                if (rest.isNotEmpty()) sharedText = rest
            } else {
                sharedText = text
            }
        } else if (hasStream) {
            mediaOnly = true
        }
    }

    private fun pendingShareJson(): String {
        val o = JSONObject()
        sharedUrl?.let { o.put("url", it) }
        sharedText?.let { o.put("text", it) }
        intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { o.put("title", it) }
        return o.toString()
    }

    private fun submit(paired: Pairing.Paired, note: String, modeHint: String, send: Button) {
        val body = JSONObject()
        sharedUrl?.let { body.put("url", it) }
        when {
            sharedUrl == null && !sharedText.isNullOrEmpty() -> body.put("text", sharedText)
            sharedUrl == null && sharedText.isNullOrEmpty() && note.isNotEmpty() ->
                body.put("text", note) // media-only share: the note becomes the item text
            sharedUrl == null && note.isEmpty() -> {
                Toast.makeText(this, R.string.share_media_only, Toast.LENGTH_LONG).show()
                return
            }
        }
        if (note.isNotEmpty()) body.put("note", note)
        body.put("modeHint", modeHint)
        body.put("channel", "android_share")
        body.put("clientId", clientId)

        send.isEnabled = false
        io.execute {
            val outcome = ShareApi.ingest(paired, body)
            runOnUiThread {
                when (outcome) {
                    ShareApi.Outcome.Sent -> {
                        Toast.makeText(this, R.string.share_sent, Toast.LENGTH_SHORT).show()
                        finish()
                    }
                    is ShareApi.Outcome.Unreachable -> {
                        // Nothing reached the server: park the body and let WorkManager deliver it.
                        ShareQueue.add(this, body)
                        val waiting = ShareQueue.size(this)
                        val msg = if (waiting > 1) getString(R.string.share_queued_more, waiting)
                        else getString(R.string.share_queued)
                        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                        finish()
                    }
                    is ShareApi.Outcome.Rejected -> {
                        // The server answered: a retry with the same body would fail the same way.
                        Toast.makeText(this, getString(R.string.share_failed, outcome.message), Toast.LENGTH_LONG).show()
                        send.isEnabled = true
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        private val URL_RE = Pattern.compile("https?://\\S+")

        fun firstUrl(text: String): String? {
            val m = URL_RE.matcher(text)
            if (!m.find()) return null
            // Trim trailing punctuation that sharers append ("…check this: https://x/y.").
            var u = m.group().trimEnd('.', ',', ')', ']', '>', '"', '\'')
            return try { Uri.parse(u); u } catch (_: Exception) { null }
        }
    }
}
