import Foundation
import Testing

/// A screen draws its controls from the shared library, never its own. A screen that builds a
/// control itself fails, unless `allowed` names that file and that rule.
@Suite struct ControlLibraryTests {
    /// Files that keep drawing their own control for good: the rules each breaks, and the control
    /// that does.
    static let allowed: [String: (rules: Set<String>, reason: String)] = [
        "Welcome/WelcomeView.swift": (
            [
                "style conformance", "own press state", "system button style", "capsule or circle in button label",
            ],
            "sign-up buttons and carousel page dots"
        ),
        "Recording/RecordSheet.swift": (["system button style"], "the stop button"),
        "Tuner/TunerScreen.swift": (["own animation"], "the tuner display's bars and background"),
        "RecordingScreen/Practice/LoopNameTab.swift": (
            ["system button style"],
            "the loop name field and the selected tab's plain button: the handle's own shape and color, "
                + "which no library control fits"
        ),
    ]

    struct Violation: Hashable {
        let rule: String
        let line: String
    }

    private static let curves =
        "easeInOut|easeIn|easeOut|linear|spring|snappy|smooth|bouncy|interpolatingSpring|default|timingCurve"
    private static let styleProtocols =
        "ButtonStyle|PrimitiveButtonStyle|ToggleStyle|LabelStyle|PickerStyle|TextFieldStyle"

    /// Rules matched by pattern over a whole file, so a call split across lines still matches.
    nonisolated(unsafe) private static let patterns: [(rule: String, regex: Regex<AnyRegexOutput>)] = [
        (
            "style conformance",
            #"(?:struct|class|enum|extension)\s+[\w.]+(?:<[^>{}]*>)?\s*:(?:(?!\bwhere\b)[^{}])*?\b(?:\#(styleProtocols))\b"#
        ),
        (
            "system button style",
            #"\.buttonStyle\(\s*\.(?:bordered|borderedProminent|glassProminent|glass|borderless|plain)\b"#
        ),
        (
            "system button style",
            #"\b(?:PlainButtonStyle|BorderlessButtonStyle|BorderedButtonStyle|BorderedProminentButtonStyle)\(\)"#
        ),
        ("button toggle style", #"\.toggleStyle\(\s*\.button\b"#),
        ("rounded border text field", #"\.textFieldStyle\(\s*\.roundedBorder\b"#),
        ("own press state", #"configuration\.isPressed"#),
        ("own hover state", #"\.(?:hoverEffect|onHover)\b"#),
        ("own animation", #"withAnimation\(\s*\."#),
        ("own animation", #"\.animation\(\s*\.(?:\#(curves))\b"#),
        ("own animation", #"\.spring\((?:duration|response)"#),
        ("own animation", #"\bAnimation\.(?:\#(curves))\b"#),
        ("capsule background", #"in:\s*(?:\.capsule\b|Capsule\(\))"#),
        ("system stepper or slider", #"\b(?:Stepper|Slider)\("#),
    ].map { ($0.0, try! Regex($0.1)) }

    nonisolated(unsafe) private static let buttonStart = /\bButton\b\s*([({])/
    nonisolated(unsafe) private static let hitShape = /\.contentShape\((?:[^()]|\([^()]*\))*\)/
    nonisolated(unsafe) private static let labelFill = /Capsule\(\)|\.capsule\b|Circle\(\)|\.circle\b/

    /// The file's code as the iOS build sees it, without previews, comments, or string literals.
    static func code(of file: URL) throws -> String {
        SourceScan.withoutStrings(SourceScan.iOSCompiled(try uncommented(file)))
    }

    /// The file's code without previews or comments, both platforms' branches kept.
    private static func uncommented(_ file: URL) throws -> String {
        SourceScan.withoutComments(SourceScan.withoutPreviews(try SourceScan.text(at: file)))
    }

    /// Whether `file` is a screen file: under `CrosstuneUI`, outside the Mac's own views.
    static func isScreen(_ file: URL) -> Bool {
        file.path.contains("/CrosstuneUI/") && !SourceScan.relative(file).hasPrefix("Mac/")
    }

    /// The text of the line a match starts on.
    private static func line(of range: Range<String.Index>, in code: String) -> String {
        let start = code[..<range.lowerBound].lastIndex(of: "\n").map { code.index(after: $0) } ?? code.startIndex
        let end = code[range.lowerBound...].firstIndex(of: "\n") ?? code.endIndex
        return code[start..<end].trimmingCharacters(in: .whitespaces)
    }

    static func violations(in code: String) -> Set<Violation> {
        var found = Set<Violation>()
        for (rule, regex) in patterns {
            for match in code.matches(of: regex) {
                found.insert(Violation(rule: rule, line: line(of: match.range, in: code)))
            }
        }
        // A capsule or circle drawn inside a button's label is a hand-built button. A hit shape is
        // not a fill.
        for match in code.matches(of: buttonStart) {
            let label = SourceScan.call(in: code, opening: match.output.1.startIndex)
            if label.replacing(hitShape, with: "").contains(labelFill) {
                found.insert(
                    Violation(rule: "capsule or circle in button label", line: line(of: match.range, in: code)))
            }
        }
        return found
    }

    /// Every screen file under `CrosstuneUI` the iOS build compiles, with what it violates.
    static func screenViolations() throws -> [String: Set<Violation>] {
        var result: [String: Set<Violation>] = [:]
        var screens: [ButtonStyleScan.File] = []
        var library: [ButtonStyleScan.File] = []
        for file in SourceScan.files() {
            let path = SourceScan.relative(file)
            let source = ButtonStyleScan.File(path: path, code: try code(of: file))
            library.append(source)
            guard Self.isScreen(file) else { continue }
            screens.append(source)
            let found = violations(in: source.code)
            if !found.isEmpty { result[path] = found }
        }
        let scan = ButtonStyleScan(screens: screens, library: library)
        for (path, lines) in scan.unstyledButtons() {
            for line in lines { result[path, default: []].insert(Violation(rule: "unstyled button", line: line)) }
        }
        return result
    }

    @Test func screensDrawNoControlOfTheirOwn() throws {
        let all = try Self.screenViolations()
        var offenders: [String: Set<Violation>] = [:]
        for (path, found) in all {
            let kept = found.filter { Self.allowed[path]?.rules.contains($0.rule) != true }
            if !kept.isEmpty { offenders[path] = kept }
        }
        let report = offenders.keys.sorted().flatMap { path in
            offenders[path]!.sorted { ($0.rule, $0.line) < ($1.rule, $1.line) }
                .map { "\(path): \($0.rule): \($0.line)" }
        }
        #expect(
            offenders.isEmpty,
            """
            Screens that build their own control. Use a library style or control for the control's \
            look, and add a missing kind to the library. `.labelOnly` is only for a label that is \
            content, such as a row or a tile; `.rowLine` is a borderless line in a row.
            \(report.joined(separator: "\n"))
            """)
    }

    /// Screens with `#if os` blocks that draw a library control on iPhone and iPad and the Mac's
    /// own look in its place, with how many blocks and why. A Mac look belongs in its control's
    /// Mac branch, so a new block fails and this list only shrinks.
    static let allowedForks: [String: (blocks: Int, reason: String)] = [
        "Components/MediaRow.swift": (1, "Retry: the Mac's small plain button widens from outside its label"),
        "Import/ImportSheet.swift": (
            2, "the Mac's review step, and its checkbox, whose style lives with the app's Mac views"
        ),
        "Links/FindRecordingsSheet.swift": (1, "the result sections, drawn per platform"),
        "Links/LinkSheet.swift": (1, "the sheet's fields and save, drawn per platform"),
        "Lists/ListNameSheet.swift": (1, "the sheet's field and save, drawn per platform"),
        "Lists/ListPickerSheet.swift": (1, "the sheet's body, drawn per platform"),
        "Lyrics/LyricsReader.swift": (2, "the reader and its editor, drawn per platform"),
        "Plan/MembershipCard.swift": (1, "the card, drawn per platform"),
        "Plan/PeriodTiles.swift": (1, "the Mac's radio group in place of the tiles"),
        "RecordingPage/Location/DropPinView.swift": (1, "the sheet, drawn per platform"),
        "RecordingScreen/IsolatePanel.swift": (1, "owner ruling: the Mac panel keeps its rows"),
        "RecordingScreen/PitchPanel.swift": (1, "owner ruling: the Mac panel keeps its slider"),
        "RecordingScreen/Practice/LoopsPanel.swift": (1, "owner ruling: the Mac panel keeps its actions"),
        "RecordingScreen/SplitCutList.swift": (1, "owner ruling: the Mac keeps its cut list"),
        "Recordings/RenameLocationSheet.swift": (1, "the sheet's field and save, drawn per platform"),
        "Selection/BulkEditSheet.swift": (2, "the sheet's rows, drawn per platform"),
        "Settings/SettingsFieldRow.swift": (1, "the Mac draws its own settings link row"),
        "Settings/SettingsScreen.swift": (1, "the Mac's settings cards in place of the grouped form"),
        "Shell/AccountButton.swift": (1, "the account button exists only on iPhone and iPad"),
        "TuneForm/SuggestionField.swift": (1, "suggestion rows exist only on iPhone and iPad"),
        "TuneForm/SuggestionPicker.swift": (1, "the Mac's own picker"),
        "TuneForm/TuneFormRows.swift": (1, "the date row, drawn per platform"),
        "TuneForm/TuneFormSheet.swift": (1, "the sheet's fields and save, drawn per platform"),
        "Welcome/WelcomeView.swift": (1, "the welcome layout, drawn per platform"),
    ]

    /// How many `#if os` blocks in `code` build a library control on the side iPhone and iPad
    /// compile. A block inside another counts on its own.
    static func libraryForks(in code: String, controls: [(name: String, shorthands: [String])]) -> Int {
        // Each open block: whether it tests the platform, whether iOS compiles its current
        // branch, and the iOS side's code so far.
        var open: [(isPlatform: Bool, onIOS: Bool, iOSCode: String)] = []
        var count = 0
        for line in code.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("#if ") {
                let condition = trimmed.dropFirst(4).trimmingCharacters(in: .whitespaces)
                let macFirst = ["os(macOS)", "!os(iOS)", "canImport(AppKit)"].contains { condition.hasPrefix($0) }
                let iOSFirst = ["!os(macOS)", "os(iOS)", "canImport(UIKit)"].contains { condition.hasPrefix($0) }
                open.append((macFirst || iOSFirst, iOSFirst, ""))
            } else if trimmed.hasPrefix("#else") || trimmed.hasPrefix("#elseif"), var last = open.popLast() {
                if last.isPlatform { last.onIOS.toggle() }
                open.append(last)
            } else if trimmed.hasPrefix("#endif"), let last = open.popLast() {
                let usesControl = controls.contains {
                    ControlGalleryTests.uses($0.name, in: last.iOSCode, shorthands: $0.shorthands)
                }
                if last.isPlatform && usesControl { count += 1 }
            } else {
                for index in open.indices where open[index].isPlatform && open[index].onIOS {
                    open[index].iOSCode += line + "\n"
                }
            }
        }
        return count
    }

    @Test func screenForksStayListed() throws {
        let controls = try ControlGalleryTests.controlNames().map { ($0, try ControlGalleryTests.shorthands(of: $0)) }
        var found: [String: Int] = [:]
        for file in SourceScan.files() where Self.isScreen(file) {
            let path = SourceScan.relative(file)
            let code = SourceScan.withoutStrings(try Self.uncommented(file))
            let blocks = Self.libraryForks(in: code, controls: controls)
            if blocks > 0 { found[path] = blocks }
        }
        let changed = Set(found.keys).union(Self.allowedForks.keys).sorted().compactMap { path in
            let listed = Self.allowedForks[path]?.blocks ?? 0
            let actual = found[path] ?? 0
            return listed == actual ? nil : "\(path): \(actual) blocks, \(listed) listed"
        }
        #expect(
            changed.isEmpty,
            """
            A screen's `#if os` block draws a library control beside a Mac look of its own. Move the \
            Mac look into the control's Mac branch, or update `allowedForks` when one goes.
            \(changed.joined(separator: "\n"))
            """)
    }

    @Test func aCircleFillInALabelIsABuiltButton() {
        let circled = "Button {} label: { Text(\"\").background(.red, in: .circle) }"
        let hitShapeOnly = "Button {} label: { Text(\"\").contentShape(.circle) }"
        #expect(Self.violations(in: circled).map(\.rule) == ["capsule or circle in button label"])
        #expect(Self.violations(in: hitShapeOnly).isEmpty)
    }

    /// The lines of the unstyled buttons in `screens`, each a file of code keyed by its name.
    private static func unstyled(_ screens: [String: String]) -> [String] {
        let files = screens.map { ButtonStyleScan.File(path: $0.key, code: $0.value) }
        return ButtonStyleScan(screens: files, library: files).unstyledButtons().values.flatMap { $0 }.sorted()
    }

    @Test func anUnstyledButtonIsFlaggedHoweverDeepItSits() {
        for nested in [
            "VStack { Button(x) {} }", "if shows { Button(x) {} }", "ForEach(items) { _ in Button(x) {} }",
            "switch mode {\ncase .a:\nButton(x) {}\ndefault: EmptyView()\n}", "Group { Button(x) {} }",
            "Section { Button(x) {} }",
        ] {
            let code = "struct A: View {\nvar body: some View {\n\(nested)\n}\n}"
            #expect(Self.unstyled(["A": code]).count == 1, "\(nested)")
        }
    }

    @Test func aButtonInAHelperIsJudgedWhereTheHelperIsPlaced() {
        let bare = """
            struct A: View {
            var body: some View { HStack { bar } }
            @ViewBuilder private var bar: some View {
            switch mode {
            case .a: Button(x) {}
            }
            }
            }
            """
        let styledAtUse = bare.replacingOccurrences(of: "HStack { bar }", with: "HStack { bar }.buttonStyle(.text)")
        let inToolbar = bare.replacingOccurrences(
            of: "HStack { bar }", with: "Text(x).toolbar { ToolbarItem { bar } }")
        let function = """
            struct A: View {
            var body: some View { VStack { row(1) } }
            private func row(_ n: Int) -> some View { Button(x) {} }
            }
            """
        #expect(Self.unstyled(["A": bare]) == ["case .a: Button(x) {}"])
        #expect(Self.unstyled(["A": styledAtUse]).isEmpty)
        #expect(Self.unstyled(["A": inToolbar]).isEmpty)
        #expect(Self.unstyled(["A": function]) == ["private func row(_ n: Int) -> some View { Button(x) {} }"])
    }

    @Test func aViewOfButtonsIsJudgedWhereItIsBuilt() {
        let row = "struct Row: View {\nvar body: some View { Button(x) {} }\n}"
        let inSwipe = "struct A: View {\nvar body: some View { Text(x).swipeActions { Row() } }\n}"
        let inStack = "struct A: View {\nvar body: some View { VStack { Row() } }\n}"
        #expect(Self.unstyled(["Row": row, "A": inSwipe]).isEmpty)
        #expect(Self.unstyled(["Row": row, "A": inStack]) == ["var body: some View { Button(x) {} }"])
    }

    @Test func systemPlacesAndHiddenButtonsPass() {
        for code in [
            "Menu { Button(x) {} } label: { Text(x) }", "Text(x).contextMenu { Button(x) {} }",
            "Text(x).confirmationDialog(x, isPresented: $shows) { Button(x) {} }",
            "Text(x).background { Button(x) {}.keyboardShortcut(.cancelAction).hidden() }",
            "VStack { Button(x) {} }.buttonStyle(.text)", "Text(x).rowActions { Button(x) {} }",
        ] {
            let view = "struct A: View {\nvar body: some View {\n\(code)\n}\n}"
            let placer =
                "extension View {\nfunc rowActions(_ c: () -> some View) -> some View { swipeActions { c() } }\n}"
            #expect(Self.unstyled(["A": view, "B": placer]).isEmpty, "\(code)")
        }
    }

    @Test func aButtonInAViewModifierBodyIsFlagged() {
        let modifier = """
            struct Overlaid: ViewModifier {
            func body(content: Content) -> some View { content.overlay { Button(x) {} } }
            }
            """
        let other =
            "struct Rows: ViewModifier {\nfunc body(content: Content) -> some View { content.swipeActions {} }\n}"
        let view = "struct A: View {\nvar body: some View { Text(x).modifier(Overlaid()) }\n}"
        #expect(Self.unstyled(["M": modifier, "R": other, "A": view]).count == 1)
    }

    @Test func onlyAPageSectionsAccessoryIsStyled() {
        let content =
            "struct A: View {\nvar body: some View { PageSection(x) { Text(x) } content: { Button(x) {} } }\n}"
        let accessory =
            "struct A: View {\nvar body: some View { PageSection(x) { Button(x) {} } content: { Text(x) } }\n}"
        let only = "struct A: View {\nvar body: some View { PageSection(x) { Button(x) {} } }\n}"
        #expect(Self.unstyled(["A": content]).count == 1)
        #expect(Self.unstyled(["A": accessory]).isEmpty)
        #expect(Self.unstyled(["A": only]).count == 1)
    }

    @Test func aNameThatCollidesWithAPlacerIsFlagged() {
        let placer = "extension View {\nfunc rowActions(_ c: () -> some View) -> some View { swipeActions { c() } }\n}"
        let collider = "extension Text {\nfunc rowActions(_ c: () -> some View) -> some View { VStack { c() } }\n}"
        let view = "struct A: View {\nvar body: some View { Text(x).rowActions { Button(x) {} } }\n}"
        #expect(Self.unstyled(["P": placer, "A": view]).isEmpty)
        #expect(Self.unstyled(["P": placer, "C": collider, "A": view]).count == 1)
    }

    @Test func aTypedCurveIsFlaggedHoweverItIsWritten() {
        for code in [
            "withAnimation(Animation.easeOut(duration: 1)) {}", ".animation(Animation.linear, value: x)",
            ".animation(.spring(response: 0.3), value: x)",
        ] {
            #expect(Self.violations(in: code).map(\.rule).contains("own animation"), "\(code)")
        }
    }

    @Test func countsALibraryForkOnTheIOSSide() {
        let controls = [(name: "Chip", shorthands: [String]()), (name: "LibraryButtonStyle", shorthands: ["text"])]
        let fork = "#if os(macOS)\nText(\"\")\n#else\nChip(.token) {}\n#endif"
        let macOnly = "#if os(macOS)\nChip(.token) {}\n#endif"
        let iOSOnly = "#if !os(macOS)\nButton {}.buttonStyle(.text)\n#endif"
        #expect(Self.libraryForks(in: fork, controls: controls) == 1)
        #expect(Self.libraryForks(in: macOnly, controls: controls) == 0)
        #expect(Self.libraryForks(in: iOSOnly, controls: controls) == 1)
        #expect(Self.libraryForks(in: "#if DEBUG\nChip(.token) {}\n#endif", controls: controls) == 0)
    }

    @Test func allowedHoldsOnlyRealViolations() throws {
        let all = try Self.screenViolations()
        let stale = Self.allowed.flatMap { path, entry in
            let broken = Set((all[path] ?? []).map(\.rule))
            return entry.rules.subtracting(broken).map { "\(path): \($0)" }
        }
        .sorted()
        #expect(stale.isEmpty, "Remove from allowed, no longer violating: \(stale.joined(separator: ", "))")
    }

    /// A menu takes its look only from a plain button style or a system one, and ignores the
    /// library's primitive styles, so a menu given one draws the system's look. The library's
    /// `…MenuAppearance()` modifiers give a menu its look. Flags a primitive style in a `Menu`'s
    /// chain, or after a `.menuStyle` in any chain.
    static func menusGivenIgnoredStyles(in files: [ButtonStyleScan.File]) -> [String] {
        var primitive = Set<String>()
        for file in files {
            for match in nsMatches(#"\bstruct\s+(\w+)\s*:\s*PrimitiveButtonStyle\b"#, in: file.code) {
                primitive.insert(file.text(match.range(at: 1)))
            }
            let extensionHead = #"\bextension\s+PrimitiveButtonStyle\s+where\s+Self\s*==\s*\w+\s*\{"#
            for match in nsMatches(extensionHead, in: file.code) {
                let open = match.range.upperBound - 1
                let body = file.text(open..<ButtonStyleScan.closing(open, in: file))
                for member in nsMatches(#"\bstatic\s+(?:var|func)\s+(\w+)"#, in: body) {
                    primitive.insert((body as NSString).substring(with: member.range(at: 1)))
                }
            }
        }
        var found: [String] = []
        for file in files {
            var chains: [(start: Int, chain: String)] = []
            for match in nsMatches(#"(?<![\w.])Menu\s*[({]"#, in: file.code) {
                let end = ButtonStyleScan.endOfCall(match.range.upperBound - 1, in: file)
                chains.append((match.range.location, ButtonStyleScan.chain(after: end, in: file)))
            }
            for match in nsMatches(#"\.menuStyle\("#, in: file.code) {
                let end = ButtonStyleScan.closing(match.range.upperBound - 1, in: file)
                chains.append((match.range.location, ButtonStyleScan.chain(after: end, in: file)))
            }
            for (start, chain) in chains {
                let styles = nsMatches(#"\.buttonStyle\(\s*\.?(\w+)"#, in: chain).map {
                    (chain as NSString).substring(with: $0.range(at: 1))
                }
                if styles.contains(where: primitive.contains) {
                    let line = file.text(0..<start).count { $0 == "\n" } + 1
                    found.append("\(file.path):\(line)")
                }
            }
        }
        return Array(Set(found)).sorted()
    }

    private static func nsMatches(_ pattern: String, in text: String) -> [NSTextCheckingResult] {
        try! NSRegularExpression(pattern: pattern).matches(
            in: text, range: NSRange(location: 0, length: text.utf16.count))
    }

    @Test func noMenuIsGivenAStyleItIgnores() throws {
        let files = try SourceScan.files().map {
            ButtonStyleScan.File(
                path: SourceScan.relative($0), code: SourceScan.withoutStrings(try Self.uncommented($0)))
        }
        let found = Self.menusGivenIgnoredStyles(in: files)
        #expect(
            found.isEmpty,
            """
            A menu ignores the library's primitive button styles. Use `textButtonMenuAppearance()`, \
            `iconButtonMenuAppearance(_:)`, or `rowLineMenuAppearance()`, or add one for the style.
            \(found.joined(separator: "\n"))
            """)
    }

    @Test func aMenuGivenAPrimitiveStyleIsFlagged() {
        let library = ButtonStyleScan.File(
            path: "Style",
            code: """
                struct Words: PrimitiveButtonStyle {}
                extension PrimitiveButtonStyle where Self == Words {
                static var words: Self { Words() }
                }
                """)
        func flagged(_ code: String) -> Bool {
            !Self.menusGivenIgnoredStyles(in: [library, ButtonStyleScan.File(path: "A", code: code)]).isEmpty
        }
        #expect(flagged("Menu { items } label: { x }\n.buttonStyle(.words)"))
        #expect(flagged("Menu { items } label: { x }.buttonStyle(Words())"))
        #expect(flagged("accessory\n.menuStyle(.button)\n.buttonStyle(.words)"))
        #expect(!flagged("Menu { items } label: { x }\n.buttonStyle(.borderless)"))
        #expect(!flagged("Button(x) {}\n.buttonStyle(.words)"))
        #expect(!flagged("accessory\n.menuStyle(.button)\n.textButtonMenuAppearance()"))
    }
}
