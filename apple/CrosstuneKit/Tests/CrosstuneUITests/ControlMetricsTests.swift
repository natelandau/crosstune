import Foundation
import Testing

@testable import CrosstuneDesign

struct ControlMetricsTests {
    @Test func textButtonsReachTheTouchTargetWidth() {
        #expect(ControlMetrics.minWidth(.text) == 44)
    }

    @Test(arguments: [ControlMetrics.compactHeight, ControlMetrics.regularHeight, ControlMetrics.largeHeight])
    func everyDrawnHeightUnderTheTargetStillReachesIt(height: CGFloat) {
        guard height < 44 else { return }
        #expect(tapOutset(visibleHeight: height, minimum: 44) * 2 + height == 44)
    }

    @Test func onlyProgressDrawsTheRing() {
        #expect(StatusGlyph.drawsOnChange(from: "learning", to: "known"))
        #expect(StatusGlyph.drawsOnChange(from: "known", to: "learning") == false)
        #expect(StatusGlyph.drawsOnChange(from: "unknown", to: "known"))
        #expect(StatusGlyph.drawsOnChange(from: "unknown", to: "learning") == false)
        #expect(StatusGlyph.drawsOnChange(from: "known", to: "known") == false)
    }

    /// A control the library draws, the file it lives in, and the tokens its drawing must use.
    struct TokenCheck: Sendable, CustomStringConvertible {
        let file: String
        let tokens: [String]
        /// Reads only the code iPhone and iPad compile.
        var iOSOnly = true
        var description: String { file }
    }

    static let tokenChecks: [TokenCheck] = [
        TokenCheck(
            file: "ZoomControl.swift",
            tokens: [
                ".keyboardShortcut(\"-\", modifiers: .command)", ".keyboardShortcut(\"0\", modifiers: .command)",
                ".keyboardShortcut(\"=\", modifiers: .command)",
            ],
            iOSOnly: false),
        TokenCheck(
            file: "LibraryButtonStyle.swift",
            tokens: ["ControlMetrics.minWidth", ".pressDim(", ".libraryHover(", ".disabledCapsuleRing("]),
        TokenCheck(
            file: "IconButtonStyle.swift",
            tokens: [
                ".pressDim(", "Motion.springCurve", ".keyframeAnimator(", ".libraryHover(", ".disabledCapsuleRing(",
                ".isSelected",
                // The circle stays 44 at every text size, so the glyph stops growing before it fills it.
                ".dynamicTypeSize(...DynamicTypeSize.xxxLarge)",
            ]),
        TokenCheck(
            file: "Transport.swift",
            tokens: [".pressScale(", ".symbolEffect(", "disabledCapsuleRing"]),
        TokenCheck(
            file: "Chip.swift",
            tokens: [
                ".pressDim(", "Motion.state", "phoneAnimation(", ".libraryHover(",
                ".disabledCapsuleRing(", ".isSelected",
            ]),
    ]

    /// A control's code: the iPhone and iPad code alone, or both platforms', without comments.
    static func controlCode(_ file: String, iOSOnly: Bool = true) throws -> String {
        let text = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: "Phone/Controls/\(file)")))
        return iOSOnly ? SourceScan.iOSCompiled(text) : text
    }

    @Test(arguments: tokenChecks)
    func controlsDrawFromTokens(_ check: TokenCheck) throws {
        let source = try Self.controlCode(check.file, iOSOnly: check.iOSOnly)
        for token in check.tokens { #expect(source.contains(token), "\(check.file) missing \(token)") }
    }

    @Test func libraryButtonsSizeFromTokensOnly() throws {
        let source = try Self.controlCode("LibraryButtonStyle.swift")
        let throughSpacing = source.replacing(/spacing\(\d+(\.\d+)?\)/, with: "spacing(n)")
        for name in [".frame(", ".padding("] {
            for range in throughSpacing.ranges(of: name) {
                let call = SourceScan.call(in: throughSpacing, opening: throughSpacing.index(before: range.upperBound))
                #expect(call.firstMatch(of: /\d/) == nil, "numeric literal in \(call)")
            }
        }
    }

    /// Each library control draws one Mac look, so a screen sets a size at most, never a look.
    @Test func noScreenPicksAMacLook() throws {
        let screens = SourceScan.files().filter { $0.path.contains("/CrosstuneUI/") }
        #expect(screens.isEmpty == false)
        for file in screens {
            let source = SourceScan.withoutComments(try SourceScan.text(at: file))
            #expect(source.contains("macLook:") == false, "\(SourceScan.relative(file)) picks a Mac look")
            #expect(source.contains("macRole:") == false, "\(SourceScan.relative(file)) picks a Mac role")
            #expect(source.contains("macFocus:") == false, "\(SourceScan.relative(file)) picks a Mac focus look")
        }
        let screenLooks = [
            "Tune/AttributeEditorBodies.swift": "toggleStyle(.checkbox)",
            "Links/FindRecordingsSheet.swift": "MacChipStyle(",
            "TuneForm/KeyChooser.swift": "macChevronColor:",
        ]
        for (path, look) in screenLooks {
            let source = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: path)))
            #expect(source.contains(look) == false, "\(path) picks a Mac look: \(look)")
        }
        let controls = SourceScan.files().filter { SourceScan.relative($0).hasPrefix("Phone/Controls/") }
        #expect(controls.isEmpty == false)
        for file in controls + [SourceScan.url(of: "Style/PaletteStyles.swift")] {
            let source = SourceScan.withoutComments(try SourceScan.text(at: file))
            #expect(
                source.firstMatch(of: /enum +(\w*MacLook|Mac(Role|Focus))\b/) == nil, "\(SourceScan.relative(file))")
            #expect(source.contains("macLook") == false, "\(SourceScan.relative(file)) takes a Mac look")
        }
    }

    /// Working then done is one rule on every platform: the Mac shares the one async button,
    /// with no branch of its own, and it shows its work through the shared label.
    @Test func macAsyncButtonShowsItsWork() throws {
        let source = try Self.controlCode("AsyncButton.swift", iOSOnly: false)
        let start = try #require(source.range(of: "package struct AsyncButton<"))
        let end = try #require(source.range(of: "\n}\n", range: start.upperBound..<source.endIndex))
        let button = source[start.lowerBound..<end.upperBound]
        #expect(button.contains("#if") == false, "AsyncButton forks by platform")
        #expect(button.contains("WorkingLabel("), "AsyncButton shows no working label")
    }

    @Test func iconButtonsStartNoTask() throws {
        let source = try Self.controlCode("IconButtonStyle.swift")
        #expect(source.contains("Task {") == false)
        #expect(source.contains("Task.yield") == false)
    }

    /// Every control's press dims and scales through these, so they hold the Press and Spring motion.
    @Test func pressHelpersDrawFromTokens() throws {
        let source = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: "Phone/Motion.swift")))
        for token in ["ControlMetrics.pressedOpacity", "Motion.press", "Motion.spring", "accessibilityReduceMotion"] {
            #expect(source.contains(token), "missing \(token)")
        }
        let hover = SourceScan.iOSCompiled(
            SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: "Phone/LibraryFocusRing.swift"))))
        #expect(hover.contains(".hoverEffect(.highlight"))
    }

    /// The stepper's value keeps the widest value's width, so a crowded row never truncates it.
    @Test func stepperValueHoldsItsWidestWidth() throws {
        let url = SourceScan.url(of: "Phone/Controls/ValueStepper.swift")
        let source = SourceScan.iOSCompiled(SourceScan.withoutComments(try SourceScan.text(at: url)))
        let start = try #require(source.range(of: "private var valueText: some View {"))
        let end = try #require(source.range(of: "private func arrow(", range: start.upperBound..<source.endIndex))
        #expect(source[start.lowerBound..<end.lowerBound].contains(".fixedSize(horizontal: true, vertical: false)"))
    }

    @Test func noConfirmItemSetsItsOwnWeight() throws {
        let files = SourceScan.files().filter { $0.path.contains("/CrosstuneUI/") }
        #expect(files.isEmpty == false)
        for file in files {
            let lines = try SourceScan.text(at: file).components(separatedBy: "\n")
            for (index, line) in lines.enumerated() where line.contains("ConfirmToolbarItem {") {
                let following = lines.dropFirst(index + 1).prefix(8)
                #expect(
                    following.contains { $0.contains(".fontWeight(.semibold)") } == false,
                    "\(file.lastPathComponent):\(index + 1) sets its own weight")
            }
        }
    }

    /// `Palette.neutralFill` is the solid fill behind a swipe action. A control at rest fills
    /// with the `.neutralFill` style, which follows its container.
    @Test func controlsFillWithTheContainerNeutralFill() throws {
        let folder = SourceScan.url(of: "Phone/Controls")
        let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        for file in files where file.pathExtension == "swift" {
            let source = SourceScan.withoutComments(try SourceScan.text(at: file))
            #expect(
                source.contains("Palette.neutralFill") == false, "\(file.lastPathComponent) fills with the swipe fill")
        }
    }

    /// A control that stops growing with the text size shows the Large Content Viewer instead,
    /// so its parts can still be read at the accessibility sizes.
    @Test func cappedControlsShowTheLargeContentViewer() throws {
        let folder = SourceScan.url(of: "Phone/Controls")
        let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        for file in files where file.pathExtension == "swift" {
            let source = SourceScan.iOSCompiled(SourceScan.withoutComments(try SourceScan.text(at: file)))
            guard source.contains(".dynamicTypeSize(...") else { continue }
            #expect(
                source.contains(".accessibilityShowsLargeContentViewer"),
                "\(file.lastPathComponent) caps its text size without the Large Content Viewer")
        }
    }

    @Test func chipIsTheOnlyCapsuleFillInDesign() throws {
        let allowed = ["Components/GlassCapsule.swift", "Components/UndoBanner.swift"]
        let files = SourceScan.files().filter {
            $0.path.contains("/CrosstuneDesign/") && !SourceScan.relative($0).hasPrefix("Phone/Controls/")
                && !SourceScan.relative($0).hasPrefix("Mac/") && !allowed.contains(SourceScan.relative($0))
        }
        #expect(files.isEmpty == false)
        for file in files {
            let source = SourceScan.iOSCompiled(SourceScan.withoutComments(try SourceScan.text(at: file)))
            for range in source.ranges(of: ".background") {
                let call = backgroundBody(in: source, after: range.upperBound)
                #expect(
                    (call.contains("in: .capsule") || call.contains("in: Capsule") || call.contains("Capsule()"))
                        == false,
                    "\(SourceScan.relative(file)) fills a capsule outside Chip")
            }
        }
    }

    /// What follows `.background`: a parenthesized call with any trailing closures, or a bare
    /// trailing closure through its closing brace.
    private func backgroundBody(in source: String, after end: String.Index) -> Substring {
        guard end < source.endIndex else { return "" }
        if source[end] == "(" { return SourceScan.call(in: source, opening: end) }
        let rest = source[end...].drop { $0 == " " }
        guard rest.first == "{" else { return "" }
        return SourceScan.call(in: source, opening: rest.startIndex)
    }
}
