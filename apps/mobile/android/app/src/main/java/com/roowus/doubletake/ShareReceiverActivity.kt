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
 * POST to `/api/ingest` with the session the app is signed in with, toast, and finish. The
 * WebView is never started, so the sheet appears in well under a second on top of the source app.
 *
 * A photo or video (`EXTRA_STREAM`) is streamed straight from the sharing app's content URI to
 * `POST /api/ingest/upload`; the note, mode and clientId travel in headers. Several images at once
 * (`ACTION_SEND_MULTIPLE`) send only the first, the sheet says so.
 *
 * Nobody signed in: the sheet says so and opens the app ([openApp]) instead of failing quietly;
 * the share itself is parked in `doubletake.pendingShare` and the web layer replays it once the
 * account exists. A `401` (revoked session, deleted account) takes the same route.
 *
 * When the server cannot be reached (offline, no network) the exact body is parked in
 * [ShareQueue] and a WorkManager job posts it later; the `clientId` minted here lets the server
 * recognise a retry of a request whose response was lost, so nothing is ever saved twice.
 */
class ShareReceiverActivity : AppCompatActivity() {
    private val io = Executors.newSingleThreadExecutor()

    private var sharedUrl: String? = null
    private var sharedText: String? = null
    private var mediaOnly = false
    /** The shared file, when the intent carries one we can upload. */
    private var streamUri: Uri? = null
    private var streamType: String? = null
    private var streamCount = 0
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

        // The session is read once per share. It is the account signed in in the app (hosted,
        // the default) or the device paired with the owner's own server; without either there is
        // nothing to post to, so the share is parked and the app opens to sign in.
        val paired = Pairing.session(this)
        if (paired == null) {
            Pairing.setPendingShare(this, pendingShareJson())
            Toast.makeText(this, R.string.share_signed_out, Toast.LENGTH_LONG).show()
            openApp()
            return
        }

        val preview = findViewById<TextView>(R.id.preview)
        val note = findViewById<EditText>(R.id.note)
        val modes = findViewById<RadioGroup>(R.id.modes)
        val warning = findViewById<TextView>(R.id.warning)
        val send = findViewById<Button>(R.id.send)

        preview.text = sharedUrl ?: sharedText?.take(200) ?: intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
        if (mediaOnly) {
            val type = streamType
            when {
                type == null -> {
                    warning.setText(R.string.share_media_unsupported)
                    warning.visibility = View.VISIBLE
                }
                else -> {
                    preview.text = if (type.startsWith("video/")) getString(R.string.share_video)
                    else getString(R.string.share_photo)
                    if (streamCount > 1) {
                        warning.text = getString(R.string.share_media_first_only, streamCount)
                        warning.visibility = View.VISIBLE
                    }
                }
            }
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
            val uris: List<Uri> = if (i.action == Intent.ACTION_SEND_MULTIPLE) {
                i.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.filterNotNull() ?: emptyList()
            } else listOfNotNull(i.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            streamCount = uris.size
            val uri = uris.firstOrNull() ?: return
            // The intent type can be a wildcard ("image/*"); the resolver knows the real one.
            val type = (contentResolver.getType(uri) ?: i.type)?.substringBefore(';')?.trim()?.lowercase()
            if (type != null && UPLOAD_TYPES.contains(type)) {
                streamUri = uri
                streamType = type
            }
        }
    }

    /**
     * Open the app on the sign-in screen. Hosted (the default) means the WebView is showing the
     * service's own login; a device that chose its own server lands on the pairing screen, which
     * the web layer picks from `doubletake.serverUrl`.
     */
    private fun openApp() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    /** Size of the shared file when the provider reports it, else -1 (chunked upload). */
    private fun streamLength(uri: Uri): Long = try {
        contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
    } catch (_: Exception) { -1L }

    private fun pendingShareJson(): String {
        val o = JSONObject()
        sharedUrl?.let { o.put("url", it) }
        sharedText?.let { o.put("text", it) }
        intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { o.put("title", it) }
        return o.toString()
    }

    private fun submit(paired: Pairing.Paired, note: String, modeHint: String, send: Button) {
        val body = JSONObject()
        val uri = streamUri
        val type = streamType
        val upload = mediaOnly && uri != null && type != null
        sharedUrl?.let { body.put("url", it) }
        when {
            upload -> Unit // the file is the item; the note rides in a header
            sharedUrl == null && !sharedText.isNullOrEmpty() -> body.put("text", sharedText)
            sharedUrl == null && sharedText.isNullOrEmpty() && note.isNotEmpty() ->
                body.put("text", note) // unsupported media type: the note becomes the item text
            sharedUrl == null && note.isEmpty() -> {
                Toast.makeText(this, R.string.share_media_unsupported, Toast.LENGTH_LONG).show()
                return
            }
        }
        if (note.isNotEmpty()) body.put("note", note)
        body.put("modeHint", modeHint)
        body.put("channel", "android_share")
        body.put("clientId", clientId)

        send.isEnabled = false
        io.execute {
            val outcome = if (upload) {
                ShareApi.upload(paired, body, type!!, streamLength(uri!!)) { contentResolver.openInputStream(uri) }
            } else ShareApi.ingest(paired, body)
            runOnUiThread {
                when (outcome) {
                    ShareApi.Outcome.Sent -> {
                        Toast.makeText(this, R.string.share_sent, Toast.LENGTH_SHORT).show()
                        finish()
                    }
                    is ShareApi.Outcome.Unreachable -> {
                        // Nothing reached the server: park the request and let WorkManager deliver it.
                        // A file must be copied now: the sharing app's URI grant ends with this sheet.
                        if (upload) {
                            val queued = ShareQueue.addFile(this, body, type!!) { contentResolver.openInputStream(uri!!) }
                            if (queued == null) {
                                Toast.makeText(this, getString(R.string.share_failed, outcome.message), Toast.LENGTH_LONG).show()
                                send.isEnabled = true
                                return@runOnUiThread
                            }
                        } else ShareQueue.add(this, body)
                        val waiting = ShareQueue.size(this)
                        val msg = if (waiting > 1) getString(R.string.share_queued_more, waiting)
                        else getString(R.string.share_queued)
                        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                        finish()
                    }
                    is ShareApi.Outcome.Rejected -> {
                        // The session is gone (revoked, or the account was deleted): the app is
                        // where that is fixed, and the share stays parked meanwhile.
                        if (outcome.code == 401) {
                            Pairing.setPendingShare(this, pendingShareJson())
                            Pairing.clearSession(this)
                            Toast.makeText(this, R.string.share_session_expired, Toast.LENGTH_LONG).show()
                            openApp()
                            return@runOnUiThread
                        }
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

        /**
         * The hosted Doubletake service, the app's default. It is a mirror of `HOSTED_URL` in
         * `apps/web/src/native.ts` and is documentation only — the phone decides where to post
         * from what the WebView wrote into Preferences (`doubletake.hosted`), which the web
         * layer fills in with the origin it actually signed in at. This constant exists so the
         * default is written down once on the native side too; keep the two in step.
         */
        const val HOSTED_URL = "https://doubletake.gg"
        /** Mirrors `UPLOAD_EXT` on the server: what `/api/ingest/upload` accepts. */
        private val UPLOAD_TYPES = setOf(
            "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
            "video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-matroska",
        )

        fun firstUrl(text: String): String? {
            val m = URL_RE.matcher(text)
            if (!m.find()) return null
            // Trim trailing punctuation that sharers append ("…check this: https://x/y.").
            var u = m.group().trimEnd('.', ',', ')', ']', '>', '"', '\'')
            return try { Uri.parse(u); u } catch (_: Exception) { null }
        }
    }
}
