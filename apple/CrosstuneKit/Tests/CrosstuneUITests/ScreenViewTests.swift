import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import SwiftUI
import Testing

@testable import CrosstuneUI

/// Each destination's root view reports one screen view, so the analytics funnel sees every
/// place the musician can open. The scan reads the source because the modifier fires from
/// `onAppear`, which a unit test cannot drive without the full shell.
struct ScreenViewTests {
    private static let expected: [(file: String, screen: String)] = [
        ("Catalog/CatalogScreen.swift", "catalog"),
        ("Tune/TuneScreen.swift", "tune"),
        ("Lists/ListsScreen.swift", "lists"),
        ("Lists/ListScreen.swift", "list"),
        ("Recordings/RecordingsScreen.swift", "recordings"),
        ("Tuner/TunerScreen.swift", "tuner"),
        ("RecordingPage/RecordingPage.swift", "recording"),
        ("Phone/SettingsRoot.swift", "settings"),
        ("Mac/MacSettingsTabs.swift", "settings"),
        ("Stats/StatsScreen.swift", "stats"),
        ("Welcome/WelcomeView.swift", "welcome"),
        ("Links/FindRecordingsSheet.swift", "findRecordings"),
    ]

    /// The screens `text` reports, read with every `//` comment removed, so a comment that names
    /// the modifier never counts as a use.
    static func uses(_ text: String) -> [String] {
        SourceScan.withoutComments(text).matches(of: /\.screenView\(\.(\w+)[,)]/).map { String($0.1) }
    }

    private static func text(at file: String) throws -> String {
        try SourceScan.text(at: SourceScan.url(of: file))
    }

    @Test func eachDestinationReportsItsScreenOnce() throws {
        var wrong: [String] = []
        for (file, screen) in Self.expected where Self.uses(try Self.text(at: file)) != [screen] {
            wrong.append("\(file) expected .screenView(.\(screen))")
        }
        #expect(wrong.isEmpty, "Add exactly one: \(wrong)")
    }

    @Test func aCommentNamingTheModifierIsNotAUse() {
        let text = """
            // Not here: .screenView(.stats)
            List {}.screenView(.catalog)  // nor .screenView(.tune)
            """
        #expect(Self.uses(text) == ["catalog"])
    }

    @Test func noOtherFileReportsAScreen() throws {
        let known = Set(Self.expected.map(\.file) + ["Shell/ScreenView.swift"])
        var extra: [String] = []
        for file in SourceScan.files() {
            let relative = SourceScan.relative(file)
            guard !known.contains(relative) else { continue }
            if SourceScan.withoutComments(try SourceScan.text(at: file)).contains(".screenView(") {
                extra.append(relative)
            }
        }
        #expect(extra.isEmpty, "Screen views belong on a destination's root view: \(extra)")
    }
}

#if os(macOS)
    import AppKit

    /// Whether a window server runs, so a hosted view gets `onAppear`. A runner without a login
    /// session has none.
    let hasWindowServer = CGSessionCopyCurrentDictionary() != nil

    /// Fakes a page whose content swaps to "Deleting" while a delete runs.
    @MainActor @Observable private final class Page {
        var shown = true
        var present = true
        /// What has appeared and disappeared, in order, so a test knows a swap has rendered.
        @ObservationIgnored var lifecycle: [String] = []
    }

    private struct SwappingPage: View {
        let page: Page
        // periphery:ignore - read through its binding
        @State private var visit = false

        var body: some View {
            if page.present {
                if page.shown {
                    Text(verbatim: "Tune").screenView(.tune, visit: $visit, stillShown: { page.shown })
                        .onAppear { page.lifecycle.append("tune") }
                        .onDisappear { page.lifecycle.append("tune gone") }
                } else {
                    Text(verbatim: "Deleting").onAppear { page.lifecycle.append("deleting") }
                }
            }
        }
    }

    @MainActor
    @Suite(.timeLimit(.minutes(1)), .enabled(if: hasWindowServer, "Needs a window server to run onAppear"))
    struct ScreenViewEnvironmentTests {
        private func host(_ view: some View) -> NSWindow {
            let window = hiddenWindow(
                size: CGSize(width: 200, height: 100), styleMask: [.borderless], appearance: .aqua)
            window.contentView = NSHostingView(rootView: view)
            window.orderFrontRegardless()
            return window
        }

        @Test func reportsToTheClientInTheViewsEnvironment() async throws {
            let sink = RecordingAnalyticsSink()
            let window = host(Text(verbatim: "Stats").screenView(.stats).environment(\.analytics, sink.client))
            defer { window.close() }

            try await eventually { !sink.calls.isEmpty }

            #expect(sink.calls == [.screen(.stats)])
        }

        @Test func contentBackFromAFailedDeleteIsTheSameVisit() async throws {
            let sink = RecordingAnalyticsSink()
            let page = Page()
            let window = host(SwappingPage(page: page).environment(\.analytics, sink.client))
            defer { window.close() }
            try await eventually { !sink.calls.isEmpty }

            page.shown = false
            // SwiftUI runs the new content's onAppear before the old content's onDisappear.
            try await eventually { page.lifecycle.last == "tune gone" }
            page.shown = true
            try await eventually { page.lifecycle.last == "tune" }

            #expect(sink.calls == [.screen(.tune)])
        }

        @Test func returningToTheScreenIsANewVisit() async throws {
            let sink = RecordingAnalyticsSink()
            let page = Page()
            let window = host(SwappingPage(page: page).environment(\.analytics, sink.client))
            defer { window.close() }
            try await eventually { !sink.calls.isEmpty }

            page.present = false
            try await eventually { page.lifecycle.last == "tune gone" }
            page.present = true
            try await eventually { sink.calls.count >= 2 }

            #expect(sink.calls == [.screen(.tune), .screen(.tune)])
        }
    }
#endif

#if os(macOS)
    @MainActor
    @Suite(.timeLimit(.minutes(1)), .enabled(if: hasWindowServer, "Needs a window server to run onAppear"))
    struct HostedAnalyticsWiringTests {
        private func host(_ view: some View) -> NSWindow {
            let window = hiddenWindow(
                size: CGSize(width: 400, height: 300), styleMask: [.borderless], appearance: .aqua)
            window.contentView = NSHostingView(rootView: view)
            window.orderFrontRegardless()
            return window
        }

        @Test func quittingRunsTheQuitWork() async throws {
            let center = NotificationCenter()
            let quits = Counter()
            let appeared = Counter()
            let window = host(
                Color.clear.onAppQuit(center: center) { quits.value += 1 }.onAppear { appeared.value += 1 })
            defer { window.close() }
            try await eventually { appeared.value > 0 }

            center.post(name: NSApplication.willTerminateNotification, object: nil)
            try await eventually { quits.value > 0 }

            #expect(quits.value == 1)
        }
    }

    @MainActor private final class Counter {
        var value = 0
    }
#endif
