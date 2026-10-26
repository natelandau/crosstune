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
@Suite struct ScreenViewTests {
    private static let expected: [(file: String, screen: String)] = [
        ("Catalog/CatalogScreen.swift", "catalog"),
        ("Tune/TuneScreen.swift", "tune"),
        ("Lists/ListsScreen.swift", "lists"),
        ("Lists/ListScreen.swift", "list"),
        ("Recordings/RecordingsScreen.swift", "recordings"),
        ("Tuner/TunerScreen.swift", "tuner"),
        ("RecordingScreen/RecordingScreen.swift", "recording"),
        ("Phone/SettingsRoot.swift", "settings"),
        ("Mac/MacSettingsTabs.swift", "settings"),
        ("Stats/StatsScreen.swift", "stats"),
        ("Pad/PadPracticeScreen.swift", "padPractice"),
        ("Welcome/WelcomeView.swift", "welcome"),
        ("Links/FindRecordingsSheet.swift", "findRecordings"),
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
    let hasWindowServer = CGSessionCopyCurrentDictionary() != nil

    /// Fakes a page whose content swaps to "Deleting" while a delete runs.
    @MainActor @Observable private final class Page {
        var shown = true
        var present = true
        /// What has appeared and disappeared, in order, so a test knows a swap has rendered.
        @ObservationIgnored var lifecycle: [String] = []
    }

    @MainActor @Observable private final class ReadingShelf {
        var reading: ReadingPaneContent
        init(_ reading: ReadingPaneContent) { self.reading = reading }
    }

    private struct ShelvedReadingPane: View {
        let shelf: ReadingShelf
        @State private var visit = PadPracticeVisit()

        var body: some View {
            ReadingPane(reading: shelf.reading, visit: visit)
        }
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

            await settle { !sink.calls.isEmpty }

            #expect(sink.calls == [.screen(.stats)])
        }

        @Test func contentBackFromAFailedDeleteIsTheSameVisit() async {
            let sink = RecordingAnalyticsSink()
            let page = Page()
            let window = host(SwappingPage(page: page).environment(\.analytics, sink.client))
            defer { window.close() }
            await settle { !sink.calls.isEmpty }

            page.shown = false
            // SwiftUI runs the new content's onAppear before the old content's onDisappear.
            await settle { page.lifecycle.last == "tune gone" }
            page.shown = true
            await settle { page.lifecycle.last == "tune" }

            #expect(sink.calls == [.screen(.tune)])
        }

        @Test func returningToTheScreenIsANewVisit() async {
            let sink = RecordingAnalyticsSink()
            let page = Page()
            let window = host(SwappingPage(page: page).environment(\.analytics, sink.client))
            defer { window.close() }
            await settle { !sink.calls.isEmpty }

            page.present = false
            await settle { page.lifecycle.last == "tune gone" }
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
        private static let scan = Scan(
            record: ScanRecord(id: "scan1", tuneID: "t1", width: 600, height: 800, state: ScanRecord.ready), file: nil)

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
            let reading = ReadingPaneContent(tuneID: "t1", scans: [], lyrics: "Oh the cuckoo")
            let window = host(
                ReadingPane(reading: reading, visit: PadPracticeVisit()).environment(\.analytics, sink.client))
            defer { window.close() }

            await settle { !sink.calls.isEmpty }

            #expect(sink.calls == [.capture("lyrics_opened", ["tune_id": .string("t1")])])
        }

        @Test func theReadingPaneReportsAKindItGainsWhileItShows() async {
            let sink = RecordingAnalyticsSink()
            let shelf = ReadingShelf(ReadingPaneContent(tuneID: "t1", scans: [], lyrics: "Oh the cuckoo"))
            let window = host(ShelvedReadingPane(shelf: shelf).environment(\.analytics, sink.client))
            defer { window.close() }
            await settle { !sink.calls.isEmpty }

            shelf.reading = ReadingPaneContent(tuneID: "t1", scans: [Self.scan], lyrics: "Oh the cuckoo")
            await settle { sink.calls.count >= 2 }

            #expect(
                sink.calls == [
                    .capture("lyrics_opened", ["tune_id": .string("t1")]),
                    .capture("scan_viewed", ["tune_id": .string("t1")]),
                ])
        }

        @Test func theReadingPaneReportsNothingForATuneTheListMovedTo() async {
            let sink = RecordingAnalyticsSink()
            let visit = PadPracticeVisit()
            _ = visit.readingShown(.scans, tuneID: "t1", picked: false)
            let reading = ReadingPaneContent(tuneID: "t2", scans: [], lyrics: "Oh the cuckoo")
            let appeared = Counter()
            let window = host(
                ReadingPane(reading: reading, visit: visit).environment(\.analytics, sink.client)
                    .onAppear { appeared.value += 1 })
            defer { window.close() }

            await settle { appeared.value > 0 }

            #expect(sink.calls.isEmpty)
        }

        @Test func quittingRunsTheQuitWork() async {
            let center = NotificationCenter()
            let quits = Counter()
            let appeared = Counter()
            let window = host(
                Color.clear.onAppQuit(center: center) { quits.value += 1 }.onAppear { appeared.value += 1 })
            defer { window.close() }
            await settle { appeared.value > 0 }

            center.post(name: NSApplication.willTerminateNotification, object: nil)
            await settle { quits.value > 0 }

            #expect(quits.value == 1)
        }
    }

    @MainActor private final class Counter {
        var value = 0
    }
#endif
