import Foundation

/// Pairing state shared between the Capacitor app and the Share Extension.
///
/// The web layer (`apps/web/src/native.ts`) stores the server URL and device token through
/// `@capacitor/preferences`, which on iOS writes to `UserDefaults.standard` under the
/// `CapacitorStorage.` prefix. An app extension cannot read another process's standard defaults,
/// so `SceneDelegate` copies those two keys into the App Group suite whenever the app becomes
/// active, and the extension reads them from there. Pending shares travel the other way: the
/// extension writes `pendingShare` when the device is unpaired, `SceneDelegate` moves it into
/// Capacitor Preferences on the next launch so `App.tsx` replays it (same flow as Android).
///
/// Keys mirror `apps/mobile/android/.../Pairing.kt`. Everything here is **unverified** on a device
/// (ADR 0027).
enum Pairing {
    /// Must match both targets' `com.apple.security.application-groups` entitlement.
    static let appGroup = "group.com.roowus.doubletake"
    static let keyServerUrl = "doubletake.serverUrl"
    static let keyToken = "doubletake.token"
    static let keyPendingShare = "doubletake.pendingShare"
    private static let capacitorPrefix = "CapacitorStorage."

    static var shared: UserDefaults? { UserDefaults(suiteName: appGroup) }

    struct Credentials {
        let serverUrl: URL
        let token: String
    }

    /// Server URL + device token from the App Group, or nil while unpaired.
    static func credentials() -> Credentials? {
        guard let d = shared,
              let raw = d.string(forKey: keyServerUrl)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let url = URL(string: raw),
              let token = d.string(forKey: keyToken), !token.isEmpty
        else { return nil }
        return Credentials(serverUrl: url, token: token)
    }

    // MARK: - App side

    /// Copy the pairing values Capacitor Preferences holds into the App Group (or clear them).
    static func mirrorFromCapacitor() {
        guard let d = shared else { return }
        let std = UserDefaults.standard
        for key in [keyServerUrl, keyToken] {
            if let v = std.string(forKey: capacitorPrefix + key), !v.isEmpty {
                d.set(v, forKey: key)
            } else {
                d.removeObject(forKey: key)
            }
        }
    }

    /// Move a share the extension stashed while unpaired into Capacitor Preferences, where
    /// `takePendingShare()` in the web layer consumes it. Returns true when one was moved.
    @discardableResult
    static func adoptPendingShare() -> Bool {
        guard let d = shared, let json = d.string(forKey: keyPendingShare), !json.isEmpty else {
            return false
        }
        d.removeObject(forKey: keyPendingShare)
        UserDefaults.standard.set(json, forKey: capacitorPrefix + keyPendingShare)
        return true
    }

    // MARK: - Extension side

    /// Stash `{url, text, title}` for the app to replay after pairing.
    static func storePendingShare(url: String?, text: String?, title: String?) {
        var obj: [String: String] = [:]
        if let url, !url.isEmpty { obj["url"] = url }
        if let text, !text.isEmpty { obj["text"] = text }
        if let title, !title.isEmpty { obj["title"] = title }
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let json = String(data: data, encoding: .utf8) else { return }
        shared?.set(json, forKey: keyPendingShare)
    }
}
