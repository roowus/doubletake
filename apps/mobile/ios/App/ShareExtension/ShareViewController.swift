import UIKit
import UniformTypeIdentifiers

/// The iOS share sheet: a compact card over the sharing app with the detected URL or text, a
/// one-line note, mode chips (Auto · Quick · Standard · Deep) and **Send**. It posts straight to
/// `POST {serverUrl}/api/ingest` with the device token from the App Group and never launches the
/// Capacitor WebView. Behaviour mirrors the Android `ShareReceiverActivity`; verified in the iOS
/// 26.3 simulator, **unverified** on a device (ADR 0027, `docs/channels/ios-share.md`).
///
/// Media-only shares (an image or movie with no text) copy the provider's file into the
/// extension's temporary directory and stream it to `POST {serverUrl}/api/ingest/upload` with
/// the note, mode, channel and a client-minted id in `X-Doubletake-*` headers, the same request
/// the Android sheet sends (ADR 0029). Content types the server does not accept fall back to a
/// text share of the note, with a visible warning.
final class ShareViewController: UIViewController {
    private struct Payload {
        var url: String?
        var text: String?
        var title: String?
        var mediaOnly = false
        /// Local copy of the shared photo or video plus its MIME type, when the share is media-only.
        var file: URL?
        var contentType: String?
    }

    /// Content types `POST /api/ingest/upload` accepts; keep in sync with `UPLOAD_EXT` in
    /// `apps/server/src/api/server.ts` and the Android `ShareReceiverActivity`.
    private static let uploadTypes: Set<String> = [
        "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
        "video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-matroska",
    ]

    private let modes = ["auto", "quick", "standard", "deep"]
    private let modeLabels = ["Auto", "Quick", "Standard", "Deep"]
    private var mode = "auto"
    private var payload = Payload()
    /// Minted once per sheet so a retried upload replays instead of creating a second item.
    private let clientId = "share-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()

    private let card = UIView()
    private let preview = UILabel()
    private let warning = UILabel()
    private let note = UITextField()
    private let chips = UISegmentedControl()
    private let status = UILabel()
    private let send = UIButton(type: .system)
    private let cancel = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.35)
        buildUI()
        loadItems()
    }

    // MARK: - UI

    private func buildUI() {
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let titleLabel = UILabel()
        titleLabel.text = "Doubletake"
        titleLabel.font = .preferredFont(forTextStyle: .headline)

        preview.font = .preferredFont(forTextStyle: .subheadline)
        preview.textColor = .secondaryLabel
        preview.numberOfLines = 3
        preview.text = "Reading share…"

        warning.font = .preferredFont(forTextStyle: .footnote)
        warning.textColor = .systemOrange
        warning.numberOfLines = 0
        warning.isHidden = true

        note.placeholder = "Note or question (optional)"
        note.borderStyle = .roundedRect
        note.returnKeyType = .send
        note.addTarget(self, action: #selector(submit), for: .editingDidEndOnExit)

        for (i, label) in modeLabels.enumerated() { chips.insertSegment(withTitle: label, at: i, animated: false) }
        chips.selectedSegmentIndex = 0
        chips.addTarget(self, action: #selector(modeChanged), for: .valueChanged)

        status.font = .preferredFont(forTextStyle: .footnote)
        status.textColor = .systemRed
        status.numberOfLines = 0
        status.isHidden = true

        send.setTitle("Send", for: .normal)
        send.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        send.addTarget(self, action: #selector(submit), for: .touchUpInside)
        cancel.setTitle("Cancel", for: .normal)
        cancel.addTarget(self, action: #selector(dismissSheet), for: .touchUpInside)

        let buttons = UIStackView(arrangedSubviews: [cancel, UIView(), send])
        buttons.axis = .horizontal

        let stack = UIStackView(arrangedSubviews: [titleLabel, preview, warning, note, chips, status, buttons])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            card.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -12),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])
    }

    @objc private func modeChanged() {
        mode = modes[max(0, chips.selectedSegmentIndex)]
    }

    @objc private func dismissSheet() {
        extensionContext?.cancelRequest(withError: NSError(domain: "com.roowus.doubletake", code: 0))
    }

    private func showError(_ message: String) {
        status.text = message
        status.isHidden = false
        send.isEnabled = true
    }

    // MARK: - Reading the share

    /// Collect the first URL, the text and any page title from the extension items. Instagram,
    /// Reddit and YouTube share a plain URL; Safari sends the URL plus the page title.
    private func loadItems() {
        let attachments = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        let group = DispatchGroup()
        var urls: [String] = []
        var texts: [String] = []
        var sawMedia = false
        var file: URL?
        var contentType: String?
        let lock = NSLock()

        for provider in attachments {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                    if let u = item as? URL, u.scheme?.hasPrefix("http") == true {
                        lock.lock(); urls.append(u.absoluteString); lock.unlock()
                    }
                    group.leave()
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                    if let s = item as? String { lock.lock(); texts.append(s); lock.unlock() }
                    group.leave()
                }
            } else if let mediaType = [UTType.image, UTType.movie].first(where: {
                provider.hasItemConformingToTypeIdentifier($0.identifier)
            }) {
                sawMedia = true
                // Only the first file is uploaded (the activation rule allows one of each kind).
                lock.lock(); let taken = file != nil; lock.unlock()
                if taken { continue }
                // Prefer the concrete registered type (public.jpeg, com.apple.quicktime-movie, …)
                // so the MIME type is exact; fall back to the abstract image/movie identifier.
                let concrete = provider.registeredTypeIdentifiers
                    .compactMap { UTType($0) }
                    .first { $0.conforms(to: mediaType) && $0.preferredMIMEType != nil } ?? mediaType
                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: concrete.identifier) { url, _ in
                    defer { group.leave() }
                    // The provider deletes its URL when this closure returns: copy it first.
                    guard let url, let copy = Self.copyToTemp(url) else { return }
                    let mime = concrete.preferredMIMEType
                        ?? UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                        ?? (mediaType == .image ? "image/jpeg" : "video/mp4")
                    lock.lock()
                    if file == nil { file = copy; contentType = mime } else { try? FileManager.default.removeItem(at: copy) }
                    lock.unlock()
                }
            }
        }
        let title = (extensionContext?.inputItems as? [NSExtensionItem])?
            .compactMap { $0.attributedContentText?.string }
            .first { !$0.isEmpty }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            var p = Payload()
            let joined = texts.joined(separator: "\n")
            p.url = urls.first ?? Self.firstUrl(in: joined)
            // Chrome-style "<title>\n<url>": keep what is left over as text.
            let leftover = p.url.map { joined.replacingOccurrences(of: $0, with: "") } ?? joined
            let trimmed = leftover.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { p.text = trimmed }
            if let title, title != p.url, title != p.text { p.title = title }
            p.mediaOnly = sawMedia && p.url == nil && p.text == nil
            if p.mediaOnly, let file, let contentType {
                if Self.uploadTypes.contains(contentType) {
                    p.file = file
                    p.contentType = contentType
                } else {
                    try? FileManager.default.removeItem(at: file)
                    self.warning.text = "\(contentType) is not a type the server accepts; only your note is sent."
                    self.warning.isHidden = false
                }
            } else if p.mediaOnly {
                self.warning.text = "Could not read the shared file; only your note is sent."
                self.warning.isHidden = false
            }
            self.payload = p
            let isVideo = p.contentType?.hasPrefix("video/") == true
            self.preview.text = p.url ?? p.text
                ?? (p.file != nil ? (isVideo ? "Shared video" : "Shared photo") : (p.mediaOnly ? "Image or video" : "Nothing to share"))
        }
    }

    /// Copy the provider's file into the extension's temporary directory, keeping the extension.
    static func copyToTemp(_ src: URL) -> URL? {
        let ext = src.pathExtension.isEmpty ? "bin" : src.pathExtension
        let dst = FileManager.default.temporaryDirectory
            .appendingPathComponent("doubletake-share-\(UUID().uuidString).\(ext)")
        do {
            try FileManager.default.copyItem(at: src, to: dst)
            return dst
        } catch {
            return nil
        }
    }

    /// First `http(s)://` run in the text with trailing `.,)]>"'` trimmed (same as Android).
    static func firstUrl(in text: String) -> String? {
        guard let range = text.range(of: #"https?://\S+"#, options: .regularExpression) else { return nil }
        var s = String(text[range])
        while let last = s.last, ".,)]>\"'".contains(last) { s.removeLast() }
        return s
    }

    // MARK: - Sending

    @objc private func submit() {
        status.isHidden = true
        let noteText = note.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if let file = payload.file, let contentType = payload.contentType {
            submitFile(file, contentType: contentType, note: noteText)
            return
        }
        var body: [String: Any] = ["modeHint": mode, "channel": "ios_share"]
        if let u = payload.url {
            body["url"] = u
        } else if let t = payload.text {
            body["text"] = t
        } else if payload.mediaOnly, !noteText.isEmpty {
            body["text"] = noteText
        } else {
            showError("Nothing to send. Add a note or share a link.")
            return
        }
        if !noteText.isEmpty { body["note"] = noteText }

        guard let creds = Pairing.credentials() else {
            // Unpaired: stash the share and open the app on its pairing screen.
            Pairing.storePendingShare(url: payload.url, text: payload.text, title: payload.title)
            openApp(URL(string: "doubletake://share")!)
            return
        }

        send.isEnabled = false
        var req = URLRequest(url: creds.serverUrl.appendingPathComponent("api/ingest"))
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("Bearer \(creds.token)", forHTTPHeaderField: "authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
            self?.finish(data: data, response: response, error: error)
        }.resume()
    }

    /// Media-only share: stream the copied file as the raw body of `POST /api/ingest/upload`.
    /// Note, mode, channel and clientId ride in URI-encoded `X-Doubletake-*` headers, exactly
    /// like `ShareApi.upload` on Android; a `clientId` replay answers 202 without a new item.
    private func submitFile(_ file: URL, contentType: String, note noteText: String) {
        guard let creds = Pairing.credentials() else {
            // Unpaired: the file cannot outlive the sheet, so only the note is stashed. The app
            // asks the user to share the photo again once paired.
            Pairing.storePendingShare(url: nil, text: noteText.isEmpty ? nil : noteText, title: nil)
            openApp(URL(string: "doubletake://share")!)
            return
        }
        send.isEnabled = false
        var req = URLRequest(url: creds.serverUrl.appendingPathComponent("api/ingest/upload"))
        req.httpMethod = "POST"
        req.timeoutInterval = 60
        req.setValue(contentType, forHTTPHeaderField: "content-type")
        req.setValue("Bearer \(creds.token)", forHTTPHeaderField: "authorization")
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.~"))
        func header(_ name: String, _ value: String) {
            guard !value.isEmpty, let enc = value.addingPercentEncoding(withAllowedCharacters: allowed) else { return }
            req.setValue(enc, forHTTPHeaderField: name)
        }
        header("X-Doubletake-Note", noteText)
        header("X-Doubletake-Mode", mode)
        header("X-Doubletake-Channel", "ios_share")
        header("X-Doubletake-Client-Id", clientId)
        URLSession.shared.uploadTask(with: req, fromFile: file) { [weak self] data, response, error in
            self?.finish(data: data, response: response, error: error)
        }.resume()
    }

    /// Shared completion for both requests: show the server's `error`, or "Sent" and close.
    private func finish(data: Data?, response: URLResponse?, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let error {
                self.showError("Could not reach the server: \(error.localizedDescription)")
                return
            }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(code) {
                if let file = self.payload.file { try? FileManager.default.removeItem(at: file) }
                self.preview.text = "Sent — the answer will show up in Doubletake."
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    self.extensionContext?.completeRequest(returningItems: nil)
                }
            } else {
                let msg = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["error"] as? String
                self.showError("Server said \(code): \(msg ?? "request rejected")")
            }
        }
    }

    /// Extensions may not touch `UIApplication.shared`, but the hosting `UIApplication` is
    /// still in the responder chain. Find it there and call the modern
    /// `open(_:options:completionHandler:)`; iOS 26 rejects the old `openURL:` selector
    /// outright ("BUG IN CLIENT OF UIKIT ... Force returning false"). Verified in the
    /// iOS 26.3 simulator (ADR 0027).
    private func openApp(_ url: URL) {
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:]) { [weak self] ok in
                    DispatchQueue.main.async {
                        if ok {
                            self?.extensionContext?.completeRequest(returningItems: nil)
                        } else {
                            self?.showError("Open Doubletake and pair this iPhone, then share again.")
                        }
                    }
                }
                return
            }
            responder = r.next
        }
        // No UIApplication in the chain (should not happen); keep the share stashed and close.
        extensionContext?.completeRequest(returningItems: nil)
    }
}
