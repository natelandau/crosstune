import SwiftUI
import WebKit

#if os(iOS)
    import UIKit
    typealias PlatformView = UIView
#else
    import AppKit
    typealias PlatformView = NSView
#endif

extension Embed {
    /// The page the web view loads: the provider's player in a frame filling it, with the
    /// frame's permissions as the provider's embed code sets them.
    var document: String {
        let sandbox = sandbox.map { " sandbox=\"\(Self.attribute($0))\"" } ?? ""
        return """
            <!doctype html>
            <html><head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}\
            iframe{display:block;border:0;width:100%;height:100%}</style>
            </head><body>
            <iframe src="\(Self.attribute(src))" allow="\(Self.attribute(allow))"\(sandbox) \
            referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
            </body></html>
            """
    }

    /// The page's own address, which the frame sends its provider as the referrer. Providers
    /// such as YouTube refuse an embed with none, and ask a native app for its bundle id here.
    static func documentOrigin(bundleID: String?) -> URL {
        URL(string: "https://\((bundleID ?? "app.crosstune.Crosstune").lowercased())")!
    }

    private static func attribute(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}

/// Keeps the loaded link's one web view alive while the views that show it come and go, so the
/// player keeps playing as the iPhone's full player collapses to its bar, the window changes
/// layout, or another window shows the player. The app has one, beside its ``PlayerModel``, so
/// the link plays once however many windows are open. The web view sits in the most prominent
/// view showing it, and is torn down once none does.
@MainActor
public final class EmbedStage {
    /// How much a view showing the player wins the web view over another.
    enum Prominence: Int, Comparable {
        /// Off screen, holding the player so it keeps playing.
        case parked
        /// On screen, where the musician sees and touches the player.
        case shown
        /// On screen in the window the musician is using.
        case focused

        static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    private struct Host {
        let view: PlatformView
        let prominence: Prominence
        let order: Int
    }

    private var webView: WKWebView?
    private var loaded: Embed?
    private var hosts: [Host] = []
    private var attachments = 0
    private let origin = Embed.documentOrigin(bundleID: Bundle.main.bundleIdentifier)
    private lazy var delegate = EmbedDelegate(origin: origin)

    public init() {}

    /// Offers `host` the web view, loading `embed` unless it is already loaded. The most
    /// prominent host holds it, the newest of those when several are equal.
    func attach(_ host: PlatformView, embed: Embed, prominence: Prominence) {
        hosts.removeAll { $0.view === host }
        attachments += 1
        hosts.append(Host(view: host, prominence: prominence, order: attachments))
        load(embed)
        settle()
    }

    /// Ranks an attached `host` anew, as when its window becomes or stops being the one in use.
    func rank(_ host: PlatformView, prominence: Prominence) {
        guard let index = hosts.firstIndex(where: { $0.view === host }), hosts[index].prominence != prominence
        else { return }
        attachments += 1
        hosts[index] = Host(view: host, prominence: prominence, order: attachments)
        settle()
    }

    /// Loads `embed` in the web view, unless it is already loaded.
    func load(_ embed: Embed) {
        let webView = self.webView ?? makeWebView()
        guard embed != loaded else { return }
        loaded = embed
        webView.loadHTMLString(embed.document, baseURL: origin)
    }

    /// Takes `host` out of the rotation: the web view moves to the most prominent host left. With
    /// none left it is torn down, which stops playback, unless a new host arrives in the same
    /// update, as one does when the window changes layout.
    func detach(_ host: PlatformView) {
        hosts.removeAll { $0.view === host }
        guard hosts.isEmpty else {
            settle()
            return
        }
        Task { @MainActor [weak self] in
            guard let self, hosts.isEmpty else { return }
            webView?.stopLoading()
            webView?.removeFromSuperview()
            webView = nil
            loaded = nil
        }
    }

    private func settle() {
        guard let host = hosts.max(by: { ($0.prominence, $0.order) < ($1.prominence, $1.order) }) else { return }
        move(to: host.view)
    }

    private func move(to host: PlatformView) {
        guard let webView, webView.superview !== host else { return }
        webView.removeFromSuperview()
        webView.frame = host.bounds
        #if os(iOS)
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        #else
            webView.autoresizingMask = [.width, .height]
        #endif
        host.addSubview(webView)
    }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        #if os(iOS)
            configuration.allowsInlineMediaPlayback = true
            configuration.allowsPictureInPictureMediaPlayback = true
        #endif
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = delegate
        webView.uiDelegate = delegate
        #if os(iOS)
            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.isScrollEnabled = false
        #else
            // AppKit's web view has no public switch for a clear background; without this it
            // paints white behind the player, a box in dark mode.
            webView.setValue(false, forKey: "drawsBackground")
            webView.underPageBackgroundColor = .clear
        #endif
        self.webView = webView
        return webView
    }
}

/// Keeps the player's page to the player: anything that would replace the page or open a
/// window, such as a provider's "Watch on YouTube", opens in the system browser instead.
@MainActor
private final class EmbedDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    let origin: URL

    init(origin: URL) {
        self.origin = origin
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
        // The frame's own loads are the player's; only the page itself must stay put.
        guard navigationAction.targetFrame?.isMainFrame ?? true, let url = navigationAction.request.url,
            url.scheme == "http" || url.scheme == "https", url.host() != origin.host()
        else { return .allow }
        open(url)
        return .cancel
    }

    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "http" || url.scheme == "https" {
            open(url)
        }
        return nil
    }

    private func open(_ url: URL) {
        #if os(iOS)
            UIApplication.shared.open(url)
        #else
            NSWorkspace.shared.open(url)
        #endif
    }
}

/// Shows the loaded link's player from `stage`, sized by whoever places it.
struct EmbedView {
    let stage: EmbedStage
    let embed: Embed
    var prominence: EmbedStage.Prominence = .shown

    final class Coordinator {
        let stage: EmbedStage

        init(stage: EmbedStage) {
            self.stage = stage
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(stage: stage)
    }
}

#if os(iOS)
    extension EmbedView: UIViewRepresentable {
        func makeUIView(context: Context) -> UIView {
            let host = UIView()
            host.clipsToBounds = true
            stage.attach(host, embed: embed, prominence: prominence)
            return host
        }

        func updateUIView(_ host: UIView, context: Context) {
            stage.load(embed)
            stage.rank(host, prominence: prominence)
        }

        static func dismantleUIView(_ host: UIView, coordinator: Coordinator) {
            coordinator.stage.detach(host)
        }
    }
#else
    extension EmbedView: NSViewRepresentable {
        func makeNSView(context: Context) -> NSView {
            let host = NSView()
            stage.attach(host, embed: embed, prominence: prominence)
            return host
        }

        func updateNSView(_ host: NSView, context: Context) {
            stage.load(embed)
            stage.rank(host, prominence: prominence)
        }

        static func dismantleNSView(_ host: NSView, coordinator: Coordinator) {
            coordinator.stage.detach(host)
        }
    }
#endif
