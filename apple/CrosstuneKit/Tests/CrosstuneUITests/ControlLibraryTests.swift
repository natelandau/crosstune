import Foundation
import Testing

/// A screen draws its controls from the shared library, never its own. A screen that builds a
/// control itself fails, unless `allowed` names that file and that rule.
struct ControlLibraryTests {
    /// The passes an exception holds in, so one platform's exception never widens the other's.
    enum Pass: CaseIterable {
        case iOS, mac

        static let both = Set(allCases)
    }

    /// Files that keep drawing their own control for good: the passes and rules each breaks, and
    /// the control that does.
    static let allowed: [String: (passes: Set<Pass>, rules: Set<String>, reason: String)] = [
        "Welcome/WelcomeView.swift": (
            Pass.both,
            [
                "style conformance", "own press state", "system button style", "capsule or circle in button label",
            ],
            "sign-up buttons and carousel page dots"
        ),
        "Recording/RecordSheet.swift": (Pass.both, ["system button style"], "the stop button"),
        "Tuner/TunerScreen.swift": (Pass.both, ["own animation"], "the tuner display's bars and background"),
        "RecordingScreen/Practice/LoopNameTab.swift": (
            [.iOS], ["system button style"],
            "the selected tab's plain button: the handle's own shape and color, which no library control fits"
        ),
    ]

    /// Whether `allowed` excuses `violation` in `path` on `pass`.
    static func isAllowed(_ violation: Violation, in path: String, on pass: Pass) -> Bool {
        guard let entry = allowed[path], entry.passes.contains(pass) else { return false }
        return entry.rules.contains(violation.rule)
    }

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
        ("own hover state", #"(?:^|\W)(?:hoverEffect|onHover)\b"#),
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
            let kept = found.filter { !Self.isAllowed($0, in: path, on: .iOS) }
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
        "Import/ImportSheet.swift": (
            2, "the Mac's review step, and its checkbox, whose style lives with the app's Mac views"
        ),
        "Links/FindRecordingsSheet.swift": (1, "the result sections, drawn per platform"),
        "Links/LinkSheet.swift": (1, "the sheet's fields and save, drawn per platform"),
        "Lists/ListNameSheet.swift": (1, "the sheet's field and save, drawn per platform"),
        "Lists/ListPickerSheet.swift": (1, "the sheet's body, drawn per platform"),
        "Lyrics/LyricsReader.swift": (2, "the reader and its editor, drawn per platform"),
        "Plan/MembershipCard.swift": (1, "the card, drawn per platform"),
        "Plan/PeriodTiles.swift": (1, "the Mac's segmented control and price line in place of the tiles"),
        "RecordingPage/Location/DropPinView.swift": (1, "the sheet, drawn per platform"),
        "Recordings/RenameLocationSheet.swift": (1, "the sheet's field and save, drawn per platform"),
        "Selection/BulkEditSheet.swift": (1, "the sheet's rows, drawn per platform"),
        "Settings/SettingsScreen.swift": (1, "the Mac's settings cards in place of the grouped form"),
        "Shell/AccountButton.swift": (1, "the account button exists only on iPhone and iPad"),
        "TuneForm/SuggestionField.swift": (1, "suggestion rows exist only on iPhone and iPad"),
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

    @Test func onlyAPaneBarsControlsAreStyled() {
        let only = "struct A: View {\nvar body: some View { Text(x).paneBar { Button(x) {} } }\n}"
        let controls =
            "struct A: View {\nvar body: some View { Text(x).paneBar(slot: 1) {\nText(x)\n} _: {\nButton(x) {}\n} }\n}"
        let leading =
            "struct A: View {\nvar body: some View { Text(x).paneBar(slot: 1) {\nButton(x) {}\n} _: {\nText(x)\n} }\n}"
        #expect(Self.unstyled(["A": only]).isEmpty)
        #expect(Self.unstyled(["A": controls]).isEmpty)
        #expect(Self.unstyled(["A": leading]).count == 1)
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
        let found: [Pass: [String: Set<Violation>]] = [
            .iOS: try Self.screenViolations(), .mac: try Self.macScreenViolations(),
        ]
        let stale = Self.allowed.flatMap { path, entry in
            entry.passes.flatMap { pass in
                let broken = Set((found[pass]?[path] ?? []).map(\.rule))
                return entry.rules.subtracting(broken).map { "\(path) (\(pass)): \($0)" }
            }
        }
        .sorted()
        #expect(stale.isEmpty, "Remove from allowed, no longer violating: \(stale.joined(separator: ", "))")
    }

    /// A menu takes its look only from a plain button style or a system one, and ignores the
    /// library's primitive styles, so a menu given one draws the system's look. The library's
    /// `…MenuAppearance()` modifiers give a menu its look. Flags a primitive style in a `Menu`'s
    /// chain, or after a `.menuStyle` in any chain.
    static func menusGivenIgnoredStyles(
        in files: [ButtonStyleScan.File], sourceLocation: SourceLocation = #_sourceLocation
    ) -> [String] {
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
        var modifierBodies: [String: String] = [:]
        for file in files {
            for match in nsMatches(#"\bstruct\s+(\w+)\s*:\s*ViewModifier\b[^{]*\{"#, in: file.code) {
                let open = match.range.upperBound - 1
                let close = ButtonStyleScan.closing(open, in: file)
                modifierBodies[file.text(match.range(at: 1))] = file.text(open..<close)
            }
        }
        // A `.modifier(Name())` applies whatever styles the modifier's own body does.
        func expanded(_ chain: String) -> String {
            let names = nsMatches(#"\.modifier\(\s*(\w+)"#, in: chain).map {
                (chain as NSString).substring(with: $0.range(at: 1))
            }
            return ([chain] + names.compactMap { modifierBodies[$0] }).joined(separator: "\n")
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
                let styles = nsMatches(#"\.buttonStyle\(\s*\.?(\w+)"#, in: expanded(chain)).map {
                    (expanded(chain) as NSString).substring(with: $0.range(at: 1))
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
        let modifier = """
            struct Look: ViewModifier {
            func body(content: Content) -> some View { content.buttonStyle(.words) }
            }

            """
        #expect(flagged(modifier + "accessory\n.menuStyle(.button)\n.modifier(Look())"))
        #expect(flagged(modifier + "Menu { items } label: { x }\n.modifier(Look())"))
        #expect(flagged(modifier + "Button(x) {}\n.modifier(Look())") == false)
        #expect(flagged("Menu { items } label: { x }\n.buttonStyle(.borderless)") == false)
        #expect(flagged("Button(x) {}\n.buttonStyle(.words)") == false)
        #expect(flagged("accessory\n.menuStyle(.button)\n.textButtonMenuAppearance()") == false)
    }

    // MARK: - The Mac pass

    /// Rules only the Mac build can break, matched like ``patterns``.
    nonisolated(unsafe) private static let macPatterns: [(rule: String, regex: Regex<AnyRegexOutput>)] = [
        ("checkbox toggle style", #"\.toggleStyle\(\s*\.checkbox\b|\bCheckboxToggleStyle\(\)"#),
        ("radio group picker style", #"\.pickerStyle\(\s*\.radioGroup\b|\bRadioGroupPickerStyle\(\)"#),
        ("segmented picker style", #"\.pickerStyle\(\s*\.segmented\b|\bSegmentedPickerStyle\(\)"#),
        // A system picker draws AppKit's pop-up; the library's draws the Mac one.
        ("system picker", #"(?:^|[^\w.])Picker\s*[({]"#),
        ("system button style", #"\.buttonStyle\(\s*\.link\b|\bLinkButtonStyle\(\)"#),
        ("own focus handling", #"(?:^|\W)(?:focusable|defaultFocus|focusEffectDisabled)\("#),
        // A curve picked by a condition, such as Reduce Motion's nil or the curve, or stored.
        ("own animation", #"\s\?\s*(?:nil\s*:\s*)?\.(?:\#(curves))\b"#),
        ("own animation", #"(?::|=)\s*\.(?:\#(curves))\("#),
        // A color that is the accent only while focused: a ring, an outline, or an underline.
        ("own focus ring", #"[Ff]ocus\w*[^?\n]*\?\s*(?:Palette\.color\(\s*)?(?:Palette)?\.accent(?!\w)"#),
    ].map { ($0.0, try! Regex($0.1)) }

    nonisolated(unsafe) private static let focusCondition = /\bif\b[^{\n]*[Ff]ocus[^{\n]*\{/
    nonisolated(unsafe) private static let accentStroke =
        /\.(?:stroke|strokeBorder|fill|border|overlay|background)\([^)]*?\.accent(?!\w)/
    nonisolated(unsafe) private static let focused = /(?:^|\W)focused\(/
    /// The views a `.focused` binding may sit on: the system's text fields and the library's.
    nonisolated(unsafe) private static let textField =
        /^(?:TextField|SecureField|TextEditor|MacTextArea|MultilineTextField)$/

    /// The file's code as the Mac build sees it, without previews, comments, or string literals.
    static func macCode(of file: URL) throws -> String {
        SourceScan.withoutStrings(SourceScan.macCompiled(try uncommented(file)))
    }

    static func macViolations(in code: String, sourceLocation: SourceLocation = #_sourceLocation) -> Set<Violation> {
        var found = violations(in: code)
        for (rule, regex) in macPatterns {
            for match in code.matches(of: regex) {
                found.insert(Violation(rule: rule, line: line(of: match.range, in: code)))
            }
        }
        // A `Link` draws the system's link unless a style in its chain gives it a button's look.
        let file = ButtonStyleScan.File(path: "", code: code)
        for match in nsMatches(#"(?:^|[^\w.])Link\s*[({]"#, in: file.code) {
            let end = ButtonStyleScan.endOfCall(match.range.upperBound - 1, in: file)
            let chain = ButtonStyleScan.chain(after: end, in: file)
            if !chain.contains(".buttonStyle(") {
                let range = Range(match.range, in: file.code)!
                found.insert(Violation(rule: "system link", line: line(of: range, in: file.code)))
            }
        }
        // The accent drawn only while something is focused is a ring of its own.
        for match in code.matches(of: focusCondition) {
            let body = SourceScan.call(in: code, opening: code.index(before: match.range.upperBound))
            if body.contains(accentStroke) {
                found.insert(Violation(rule: "own focus ring", line: line(of: match.range, in: code)))
            }
        }
        // A focus state bound to a control other than a text field, read or set.
        for match in code.matches(of: focused)
        where !chainRoot(before: match.range.lowerBound, in: code)
            .contains(textField)
        {
            found.insert(Violation(rule: "focus on a control", line: line(of: match.range, in: code)))
        }
        return found
    }

    /// The name that starts the modifier chain ending at `index`, walking back over modifiers,
    /// their arguments, and closures.
    static func chainRoot(before index: String.Index, in code: String) -> String {
        var cursor = index
        func skipSpace() {
            while cursor > code.startIndex, code[code.index(before: cursor)].isWhitespace {
                cursor = code.index(before: cursor)
            }
        }
        while true {
            skipSpace()
            guard cursor > code.startIndex else { return "" }
            let previous = code[code.index(before: cursor)]
            // A trailing closure's label, such as `action:`, belongs to the call before it.
            if previous == ":" {
                cursor = code.index(before: cursor)
                skipSpace()
                while cursor > code.startIndex, code[code.index(before: cursor)].isLetter {
                    cursor = code.index(before: cursor)
                }
                continue
            }
            if previous == ")" || previous == "}" {
                let open: Character = previous == ")" ? "(" : "{"
                var depth = 0
                repeat {
                    cursor = code.index(before: cursor)
                    if code[cursor] == previous { depth += 1 }
                    if code[cursor] == open { depth -= 1 }
                } while depth > 0 && cursor > code.startIndex
                continue
            }
            var start = cursor
            while start > code.startIndex,
                code[code.index(before: start)].isLetter || code[code.index(before: start)].isNumber
                    || code[code.index(before: start)] == "_"
            {
                start = code.index(before: start)
            }
            guard start < cursor else { return "" }
            let name = String(code[start..<cursor])
            cursor = start
            skipSpace()
            guard cursor > code.startIndex, code[code.index(before: cursor)] == "." else { return name }
            cursor = code.index(before: cursor)
        }
    }

    /// Whether `file` is code the Mac pass checks: every file under `CrosstuneUI`.
    static func isMacScreen(_ file: URL) -> Bool {
        file.path.contains("/CrosstuneUI/")
    }

    /// Every file the Mac pass checks, with what its Mac-compiled code violates.
    static func macScreenViolations() throws -> [String: Set<Violation>] {
        var result: [String: Set<Violation>] = [:]
        var screens: [ButtonStyleScan.File] = []
        var library: [ButtonStyleScan.File] = []
        for file in SourceScan.files() {
            let path = SourceScan.relative(file)
            let source = ButtonStyleScan.File(path: path, code: try macCode(of: file))
            library.append(source)
            guard Self.isMacScreen(file) else { continue }
            screens.append(source)
            let found = macViolations(in: source.code)
            if !found.isEmpty { result[path] = found }
        }
        let scan = ButtonStyleScan(screens: screens, library: library)
        for (path, lines) in scan.unstyledButtons() {
            for line in lines { result[path, default: []].insert(Violation(rule: "unstyled button", line: line)) }
        }
        for (path, found) in glyphViolations(scan) { result[path, default: []].formUnion(found) }
        return result
    }

    /// A button or menu that shows a glyph alone draws the shared icon button, from its own chain,
    /// a container around it, a page section's accessory, or a modifier that applies it. The pane
    /// bar's glass controls and the system's places, such as a menu's items, pass.
    static func glyphViolations(_ scan: ButtonStyleScan) -> [String: Set<Violation>] {
        scan.glyphActionsWithoutIconButton().mapValues { lines in
            Set(lines.map { Violation(rule: "glyph action without the icon button", line: $0) })
        }
    }

    /// What a Mac sample breaks: the file's own rules, and the glyph rule with the sample as the
    /// only file.
    static func macSampleViolations(in code: String) -> Set<Violation> {
        let file = ButtonStyleScan.File(path: "Sample", code: code)
        let glyphs = glyphViolations(ButtonStyleScan(screens: [file], library: [file]))
        return macViolations(in: code).union(glyphs.values.flatMap { $0 })
    }

    @Test func macScreensDrawNoControlOfTheirOwn() throws {
        var offenders: [String: Set<Violation>] = [:]
        for (path, found) in try Self.macScreenViolations() {
            let kept = found.filter { !Self.isAllowed($0, in: path, on: .mac) }
            if !kept.isEmpty { offenders[path] = kept }
        }
        let report = offenders.keys.sorted().flatMap { path in
            offenders[path]!.sorted { ($0.rule, $0.line) < ($1.rule, $1.line) }
                .map { "\(path): \($0.rule): \($0.line)" }
        }
        #expect(
            offenders.isEmpty,
            """
            Mac code that builds its own control or handles its own focus. Use the library \
            control, `macFocusable` and `macFocusRing` for a control's focus, `keySurface` for a \
            view that takes a screen's keys, the `MacMotion` tokens for motion, and `.icon`, \
            `iconButtonMenuAppearance()`, or `iconButtonAppearance(phone:)` for a glyph alone.
            \(report.joined(separator: "\n"))
            """)
    }

    /// Each Mac rule's sample, and the rule it breaks, or nil for one that passes.
    static let macSamples: [(code: String, rule: String?)] = [
        (".overlay { if isFocused { shape.stroke(Palette.accent, lineWidth: 2) } }", "own focus ring"),
        ("if showsRing && isFocused {\nshape.strokeBorder(Palette.accent)\n}", "own focus ring"),
        ("if (x && self.isFocused) { Color.clear.fill(Palette.accent) }", "own focus ring"),
        ("if focused { Text(x).border(Palette.color(.accent), width: 2) }", "own focus ring"),
        ("if focused { Text(x).background(Palette.accent) }", "own focus ring"),
        ("if focused { Text(x).overlay(Palette.accent) }", "own focus ring"),
        ("Rectangle().fill(titleFocused ? Palette.accent : Palette.border)", "own focus ring"),
        ("Rectangle().fill((x && isFocused) ? .accent : .clear)", "own focus ring"),
        ("Rectangle().fill(self.focused ? Palette.color(.accent) : .clear)", "own focus ring"),
        ("if isFocused { Text(x).foregroundStyle(Palette.accent) }", nil),
        ("Rectangle().fill(isHovered ? Palette.accent : .clear)", nil),
        ("Button(x) {}.focused($focused)", "focus on a control"),
        ("toggle.focused(focus)", "focus on a control"),
        ("func ring() -> some View { focused(isOn) }", "focus on a control"),
        ("TextField(x, text: $t).labelsHidden()\n.focused($focused)", nil),
        ("Grid {}.focusable()", "own focus handling"),
        ("func stop() -> some View { focusable() }", "own focus handling"),
        ("Text(x).defaultFocus($f, true)", "own focus handling"),
        ("func row() -> some View { onHover { hovered = $0 } }", "own hover state"),
        ("withAnimation(reduceMotion ? nil : .easeOut(duration: 1)) {}", "own animation"),
        (".animation(reduceMotion ? nil : .interpolatingSpring(stiffness: 1, damping: 1), value: x)", "own animation"),
        (".animation(isOn ? .default : nil, value: x)", "own animation"),
        ("let sort = stored ?? .default", nil),
        ("let curve = style?.linear", nil),
        ("let sort = choice?.default ?? fallback", nil),
        ("let move: Animation = .easeInOut(duration: 1)", "own animation"),
        (".macAnimation(MacMotion.spring, value: x)", nil),
        ("Link(x, destination: url)", "system link"),
        ("Link(x, destination: url)\n.buttonStyle(.text)", nil),
        ("Toggle(x, isOn: $on).toggleStyle(.checkbox)", "checkbox toggle style"),
        ("choices.pickerStyle(.radioGroup)", "radio group picker style"),
        ("choices.pickerStyle(.segmented)", "segmented picker style"),
        ("Picker(x, selection: $s) {}", "system picker"),
        ("DatePicker(x, selection: $d)", nil),
        ("SuggestionPicker(x, value: $v)", nil),
        ("Button(x) {}.buttonStyle(.link)", "system button style"),
        (
            "Button(x, systemImage: y) {}\n.labelStyle(.iconOnly)\n.buttonStyle(.text)",
            "glyph action without the icon button"
        ),
        ("Button(x, systemImage: y) {}\n.labelStyle(.iconOnly)\n.buttonStyle(.icon)", nil),
        ("Button(x, systemImage: y) {}.buttonStyle(.text)", nil),
        ("Button {} label: { Image(systemName: y) }.buttonStyle(.labelOnly)", "glyph action without the icon button"),
        (
            "Button(action: a) {\nImage(systemName: y)\n.imageScale(.small)\n}\n.buttonStyle(.rowLine)",
            "glyph action without the icon button"
        ),
        ("Button {} label: { Image(systemName: y) }.buttonStyle(.icon(isOn: on))", nil),
        ("Button {} label: { HStack { Text(x)\nImage(systemName: y) } }.buttonStyle(.text)", nil),
        ("Button {} label: { Label(x, systemImage: y) }.buttonStyle(.text)", nil),
        (
            "Menu { items } label: { Label(x, systemImage: y).labelStyle(.iconOnly) }\n.textButtonMenuAppearance()",
            "glyph action without the icon button"
        ),
        ("Menu { items } label: { Label(x, systemImage: y).labelStyle(.iconOnly) }\n.iconButtonMenuAppearance()", nil),
        ("Menu(x, systemImage: y) { items }\n.labelStyle(.iconOnly)", "glyph action without the icon button"),
        (
            "Button {} label: { Label(x, systemImage: y).labelStyle(.iconOnly) }\n.iconButtonAppearance { $0.buttonStyle(.text) }",
            nil
        ),
        (
            "HStack { Button(x, systemImage: y) {} }\n.labelStyle(.iconOnly)\n.buttonStyle(.text)",
            "glyph action without the icon button"
        ),
        ("HStack { Button(x, systemImage: y) {} }\n.labelStyle(.iconOnly)\n.buttonStyle(.icon)", nil),
        (
            "struct A: View {\nvar body: some View { PageSection(x) {\nButton(x, systemImage: y) {}.labelStyle(.iconOnly)\n} content: { Text(x) } }\n}",
            nil
        ),
        (
            "struct A: View {\nvar body: some View { Text(x).paneBar {\nButton {} label: { Image(systemName: y) }\n} }\n}",
            nil
        ),
        ("Menu { Button {} label: { Image(systemName: y) } } label: { Text(x) }", nil),
    ]

    @Test(arguments: macSamples)
    func aMacRuleFlagsItsSample(_ sample: (code: String, rule: String?)) {
        let rules = Set(Self.macSampleViolations(in: sample.code).map(\.rule))
        #expect(rules == Set([sample.rule].compactMap { $0 }), "\(sample.code)")
    }

    @Test func chainRootSkipsModifiersAndClosures() {
        let code = "TextField(x, text: $t) {\n}\n.onGeometryChange(for: Int.self) { $0 } action: { _ in }\n.focused(f)"
        #expect(Self.chainRoot(before: code.range(of: ".focused")!.lowerBound, in: code) == "TextField")
    }
}
