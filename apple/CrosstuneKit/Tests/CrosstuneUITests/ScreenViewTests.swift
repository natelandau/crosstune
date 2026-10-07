import CrosstuneAnalytics
import CrosstuneTestSupport
import Foundation
import SwiftUI
import Testing

@testable import CrosstuneUI

/// Each destination's root view reports one screen view, so the analytics funnel sees every
/// place the musician can open. The scan reads the source because the modifier fires from
/// `onAppear`, which a unit test cannot drive without the full shell.
@Suite struct ScreenViewTests {
    private static let expected: [(file: String, screen: String)] = [
        ("Catalog/CatalogScreen.swift", "catalog"),
        ("Tune/TuneScreen.swift", "tune"),
        ("Lists/ListsScreen.swift", "lists"),
        ("Lists/ListScreen.swift", "list"),
        ("Recordings/RecordingsScreen.swift", "recordings"),
        ("RecordingScreen/RecordingScreen.swift", "recording"),
        ("Phone/SettingsRoot.swift", "settings"),
        ("Mac/MacSettingsTabs.swift", "settings"),
        ("Stats/StatsScreen.swift", "stats"),
        ("Pad/Stand.swift", "stand"),
    ]

    /// The screens `text` reports, read with every `//` comment removed, so a comment that names
    /// the modifier never counts as a use.
    static func uses(_ text: String) -> [String] {
        SourceScan.withoutComments(text).matches(of: /\.screenView\(\.(\w+)[,)]/).map { String($0.1) }
    }

    private static func text(at file: String) throws -> String {
        try SourceScan.text(at: SourceScan.sources.appending(path: file))
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
    private let hasWindowServer = CGSessionCopyCurrentDictionary() != nil

    /// Stands in for a page whose content swaps to "Deleting" while a delete runs.
    @MainActor @Observable private final class Page {
        var shown = true
        var present = true
    }

    private struct SwappingPage: View {
        let page: Page
        @State private var visit = false

        var body: some View {
            if page.present {
                if page.shown {
                    Text(verbatim: "Tune").screenView(.tune, visit: $visit, stillShown: { page.shown })
                } else {
                    Text(verbatim: "Deleting")
                }
            }
        }
    }

    @MainActor
    @Suite(.enabled(if: hasWindowServer, "Needs a window server to run onAppear"))
    struct ScreenViewEnvironmentTests {
        private func host(_ view: some View) -> NSWindow {
            let window = hiddenWindow(
                size: CGSize(width: 200, height: 100), styleMask: [.borderless], appearance: .aqua)
            window.contentView = NSHostingView(rootView: view)
            window.orderFrontRegardless()
            return window
        }

        private func settle(until done: () -> Bool) async {
            for _ in 0..<40 where !done() {
                try? await Task.sleep(for: .milliseconds(25))
            }
        }

        @Test func reportsToTheClientInTheViewsEnvironment() async {
            let sink = RecordingAnalyticsSink()
            let window = host(Text(verbatim: "Stats").screenView(.stats).environment(\.analytics, sink.client))
            defer { window.close() }

            await settle { sink.calls.count >= 2 }

            #expect(sink.calls == [.screen(.stats), .capture("stats_viewed", [:])])
        }

        @Test func contentBackFromAFailedDeleteIsTheSameVisit() async {
            let sink = RecordingAnalyticsSink()
            let page = Page()
            let window = host(SwappingPage(page: page).environment(\.analytics, sink.client))
            defer { window.close() }
            await settle { !sink.calls.isEmpty }

            page.shown = false
            await settle { false }
            page.shown = true
            await settle { false }

            #expect(sink.calls == [.screen(.tune)])
        }

        @Test func returningToTheScreenIsANewVisit() async {
            let sink = RecordingAnalyticsSink()
            let page = Page()
            let window = host(SwappingPage(page: page).environment(\.analytics, sink.client))
            defer { window.close() }
            await settle { !sink.calls.isEmpty }

            page.present = false
            await settle { false }
            page.present = true
            await settle { sink.calls.count >= 2 }

            #expect(sink.calls == [.screen(.tune), .screen(.tune)])
        }
    }
#endif

#if os(macOS)
    @MainActor
    @Suite(.enabled(if: hasWindowServer, "Needs a window server to run onAppear"))
    struct HostedAnalyticsWiringTests {
        private func host(_ view: some View) -> NSWindow {
            let window = hiddenWindow(
                size: CGSize(width: 400, height: 300), styleMask: [.borderless], appearance: .aqua)
            window.contentView = NSHostingView(rootView: view)
            window.orderFrontRegardless()
            return window
        }

        private func settle(until done: () -> Bool) async {
            for _ in 0..<40 where !done() {
                try? await Task.sleep(for: .milliseconds(25))
            }
        }

        @Test func theReadingPaneReportsTheKindItOpensOn() async {
            let sink = RecordingAnalyticsSink()
            let reading = StandReading(tuneID: "t1", scans: [], lyrics: "Oh the cuckoo")
            let window = host(ReadingPane(reading: reading).environment(\.analytics, sink.client))
            defer { window.close() }

            await settle { !sink.calls.isEmpty }

            #expect(sink.calls == [.capture("lyrics_opened", [:])])
        }

        @Test func quittingRunsTheQuitWork() async {
            let center = NotificationCenter()
            let quits = Counter()
            let window = host(Color.clear.onAppQuit(center: center) { quits.value += 1 })
            defer { window.close() }
            await settle { false }

            center.post(name: NSApplication.willTerminateNotification, object: nil)
            await settle { quits.value > 0 }

            #expect(quits.value == 1)
        }
    }

    @MainActor private final class Counter {
        var value = 0
    }
#endif
