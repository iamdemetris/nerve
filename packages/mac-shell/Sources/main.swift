// A native macOS shell for the Nerve workbench.
//
// Electron ships an entire Chromium runtime per app: a main process, a GPU
// process, a network service, and a renderer. This shell instead uses WKWebView,
// which reuses the WebKit runtime already resident on macOS, so the only cost
// beyond the page itself is a thin AppKit host.
//
// It also owns the daemon lifecycle. Launching from the Dock must "just work",
// so the app starts the daemon when one is not already listening and adopts a
// running one otherwise.

import AppKit
import WebKit

// MARK: - Configuration

/// Build-time values injected into Info.plist so the bundle is relocatable.
enum Config {
    static let bundle = Bundle.main

    /// Absolute path to node, captured at build time because apps launched from
    /// the Dock inherit a minimal PATH that excludes Homebrew.
    static var nodePath: String {
        bundle.object(forInfoDictionaryKey: "NerveNodePath") as? String ?? "/usr/bin/node"
    }

    /// Absolute path to the daemon's built entrypoint.
    static var daemonScript: String {
        bundle.object(forInfoDictionaryKey: "NerveDaemonScript") as? String ?? ""
    }

    static var dataDir: URL {
        if let override = ProcessInfo.processInfo.environment["NERVE_HOME"], !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nerve")
    }

    static var daemonFile: URL { dataDir.appendingPathComponent("daemon.json") }
    static var tokenFile: URL { dataDir.appendingPathComponent("auth/local-token") }
}

// MARK: - Daemon discovery

private struct DaemonDescriptor: Decodable {
    let url: String?
    let stale: Bool?
}

enum Daemon {
    /// Reads the descriptor the daemon writes once it is listening.
    static func advertisedURL() -> URL? {
        guard let data = try? Data(contentsOf: Config.daemonFile),
              let descriptor = try? JSONDecoder().decode(DaemonDescriptor.self, from: data),
              descriptor.stale != true,
              let raw = descriptor.url,
              let url = URL(string: raw)
        else { return nil }
        return url
    }

    /// A descriptor can outlive the process that wrote it, so confirm the port
    /// actually answers before trusting it.
    static func isListening(_ url: URL) -> Bool {
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 2
        let semaphore = DispatchSemaphore(value: 0)
        var reachable = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            reachable = (response as? HTTPURLResponse) != nil
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 3)
        return reachable
    }

    /// The token is exchanged for a session cookie on first load.
    static func authenticated(_ base: URL) -> URL {
        guard let token = try? String(contentsOf: Config.tokenFile, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !token.isEmpty,
            var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else { return base }
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        return components.url ?? base
    }

    static func spawn() -> Process? {
        let script = Config.daemonScript
        guard !script.isEmpty, FileManager.default.fileExists(atPath: script) else { return nil }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: Config.nodePath)
        process.arguments = [script, "--no-open"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            return process
        } catch {
            return nil
        }
    }

    /// Returns a reachable URL, starting the daemon only if one is not already up.
    /// Runs off the main thread; the caller marshals the result back.
    static func resolve(timeout: TimeInterval, onStart: () -> Void) -> (URL, Process?)? {
        if let url = advertisedURL(), isListening(url) { return (url, nil) }

        onStart()
        let process = spawn()
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let url = advertisedURL(), isListening(url) { return (url, process) }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return nil
    }
}

// MARK: - Application

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var spinner: NSProgressIndicator!
    /// Retained only when this app started the daemon, so an adopted daemon
    /// keeps running for other clients after this window closes.
    private var ownedDaemon: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        connect()
    }

    // MARK: Window

    private func buildWindow() {
        // A plain title bar is deliberate. With `.fullSizeContentView` the web
        // view covers the title bar, which leaves no draggable area and makes
        // the window impossible to move.
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Nerve"
        // The workbench renders dark, so match the title bar to it rather than
        // sitting a light grey bar above black content.
        window.appearance = NSAppearance(named: .darkAqua)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 960, height: 640)
        window.setFrameAutosaveName("NerveMainWindow")
        window.backgroundColor = NSColor(calibratedRed: 0.04, green: 0.05, blue: 0.07, alpha: 1)
        window.isReleasedWhenClosed = false

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 1320, height: 860))
        container.autoresizingMask = [.width, .height]

        let configuration = WKWebViewConfiguration()
        // Nerve is a local app, so let its own UI own the context menu and keep
        // media playing when the window is in the background.
        configuration.suppressesIncrementalRendering = false
        webView = WKWebView(frame: container.bounds, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.isHidden = true
        container.addSubview(webView)

        spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.startAnimation(nil)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(spinner)

        statusLabel = NSTextField(labelWithString: "Connecting to the Nerve daemon…")
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: container.centerYAnchor, constant: -18),
            statusLabel.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            statusLabel.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 14),
        ])

        window.contentView = container
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: Connection

    private func connect() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let resolved = Daemon.resolve(timeout: 90) {
                DispatchQueue.main.async {
                    self?.statusLabel.stringValue = "Starting the Nerve daemon…"
                }
            }
            DispatchQueue.main.async {
                guard let self else { return }
                guard let (url, process) = resolved else {
                    self.showFailure()
                    return
                }
                self.ownedDaemon = process
                self.purgeAssetCaches {
                    self.webView.load(URLRequest(url: Daemon.authenticated(url)))
                }
            }
        }
    }

    /// Drops the workbench's cached assets before each load.
    ///
    /// The web UI ships a PWA service worker that serves the app shell from
    /// cache. That is right for a browser tab, but here it means a rebuilt
    /// workbench keeps rendering the previous bundle until the cache happens to
    /// expire. Cookies and local storage are left alone, so the session and any
    /// saved preferences survive.
    private func purgeAssetCaches(then load: @escaping () -> Void) {
        let types: Set<String> = [
            WKWebsiteDataTypeServiceWorkerRegistrations,
            WKWebsiteDataTypeFetchCache,
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache,
        ]
        WKWebsiteDataStore.default().removeData(
            ofTypes: types,
            modifiedSince: .distantPast,
            completionHandler: load
        )
    }

    private func showFailure() {
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        statusLabel.stringValue = """
        Could not reach the Nerve daemon.
        Start it with "pnpm serve" in the project, then reopen this app.
        """
        statusLabel.alignment = .center
        statusLabel.maximumNumberOfLines = 0
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        statusLabel.isHidden = true
        webView.isHidden = false
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        showFailure()
    }

    /// Keeps the app on the workbench and hands anything external to the browser.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let isLocal = url.host == "127.0.0.1" || url.host == "localhost"
        if isLocal || url.scheme == "about" || url.scheme == "data" {
            decisionHandler(.allow)
            return
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    /// `target="_blank"` links have no window to open into; send them out too.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    /// Voice capture is available only to the local Nerve workbench. The OS
    /// still presents its normal app-level microphone permission on first use.
    @available(macOS 12.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        let isLocal = origin.host == "127.0.0.1" || origin.host == "localhost"
        switch type {
        case .microphone where isLocal:
            decisionHandler(.grant)
        default:
            decisionHandler(.deny)
        }
    }

    // MARK: Lifecycle

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldHandleReopen(
        _ sender: NSApplication,
        hasVisibleWindows flag: Bool
    ) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Only stop a daemon this app started, so a separately launched daemon
        // (or another window) is left alone.
        ownedDaemon?.terminate()
    }

    @objc private func reload() {
        webView.reload()
    }

    /// Bypasses every cache, for when a rebuild landed while the app was open.
    @objc private func forceReload() {
        purgeAssetCaches { [weak self] in
            self?.webView.reloadFromOrigin()
        }
    }

    @objc private func zoomIn() {
        webView.pageZoom = min(webView.pageZoom + 0.1, 3.0)
    }

    @objc private func zoomOut() {
        webView.pageZoom = max(webView.pageZoom - 0.1, 0.5)
    }

    @objc private func zoomReset() {
        webView.pageZoom = 1.0
    }

    // MARK: Menu

    /// WKWebView relies on the responder chain for editing commands, so without
    /// a real Edit menu there is no copy, paste, or select-all.
    private func buildMenu() {
        let mainMenu = NSMenu()
        let appName = "Nerve"

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "About \(appName)",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Hide \(appName)",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        let hideOthers = appMenu.addItem(
            withTitle: "Hide Others",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit \(appName)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(
            withTitle: "Redo",
            action: Selector(("redo:")),
            keyEquivalent: "z"
        )
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(
            withTitle: "Paste",
            action: #selector(NSText.paste(_:)),
            keyEquivalent: "v"
        )
        editMenu.addItem(
            withTitle: "Select All",
            action: #selector(NSText.selectAll(_:)),
            keyEquivalent: "a"
        )
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        let force = viewMenu.addItem(
            withTitle: "Force Reload",
            action: #selector(forceReload),
            keyEquivalent: "r"
        )
        force.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "Actual Size", action: #selector(zoomReset), keyEquivalent: "0")
        viewMenu.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+")
        viewMenu.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
        viewMenu.addItem(.separator())
        let fullScreen = viewMenu.addItem(
            withTitle: "Enter Full Screen",
            action: #selector(NSWindow.toggleFullScreen(_:)),
            keyEquivalent: "f"
        )
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(
            withTitle: "Minimize",
            action: #selector(NSWindow.miniaturize(_:)),
            keyEquivalent: "m"
        )
        windowMenu.addItem(
            withTitle: "Zoom",
            action: #selector(NSWindow.zoom(_:)),
            keyEquivalent: ""
        )
        windowMenu.addItem(.separator())
        windowMenu.addItem(
            withTitle: "Close Window",
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
