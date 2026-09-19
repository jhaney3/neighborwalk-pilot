import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var privacyCover: UIView?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = NeighborWalkViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        guard let window = window, privacyCover == nil else { return }
        let cover = UIView(frame: window.bounds)
        cover.backgroundColor = UIColor(red: 0.96, green: 0.965, blue: 0.95, alpha: 1)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let title = UILabel()
        title.text = "NeighborWalk"
        title.font = .systemFont(ofSize: 28, weight: .semibold)
        title.textColor = UIColor(red: 0.13, green: 0.30, blue: 0.24, alpha: 1)
        title.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(title)
        NSLayoutConstraint.activate([title.centerXAnchor.constraint(equalTo: cover.centerXAnchor), title.centerYAnchor.constraint(equalTo: cover.centerYAnchor)])
        window.addSubview(cover)
        privacyCover = cover
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyCover?.removeFromSuperview()
        privacyCover = nil
    }
}

class NeighborWalkViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NeighborWalkPrintPlugin())
        webView?.scrollView.bounces = false
    }
}

@objc(NeighborWalkPrintPlugin)
class NeighborWalkPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NeighborWalkPrintPlugin"
    let jsName = "NeighborWalkPrint"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise)]

    @objc func print(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else { call.reject("The worksheet is unavailable."); return }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = "NeighborWalk field worksheet"
            info.outputType = .general
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            let completion: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                if let error = error { call.reject(error.localizedDescription) }
                else { call.resolve(["completed": completed]) }
            }
            if UIDevice.current.userInterfaceIdiom == .pad {
                controller.present(from: CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1), in: webView, animated: true, completionHandler: completion)
            } else {
                controller.present(animated: true, completionHandler: completion)
            }
        }
    }
}
