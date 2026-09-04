import UIKit
import UniformTypeIdentifiers

/// The iOS share sheet: a compact card over the sharing app with the detected URL or text, a
/// one-line note, mode chips (Auto · Quick · Standard · Deep) and **Send**. It posts straight to
/// `POST {serverUrl}/api/ingest` with the device token from the App Group and never launches the
/// Capacitor WebView. Behaviour mirrors the Android `ShareReceiverActivity`; verified in the iOS
/// 26.3.1 simulator, **unverified** on a device (ADR 0027, `docs/channels/ios-share.md`).
///
/// Media-only shares (an image or movie with no text) are accepted by the activation rule but not
/// uploaded: the sheet says so and sends the note as text, exactly like Android.
final class ShareViewController: UIViewController {
    private struct Payload {
        var url: String?
        var text: String?
        var title: String?
        var mediaOnly = false
    }

    private let modes = ["auto", "quick", "standard", "deep"]
    private let modeLabels = ["Auto", "Quick", "Standard", "Deep"]
    private var mode = "auto"
    private var payload = Payload()

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
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier)
                || provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                sawMedia = true
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
            self.payload = p
            self.preview.text = p.url ?? p.text ?? (p.mediaOnly ? "Image or video" : "Nothing to share")
            if p.mediaOnly {
                self.warning.text = "Media files are not uploaded from the share sheet yet; only your note is sent."
                self.warning.isHidden = false
            }
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
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.showError("Could not reach the server: \(error.localizedDescription)")
                    return
                }
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(code) {
                    self.preview.text = "Sent — the answer will show up in Doubletake."
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        self.extensionContext?.completeRequest(returningItems: nil)
                    }
                } else {
                    let msg = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["error"] as? String
                    self.showError("Server said \(code): \(msg ?? "request rejected")")
                }
            }
        }.resume()
    }

    /// Extensions may not touch `UIApplication.shared`, but the hosting `UIApplication` is
    /// still in the responder chain. Find it there and call the modern
    /// `open(_:options:completionHandler:)`; iOS 26 rejects the old `openURL:` selector
    /// outright ("BUG IN CLIENT OF UIKIT ... Force returning false"). Verified in the
    /// iOS 26.3.1 simulator (ADR 0027).
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
