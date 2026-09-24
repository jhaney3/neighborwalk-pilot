import UIKit
import Capacitor
import AuthenticationServices

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
        // Matches the app's paper background (--bg-grouped) in both appearances.
        cover.backgroundColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 18 / 255, green: 23 / 255, blue: 20 / 255, alpha: 1)
                : UIColor(red: 241 / 255, green: 242 / 255, blue: 236 / 255, alpha: 1)
        }
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let title = UILabel()
        title.text = "NeighborWalk"
        let titleFont = UIFont.systemFont(ofSize: 28, weight: .semibold)
        title.font = titleFont.fontDescriptor.withDesign(.serif).map { UIFont(descriptor: $0, size: 28) } ?? titleFont
        title.textColor = .label
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
        bridge?.registerPluginInstance(NeighborWalkApplePlugin())
        bridge?.registerPluginInstance(NeighborWalkGooglePlugin())
        bridge?.registerPluginInstance(NeighborWalkAppearancePlugin())
        webView?.scrollView.bounces = false
    }
}

@objc(NeighborWalkAppearancePlugin)
class NeighborWalkAppearancePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NeighborWalkAppearancePlugin"
    let jsName = "NeighborWalkAppearance"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "setTheme", returnType: CAPPluginReturnPromise)]

    @objc func setTheme(_ call: CAPPluginCall) {
        guard let theme = call.getString("theme"), theme == "light" || theme == "dark" else {
            call.reject("Choose light or dark appearance.")
            return
        }
        DispatchQueue.main.async {
            let style: UIUserInterfaceStyle = theme == "dark" ? .dark : .light
            self.bridge?.viewController?.overrideUserInterfaceStyle = style
            self.bridge?.viewController?.view.window?.overrideUserInterfaceStyle = style
            self.bridge?.viewController?.setNeedsStatusBarAppearanceUpdate()
            call.resolve()
        }
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

@objc(NeighborWalkApplePlugin)
class NeighborWalkApplePlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    let identifier = "NeighborWalkApplePlugin"
    let jsName = "NeighborWalkApple"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)]
    private var pending: CAPPluginCall?
    private var controller: ASAuthorizationController?
    private var expectedState: String?
    private var anchor: UIWindow?

    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("Apple sign-in is already open."); return }
            guard let nonce = call.getString("nonce"), nonce.count == 64,
                  let anchor = self.bridge?.viewController?.view.window else { call.reject("Apple sign-in is unavailable."); return }
            self.anchor = anchor
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = nonce
            let state = UUID().uuidString
            request.state = state
            self.expectedState = state
            self.pending = call
            let controller = ASAuthorizationController(authorizationRequests: [request])
            self.controller = controller
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return anchor ?? ASPresentationAnchor()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { pending = nil; self.controller = nil; expectedState = nil; anchor = nil }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              credential.state == expectedState,
              let data = credential.identityToken,
              let token = String(data: data, encoding: .utf8) else {
            pending?.reject("Apple could not verify this sign-in. Please try again."); return
        }
        var result: [String: Any] = ["identityToken": token]
        if let data = credential.authorizationCode, let code = String(data: data, encoding: .utf8) {
            result["authorizationCode"] = code
        }
        if let name = credential.fullName {
            let formatted = PersonNameComponentsFormatter().string(from: name)
            if !formatted.isEmpty { result["fullName"] = formatted }
        }
        pending?.resolve(result)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        pending?.reject(cancelled ? "Apple sign-in was cancelled." : "Apple sign-in could not finish. Please try again.", cancelled ? "CANCELLED" : "APPLE_AUTH_FAILED")
        pending = nil; self.controller = nil; expectedState = nil; anchor = nil
    }
}

@objc(NeighborWalkGooglePlugin)
class NeighborWalkGooglePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    let identifier = "NeighborWalkGooglePlugin"
    let jsName = "NeighborWalkGoogle"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)]
    private var session: ASWebAuthenticationSession?
    private var anchor: UIWindow?

    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.session == nil else { call.reject("Google sign-in is already open."); return }
            guard let value = call.getString("url"), let url = URL(string: value),
                  let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
                  url.path == "/auth/v1/authorize",
                  parts.queryItems?.first(where: { $0.name == "provider" })?.value == "google",
                  parts.queryItems?.first(where: { $0.name == "redirect_to" })?.value == "neighborwalk://google-auth",
                  let anchor = self.bridge?.viewController?.view.window else {
                call.reject("Google sign-in could not be opened."); return
            }
            self.anchor = anchor
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "neighborwalk") { callback, error in
                DispatchQueue.main.async {
                    defer { self.session = nil; self.anchor = nil }
                    if let error = error {
                        let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                        call.reject(cancelled ? "Google sign-in was cancelled." : "Google sign-in could not finish. Please try again.", cancelled ? "CANCELLED" : "GOOGLE_AUTH_FAILED")
                    } else if let callback = callback, callback.scheme == "neighborwalk", callback.host == "google-auth" {
                        call.resolve(["callbackUrl": callback.absoluteString])
                    } else { call.reject("Google returned an invalid response.") }
                }
            }
            session.presentationContextProvider = self
            // Allow the system browser to reuse Google login; the account picker
            // is still requested so the user explicitly chooses their account.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil; self.anchor = nil
                call.reject("Google sign-in could not start. Please try again.")
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return anchor ?? ASPresentationAnchor()
    }
}
