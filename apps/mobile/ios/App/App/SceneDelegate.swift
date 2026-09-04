import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // A share stashed by the extension while unpaired is handed to the web layer before it
        // boots, so `App.tsx` can replay it once the owner signs in (ADR 0027).
        Pairing.adoptPendingShare()

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Keep the App Group copy of the pairing values current for the Share Extension.
        Pairing.mirrorFromCapacitor()
    }

    func sceneWillResignActive(_ scene: UIScene) {
        Pairing.mirrorFromCapacitor()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // `doubletake://share` from the extension: pick up the pending share, then let the
        // Capacitor `appUrlOpen` listener navigate.
        if URLContexts.contains(where: { $0.url.scheme == "doubletake" }) {
            Pairing.adoptPendingShare()
        }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
