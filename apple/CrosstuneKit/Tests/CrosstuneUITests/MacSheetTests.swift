#if os(macOS)
    import AppKit
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor @Observable
    private final class LateLines {
        var lines = 0
    }

    private struct LateLinesView: View {
        let model: LateLines

        var body: some View {
            VStack(spacing: 0) {
                ForEach(0..<model.lines, id: \.self) { _ in Color.clear.frame(height: 20) }
            }
        }
    }

    @MainActor
    private final class SeenContainers {
        var seen: [String: MacContainer] = [:]
    }

    /// Records the container it is drawn in under `name`.
    private struct ContainerProbe: View {
        let name: String
        let box: SeenContainers

        @Environment(\.macContainer) private var container

        var body: some View {
            Color.clear.frame(width: 10, height: 10).onAppear { box.seen[name] = container }
        }
    }

    @MainActor
    @Suite struct MacSheetTests {
        /// The sheets drawn on ``MacSheet`` on the Mac, by path under `Sources/CrosstuneUI`. A
        /// sheet joins this list in the change that moves it onto the scaffold.
        static let migratedSheets = [
            "Links/LinkSheet.swift", "TuneForm/TuneFormSheet.swift", "Selection/BulkEditSheet.swift",
            "Catalog/CatalogFilterSheet.swift", "Lists/ListNameSheet.swift", "Lists/ListPickerSheet.swift",
            "Lists/TunePickerSheet.swift", "Lists/WhatPlaysSheet.swift", "Import/ImportSheet.swift",
            "Recordings/RecordingsFilterSheet.swift", "Recordings/EditRecordingSheet.swift",
            "Recordings/PlaceSearchView.swift", "Recordings/AddToTuneSheet.swift", "Recording/RecordSheet.swift",
            "Links/FindRecordingsSheet.swift", "Lyrics/LyricsReader.swift", "Scans/ScanViewer.swift",
            "Stats/StatsSheet.swift", "Account/ExportDataSheet.swift", "Account/DeleteAccountSheet.swift",
            "Settings/MusicServicesSheet.swift", "Account/AccountSections.swift", "Plan/PlanSheet.swift",
            "Plan/NoticeSheet.swift", "Shell/UpdatePrompt.swift", "Recordings/NameLocationSheet.swift",
            "Settings/SavedLocationDetail.swift",
        ]

        /// Sheets that push a screen (place search, trim), which keep their navigation on the Mac.
        static let pushingSheets = ["Recordings/EditRecordingSheet.swift", "RecordingScreen/RecordingScreen.swift"]

        @Test func macSheetMapsCancelAndDefaultKeys() {
            let cancel = MacSheetAction.cancel("Cancel") {}
            let save = MacSheetAction("Save") {}
            let roles = MacSheetAction.keyboardRoles(cancel: cancel, primary: save)
            #expect(roles == .init(cancel: .cancellation, primary: .defaultAction))

            let quiet = MacSheetAction("Save", isDefault: false) {}
            #expect(MacSheetAction.keyboardRoles(cancel: nil, primary: quiet) == .init())

            // A cancel slot answers Escape even when the action asks for Return.
            let stubborn = MacSheetAction("Close", role: .secondary, isDefault: true) {}
            #expect(
                MacSheetAction.keyboardRoles(cancel: stubborn, primary: nil).cancel == .cancellation)
        }

        /// A sheet that gives Escape its own action, such as a picker that empties its search
        /// first, takes Escape from the cancel slot, which still closes on a click.
        @Test func aSheetsOwnEscapeTakesEscapeFromCancel() {
            let cancel = MacSheetAction.cancel("Cancel") {}
            #expect(MacSheetAction.keyboardRoles(cancel: cancel, primary: nil, ownEscape: true).cancel == nil)
            #expect(
                MacSheetAction.keyboardRoles(cancel: cancel, primary: nil, ownEscape: false).cancel == .cancellation)
        }

        /// Escape's first press in a search that holds text empties it and goes no further; only
        /// the next one closes.
        @Test func escapeEmptiesASearchBeforeItCloses() {
            var query = "reel"
            var closes = 0
            let binding = Binding(get: { query }, set: { query = $0 })
            FilterSearchField.escape(clearing: binding) { closes += 1 }
            #expect(query.isEmpty)
            #expect(closes == 0)
            FilterSearchField.escape(clearing: binding) { closes += 1 }
            #expect(closes == 1)
            #expect(FilterSearchField.clearOnEscape(binding) == false)
        }

        /// Each kind of sheet reads its title one way: only a notice wears the mark, only a
        /// reading sheet masks its title and draws it as a page title, only danger leads with
        /// the glyph.
        @Test func eachSheetStyleSetsItsTitle() {
            typealias Style = MacSheet<EmptyView, EmptyView, EmptyView>.Style
            let styles: [Style] = [.sheet, .notice, .reading, .danger]
            #expect(styles.filter(\.showsMark) == [.notice])
            #expect(styles.filter(\.masksTitle) == [.reading])
            #expect(styles.filter { $0.titleStyle == .page } == [.reading])
            #expect(styles.filter { $0.symbol != nil } == [.danger])
        }

        @Test func purchaseActionIsNeverDefault() {
            let subscribe = MacSheetAction.subscribe(title: "Subscribe") {}
            #expect(subscribe.isDefault == false)
            #expect(subscribe.role == .primary)
            let disabled = MacSheetAction.subscribe(title: "Subscribe", isEnabled: false) {}
            #expect(disabled.isDefault == false)
            #expect(MacSheetAction.keyboardRoles(cancel: nil, primary: subscribe).primary == nil)
        }

        /// A purchase in the primary slot answers neither Return nor the sheet's opening focus,
        /// so neither a stray Return nor Space starts one in a sheet that opened unasked.
        @Test func aPurchaseNeverTakesReturnOrTheOpeningFocus() {
            let subscribe = MacSheetAction.subscribe(title: "Subscribe") {}
            #expect(subscribe.isPurchase)
            #expect(subscribe.answersReturn == false)
            #expect(subscribe.takesDefaultFocus == false)
            #expect(MacSheetAction.keyboardRoles(cancel: nil, primary: subscribe).primary == nil)

            let ok = MacSheetAction("OK") {}
            #expect(ok.isPurchase == false)
            #expect(ok.takesDefaultFocus)
            let quiet = MacSheetAction("Done", isDefault: false) {}
            #expect(quiet.takesDefaultFocus == false)
        }

        /// The scaffold opens on a default primary, and otherwise on an anchor that draws nothing,
        /// so no control (a disabled Save's neighbor, a purchase) opens wearing a ring.
        @Test func macSheetOpensOnTheDefaultPrimaryOrTheAnchor() throws {
            #expect(MacSheetAction.openingFocus(primary: .init("Save") {}) == .primary)
            #expect(MacSheetAction.openingFocus(primary: .init("Save", isEnabled: false) {}) == .anchor)
            #expect(MacSheetAction.openingFocus(primary: .init("Done", isDefault: false) {}) == .anchor)
            #expect(MacSheetAction.openingFocus(primary: .subscribe(title: "Subscribe") {}) == .anchor)
            #expect(MacSheetAction.openingFocus(primary: nil) == .anchor)

            let text = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.sources.appending(path: "Mac/MacSheet.swift")))
            #expect(text.contains(".defaultFocus($openingFocus, Action.openingFocus(primary: primary))"))
            #expect(text.contains(".focused($openingFocus, equals: .anchor)"))
            #expect(text.contains(".focused($openingFocus, equals: .primary)"))
        }

        /// A fitted sheet whose content arrives after it shows, such as lists that load, grows to
        /// hold it: the sheet's frame can no longer be squeezed under its content, so the sheet's
        /// window follows.
        @Test func fittedSheetGrowsWhenItsContentArrivesLate() throws {
            let model = LateLines()
            let sheet = MacSheet(
                title: "Title", size: .fitted(max: 600), cancel: .cancel("Cancel") {}, primary: .init("Save") {}
            ) {
                LateLinesView(model: model)
            }
            let host = NSHostingController(rootView: sheet)
            let window = hiddenWindow(size: CGSize(width: 480, height: 300), styleMask: [], appearance: .aqua)
            defer { window.close() }
            window.contentViewController = host
            let squeezed = { host.sizeThatFits(in: CGSize(width: MacSheetSize.formWidth, height: 0)).height }
            let settle = {
                for _ in 0..<10 {
                    host.view.layoutSubtreeIfNeeded()
                    RunLoop.main.run(until: .now)
                }
            }
            settle()
            let opened = squeezed()
            model.lines = 6
            settle()
            #expect(squeezed() - opened == 120)
            model.lines = 100
            settle()
            #expect(squeezed() == 600)
        }

        /// The titles a purchase button wears.
        private static let purchaseTitles = ["PlanText.subscribe", "NoticeText.subscribeAnnual"]

        /// ``MacSheetAction/subscribe(title:isEnabled:action:)`` is the one way to build a
        /// purchase, so no sheet can make one its default: any other initializer handed a purchase
        /// title fails here.
        @Test func purchaseActionsAreBuiltOnlyBySubscribe() throws {
            let builders = #"(MacSheetAction|MacSheet\.Action|Action|\.init)\(\s*"#
            let titles = Self.purchaseTitles.map { NSRegularExpression.escapedPattern(for: $0) }
            let pattern = try NSRegularExpression(pattern: builders + "(" + titles.joined(separator: "|") + ")")
            let slip = "MacSheet.Action(\n    NoticeText.subscribeAnnual(price)) {}"
            #expect(pattern.firstMatch(in: slip, range: NSRange(slip.startIndex..., in: slip)) != nil)
            for file in SourceScan.files() {
                let text = SourceScan.withoutComments(try SourceScan.text(at: file))
                let range = NSRange(text.startIndex..., in: text)
                #expect(
                    pattern.firstMatch(in: text, range: range) == nil,
                    "\(SourceScan.relative(file)) builds a purchase action without .subscribe(title:)")
            }
        }

        /// What a call that may build a footer action starts with: the type's name, or `.init`
        /// handed to a footer slot.
        private static let actionBuilder =
            /(?:\bMacSheetAction|\bMacSheet\.Action|\bAction|(?:primary|secondary|cancel):\s*\.init|=\s*\.init)\(/

        /// A call into a purchase: subscribing, buying, or purchasing, under any name that says so.
        private static let purchaseCall = /\w*(?:[Ss]ubscribe|[Bb]uy|[Pp]urchase)\w*\s*\(|action:\s*\w*[Ss]ubscribe/

        /// The footer actions in `text` built some way other than `.subscribe(title:)` whose title
        /// or closure reaches a purchase.
        static func purchasesOutsideSubscribe(in text: String) -> [String] {
            text.matches(of: actionBuilder).compactMap { match in
                let open = text.index(before: match.range.upperBound)
                let call = SourceScan.call(in: text, opening: open)
                return call.contains(purchaseCall) ? String(text[match.range.lowerBound..<call.endIndex]) : nil
            }
        }

        @Test func purchaseScanCatchesAClosureThatBuys() {
            #expect(Self.purchaseViolations("primary: .init(\"Go\") { Task { await purchase.buy(from: entry) } }") == 1)
            #expect(Self.purchaseViolations("MacSheetAction(PlanText.go, action: onSubscribe)") == 1)
            #expect(Self.purchaseViolations("secondary: .init(\"Go\", isDefault: false) {\n    macSubscribe()\n}") == 1)
            #expect(Self.purchaseViolations(".subscribe(title: PlanText.subscribe, action: subscribe)") == 0)
            #expect(Self.purchaseViolations("primary: .init(PlanSheet.close, action: close)") == 0)
            #expect(
                Self.purchaseViolations("MacSheetAction(PlanText.restore) { Task { await purchase.restore() } }") == 0)
        }

        private static func purchaseViolations(_ text: String) -> Int { purchasesOutsideSubscribe(in: text).count }

        /// Only `.subscribe(title:)` builds an action that buys, so no other footer action, by its
        /// closure or the function it is handed, can start a purchase on Return.
        @Test func noOtherActionReachesAPurchase() throws {
            for file in SourceScan.files() {
                let text = SourceScan.withoutComments(try SourceScan.text(at: file))
                let found = Self.purchasesOutsideSubscribe(in: text)
                #expect(found.isEmpty, "\(SourceScan.relative(file)): \(found.joined(separator: "\n"))")
            }
        }

        /// What a sheet size is spelled as when it fits its content.
        private static let fittedSize = /\.fitted\(|fittedOverSettings/

        /// The bodies of the fitted ``MacSheet``s in `text`, a size named by a static in the same
        /// text included.
        static func fittedSheetCalls(in text: String) -> [Substring] {
            let fittedNames = Set(
                text.matches(of: /static (?:let|var) (\w+)(?:: MacSheetSize)? = (?:MacSheetSize)?[^\n]*/)
                    .filter { $0.output.0.contains(fittedSize) }
                    .map { String($0.output.1) })
            return text.ranges(of: "MacSheet(").compactMap { range in
                let call = SourceScan.call(in: text, opening: text.index(before: range.upperBound))
                guard let size = call.firstMatch(of: /size:\s*([^,\n]+)/) else { return nil }
                let spelled = size.output.1
                let named = spelled.split(separator: ".").last.map(String.init) ?? ""
                return spelled.contains(fittedSize) || fittedNames.contains(named) ? call : nil
            }
        }

        @Test func fittedScanFindsTheBody() {
            let text = """
                static let macSize = MacSheetSize.fitted(max: 400)
                var body: some View {
                    MacSheet(title: "T", size: Self.macSize, cancel: nil, primary: nil) {
                        Form { Text("a") }
                    }
                }
                """
            #expect(Self.fittedSheetCalls(in: text).count == 1)
            #expect(Self.fittedSheetCalls(in: text).first?.contains("Form {") == true)
            #expect(
                Self.fittedSheetCalls(in: text.replacingOccurrences(of: ".fitted(max: 400)", with: ".picker"))
                    .isEmpty)
        }

        /// A fitted sheet scrolls its body itself, and a `Form`, a `List`, or a scroll of its own
        /// inside that scroll view collapses to nothing.
        @Test func fittedSheetBodiesHoldNoScrollingContainer() throws {
            for path in Self.migratedSheets {
                let file = SourceScan.sources.appending(path: path)
                let text = SourceScan.macCompiled(
                    SourceScan.withoutComments(SourceScan.withoutPreviews(try SourceScan.text(at: file))))
                for call in Self.fittedSheetCalls(in: text) {
                    for container in ["Form {", "List {", "List(", "MacFormScroll {", "ScrollView {"] {
                        #expect(!call.contains(container), "\(path) puts \(container) in a fitted sheet")
                    }
                }
            }
        }

        @Test func cancelFactoryIsSecondaryAndNeverDefault() {
            let cancel = MacSheetAction.cancel("Cancel", isEnabled: false) {}
            #expect(cancel.role == .secondary)
            #expect(cancel.isDefault == false)
            #expect(cancel.isEnabled == false)
        }

        @Test func macSheetsLeaveNoNavigationStackOnTheMac() throws {
            for path in Self.migratedSheets {
                let file = SourceScan.sources.appending(path: path)
                let text = SourceScan.withoutComments(SourceScan.withoutPreviews(try SourceScan.text(at: file)))
                let mac = SourceScan.macCompiled(text)
                #expect(
                    mac.contains("MacSheet("),
                    "\(path) draws no MacSheet on the Mac")
                if !Self.pushingSheets.contains(path) {
                    #expect(!mac.contains("NavigationStack"), "\(path) keeps a NavigationStack on the Mac")
                }
            }
        }

        /// A renamed or moved sheet fails here rather than dropping out of the scan above.
        @Test func migratedSheetsNameRealFiles() {
            for path in Self.migratedSheets + Self.pushingSheets {
                let file = SourceScan.sources.appending(path: path)
                #expect(FileManager.default.fileExists(atPath: file.path), "\(path) does not exist")
            }
        }

        /// The sheet's height at its ideal, which a fitted presentation proposes.
        private func fittedHeight(lines: Int, max: CGFloat) -> CGFloat {
            let sheet = MacSheet(
                title: "Title", size: .fitted(max: max), cancel: .cancel("Cancel") {}, primary: .init("Save") {}
            ) {
                VStack(spacing: 0) {
                    ForEach(0..<lines, id: \.self) { _ in Color.clear.frame(height: 20) }
                }
            }
            let host = NSHostingController(rootView: sheet.fixedSize(horizontal: false, vertical: true))
            return host.sizeThatFits(in: CGSize(width: 10_000, height: 10_000)).height
        }

        @Test func fittedSheetGrowsWithItsContentUpToItsMax() {
            let short = fittedHeight(lines: 2, max: 600)
            let longer = fittedHeight(lines: 6, max: 600)
            #expect(short < 600)
            #expect(longer - short == 80)
            #expect(fittedHeight(lines: 100, max: 600) == 600)
        }

        /// A sheet takes its presenter's environment, so one opened from a card would read the
        /// card's surface. The scaffold and every sheet root reset it to the page background; the footer keeps
        /// its own surface.
        @Test func sheetsDrawTheirBodyForThePageBackgroundWhateverPresentsThem() throws {
            let box = SeenContainers()
            let sheet = MacSheet(
                title: "Title", size: .fitted(max: 600), cancel: nil, primary: .init("Save") {},
                leading: { ContainerProbe(name: "footer", box: box) },
                content: { ContainerProbe(name: "body", box: box) })
            let root = VStack {
                sheet
                ContainerProbe(name: "root", box: box).shellSheet()
            }
            .macSurfaceContainer()
            let host = NSHostingView(rootView: root)
            let window = hiddenWindow(size: CGSize(width: 600, height: 600), styleMask: [], appearance: .aqua)
            defer { window.close() }
            window.contentView = host
            for _ in 0..<5 {
                host.layoutSubtreeIfNeeded()
                RunLoop.main.run(until: .now)
            }
            #expect(box.seen["body"] == .pageBackground)
            #expect(box.seen["root"] == .pageBackground)
            #expect(box.seen["footer"] == .surface)
        }

        @Test func fittedSheetTakesTheFormWidth() {
            let sheet = MacSheet(title: "Title", size: .fitted(max: 600), cancel: nil, primary: nil) {
                Text("Body")
            }
            let host = NSHostingController(rootView: sheet)
            #expect(host.sizeThatFits(in: CGSize(width: 10_000, height: 10_000)).width == MacSheetSize.formWidth)
        }
    }
#endif
