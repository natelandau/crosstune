import Foundation

/// Finds each `Button` in screen code that draws the system's default look: no `.buttonStyle` on
/// it, none on a container around it, and, when it sits in a property, a function, or a view of
/// its own, none where every caller places that. A button the system styles on purpose passes: in
/// a menu's items, a dialog's or an alert's actions, a toolbar, swipe actions, a context menu's
/// items, or accessibility actions, or one the code hides.
///
/// A style set in another file counts only where it reaches the button's own closure:
/// - The library containers that style what they hold: everything in a grouped form, a page
///   section's accessory (never its content), a sheet action bar's primary and secondary, and a
///   pane bar's controls.
/// - A modifier in the button's chain, or a container's, whose every declaration of that name
///   applies `buttonStyle` to what it modifies.
/// - A call the closure is passed to whose every declaration of that name puts that closure
///   parameter, and every use of it, in one of the system places above.
/// A name declared more than once must hold for every declaration, so a name that collides can
/// only flag more buttons, never fewer. Generic names such as `body` never resolve.
struct ButtonStyleScan {
    /// What a search counts as reaching a control: any button style, or only the shared icon
    /// button, or a label style that shows the glyph alone.
    enum Look {
        case anyStyle, iconButton, glyphOnlyLabel

        /// Whether `chain` applies the look itself.
        func isApplied(in chain: String) -> Bool {
            switch self {
            case .anyStyle: chain.contains(".buttonStyle(") || chain.contains(".hidden()")
            case .iconButton:
                ButtonStyleScan.contains(
                    #"\.buttonStyle\(\s*\.icon\b|\.iconButton(?:Menu)?Appearance\b|\.hidden\(\)"#, in: chain)
            case .glyphOnlyLabel: ButtonStyleScan.contains(#"\.labelStyle\(\s*\.iconOnly\b"#, in: chain)
            }
        }

        /// Whether the system's places, such as a menu's items or a toolbar, count as the look.
        var countsSystemPlaces: Bool { self != .glyphOnlyLabel }
    }

    struct File {
        let path: String
        /// The code as the iOS build compiles it, without comments or string text.
        let code: String
        let bytes: [UInt8]

        init(path: String, code: String) {
            self.path = path
            // Byte offsets stand for character offsets, so every non-ASCII character becomes a space.
            let ascii = String(code.unicodeScalars.map { $0.isASCII ? Character($0) : " " })
            self.code = ascii
            bytes = Array(ascii.utf8)
        }
    }

    /// A function or type declaration: its header and the braces of its body.
    private struct Declaration {
        let file: File
        let isFunction: Bool
        let header: String
        let body: Range<Int>
    }

    /// The call a closure or an argument list belongs to, and the closure's argument label: nil
    /// for an unlabeled trailing closure or an argument list.
    private struct Placement {
        let callee: String
        let label: String?
        /// The label of the closure after this one, as `content` after a page section's accessory.
        let nextLabel: String?
    }

    /// How deep the scan follows uses and declarations before it gives up on a button.
    private static let maxDepth = 10

    private static let spaces: Set = [UInt8(ascii: " "), UInt8(ascii: "\n"), UInt8(ascii: "\t")]

    private static let genericNames: Set = [
        "body", "content", "label", "init", "modifier", "view", "makeBody", "buttons", "action",
    ]

    let screens: [File]
    private let declarations: [String: [Declaration]]

    init(screens: [File], library: [File]) {
        self.screens = screens
        var declarations: [String: [Declaration]] = [:]
        for file in library {
            for match in Self.matches(#"\b(func|struct)\s+(\w+)[^{]*\{"#, in: file.code) {
                let name = file.text(match.range(at: 2))
                guard !Self.genericNames.contains(name) else { continue }
                let open = match.range.upperBound - 1
                declarations[name, default: []].append(
                    Declaration(
                        file: file, isFunction: file.text(match.range(at: 1)) == "func",
                        header: file.text(match.range), body: open..<Self.closing(open, in: file)))
            }
        }
        self.declarations = declarations
    }

    /// The lines of every unstyled button, by file.
    func unstyledButtons() -> [String: [String]] {
        var found: [String: [String]] = [:]
        for file in screens {
            for match in Self.matches(#"\bButton\b\s*[({]"#, in: file.code) {
                let start = match.range.lowerBound
                let end = Self.endOfCall(match.range.upperBound - 1, in: file)
                if file.text(start..<end).contains("role: .close") { continue }
                if !isStyled(in: file, from: start, to: end, within: nil, look: .anyStyle, depth: 0, seen: []) {
                    found[file.path, default: []].append(Self.line(at: start, in: file))
                }
            }
        }
        return found
    }

    /// The lines of every button or menu that shows a glyph alone without the shared icon
    /// button, by file. A glyph alone is a label of one `Image(systemName:)`, or a `Label` the
    /// icon-only label style reaches. The system's places pass, as for ``unstyledButtons()``.
    func glyphActionsWithoutIconButton() -> [String: [String]] {
        var found: [String: [String]] = [:]
        for file in screens {
            for match in Self.matches(#"(?<![\w.])(?:Button|Menu)\b\s*[({]"#, in: file.code) {
                let start = match.range.lowerBound
                let end = Self.endOfCall(match.range.upperBound - 1, in: file)
                guard isGlyphOnly(in: file, from: start, to: end, opening: match.range.upperBound - 1) else { continue }
                if !isStyled(in: file, from: start, to: end, within: nil, look: .iconButton, depth: 0, seen: []) {
                    found[file.path, default: []].append(Self.line(at: start, in: file))
                }
            }
        }
        return found
    }

    /// Whether the button or menu from `start` to `end`, whose call opens at `opening`, shows a
    /// glyph alone: its label closure holds only a glyph, or with no label closure, it takes a
    /// title and a symbol and the icon-only label style reaches it.
    private func isGlyphOnly(in file: File, from start: Int, to end: Int, opening: Int) -> Bool {
        var cursor = opening
        var arguments = ""
        if file.bytes[cursor] == UInt8(ascii: "(") {
            let close = Self.closing(cursor, in: file)
            arguments = file.text(cursor..<close)
            cursor = close
        } else {
            cursor = file.text(start..<opening).hasPrefix("Menu") ? start + 4 : start + 6
        }
        var closures: [(label: String?, body: String)] = []
        while let brace = Self.trailingClosure(after: cursor, in: file) {
            let label = Self.firstMatch(#"(\w+):\s*$"#, in: file.text(cursor..<brace))
            let close = Self.closing(brace, in: file)
            closures.append((label, file.text((brace + 1)..<(close - 1))))
            cursor = close
        }
        let isMenu = file.text(start..<opening).hasPrefix("Menu")
        let label: String? =
            closures.first { $0.label == "label" }?.body
            ?? (!isMenu && arguments.contains("action:") ? closures.first?.body : nil)
        if let label { return Self.isGlyph(label) }
        guard Self.contains(#"\bsystemImage:"#, in: arguments) else { return false }
        return isStyled(in: file, from: start, to: end, within: nil, look: .glyphOnlyLabel, depth: 0, seen: [])
    }

    /// Whether a label closure's body is one glyph: an `Image(systemName:)`, or a `Label` with a
    /// symbol shown icon only, each with nothing after its modifiers.
    private static func isGlyph(_ body: String) -> Bool {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        let probe = File(path: "", code: trimmed)
        guard let head = firstMatch(#"^(Image|Label)\s*\("#, in: trimmed) else { return false }
        let open = trimmed.utf8.count - trimmed.drop { $0 != "(" }.utf8.count
        let arguments = probe.text(open..<closing(open, in: probe))
        let end = endOfCall(open, in: probe)
        let modifiers = chain(after: end, in: probe)
        guard probe.text((end + modifiers.utf8.count)..<probe.bytes.count).allSatisfy(\.isWhitespace) else {
            return false
        }
        if head == "Image" { return arguments.contains("systemName:") }
        return arguments.contains("systemImage:") && Look.glyphOnlyLabel.isApplied(in: modifiers)
    }

    /// Whether the view that runs from `start` to `end` takes a button style from its own chain,
    /// a container around it, or every place its enclosing declaration is used. With `bounds`,
    /// the search stays inside that declaration body and fails at its edge.
    private func isStyled(
        in file: File, from start: Int, to end: Int, within bounds: Range<Int>?, look: Look, depth: Int,
        seen: Set<String>
    ) -> Bool {
        guard depth < Self.maxDepth else { return false }
        if chainStyles(Self.chain(after: end, in: file), look: look, depth: depth) { return true }
        if let uses = Self.localUses(after: start, before: bounds?.upperBound ?? file.bytes.count, in: file) {
            return !uses.isEmpty
                && uses.allSatisfy {
                    isStyled(
                        in: file, from: $0.start, to: $0.end, within: bounds, look: look, depth: depth + 1, seen: seen)
                }
        }
        for index in Self.enclosingOpeners(of: start, in: file, above: bounds?.lowerBound) {
            let placement = Self.placement(of: index, in: file)
            if Self.isLibraryStyled(placement, look: look) { return true }
            if look.countsSystemPlaces {
                if Self.isSystemStyled(placement) || placesInSystem(placement, depth: depth) { return true }
            }
            if file.bytes[index] == UInt8(ascii: "{"), bounds == nil {
                let opener = Self.lineHead(at: index, in: file)
                if let type = Self.firstMatch(#"\b(?:struct|class|enum|actor)\s+(\w+)"#, in: opener) {
                    return areStyled(typeUses(type), look, depth, seen, type)
                }
                if Self.contains(#"\bextension\s"#, in: opener) { return false }
                if let name = Self.firstMatch(#"\b(?:var|func)\s+(\w+)[^{]*$"#, in: opener), name != "body" {
                    return areStyled(
                        declarationUses(name, in: file, isFunction: opener.contains("func ")), look, depth, seen, name)
                }
            }
            if chainStyles(Self.chain(after: Self.closing(index, in: file), in: file), look: look, depth: depth) {
                return true
            }
        }
        return false
    }

    private func areStyled(
        _ uses: [(File, Int, Int)], _ look: Look, _ depth: Int, _ seen: Set<String>, _ name: String
    ) -> Bool {
        guard !uses.isEmpty, !seen.contains(name) else { return false }
        return uses.allSatisfy { file, start, nameEnd in
            isStyled(
                in: file, from: start, to: Self.endOfCall(nameEnd, in: file), within: nil, look: look,
                depth: depth + 1, seen: seen.union([name]))
        }
    }

    // MARK: System and library places

    private static func isSystemStyled(_ placement: Placement) -> Bool {
        switch placement.callee {
        case "Menu", "ChipMenu": placement.label != "label"
        case "confirmationDialog", "alert": placement.label != "message"
        case "contextMenu": placement.label != "preview"
        case "toolbar", "ToolbarItem", "ToolbarItemGroup", "swipeActions", "accessibilityActions": true
        default: false
        }
    }

    /// Whether a library container gives what it holds `look`. Only a page section's accessory
    /// draws the icon button, and the pane bar draws its glass controls in place of it.
    private static func isLibraryStyled(_ placement: Placement, look: Look) -> Bool {
        switch look {
        case .glyphOnlyLabel: return false
        case .iconButton:
            return switch placement.callee {
            case "PageSection":
                placement.label == "accessory" || (placement.label == nil && placement.nextLabel == "content")
            case "paneBar": placement.label == "_" || (placement.label == nil && placement.nextLabel == nil)
            default: false
            }
        case .anyStyle: break
        }
        return switch placement.callee {
        case "GroupedForm", "GroupedSelectionForm": true
        case "PageSection":
            placement.label == "accessory" || (placement.label == nil && placement.nextLabel == "content")
        // The pane bar's controls: its only closure, or the one after its leading views.
        case "paneBar": placement.label == "_" || (placement.label == nil && placement.nextLabel == nil)
        case "sheetActions": placement.label == nil || placement.label == "primary" || placement.label == "secondary"
        case "editorActions": placement.label == nil || placement.label == "cancel" || placement.label == "save"
        default: false
        }
    }

    /// Whether every declaration of the callee puts the closure parameter it receives, at every
    /// use, where the system styles buttons.
    private func placesInSystem(_ placement: Placement, depth: Int) -> Bool {
        guard let found = declarations[placement.callee], !found.isEmpty else { return false }
        return found.allSatisfy { declaration in
            guard let (parameter, scope) = closureParameter(of: declaration, label: placement.label) else {
                return false
            }
            let uses = Self.matches(#"(?<![\w.])\#(parameter)\b(?!\s*:)"#, in: declaration.file.code)
                .filter {
                    scope.contains($0.range.lowerBound)
                        && !Self.isAssignment(at: $0.range.lowerBound, in: declaration.file)
                }
            guard !uses.isEmpty else { return false }
            return uses.allSatisfy {
                isPlacedInSystem(
                    in: declaration.file, from: $0.range.lowerBound,
                    to: Self.endOfCall($0.range.upperBound, in: declaration.file), within: scope, depth: depth + 1)
            }
        }
    }

    /// Whether a use inside `scope` sits where the system styles buttons. A style alone does not
    /// count here: the question is where the closure goes, not how a caller styles it.
    private func isPlacedInSystem(in file: File, from start: Int, to end: Int, within scope: Range<Int>, depth: Int)
        -> Bool
    {
        guard depth < Self.maxDepth else { return false }
        if let uses = Self.localUses(after: start, before: scope.upperBound, in: file) {
            return !uses.isEmpty
                && uses.allSatisfy {
                    isPlacedInSystem(in: file, from: $0.start, to: $0.end, within: scope, depth: depth + 1)
                }
        }
        return Self.enclosingOpeners(of: start, in: file, above: scope.lowerBound).contains {
            let placement = Self.placement(of: $0, in: file)
            return Self.isSystemStyled(placement) || placesInSystem(placement, depth: depth)
        }
    }

    /// When the view at `start` is a local's value (`let name =`), each later use of that local
    /// before `limit`, from its name through its call. Nil when it is not a local's value.
    private static func localUses(after start: Int, before limit: Int, in file: File) -> [(start: Int, end: Int)]? {
        guard let local = firstMatch(#"^\s*let\s+(\w+)\s*=\s*$"#, in: lineHead(at: start, in: file)) else {
            return nil
        }
        return matches(#"(?<![\w.])\#(local)\b"#, in: file.code)
            .filter { $0.range.lowerBound > start && $0.range.lowerBound < limit }
            .map { ($0.range.lowerBound, endOfCall($0.range.upperBound, in: file)) }
    }

    /// Each `{` or `(` still open at `start`, from the nearest outward, stopping before `lower`:
    /// the edge of a declaration body the search must not leave.
    private static func enclosingOpeners(of start: Int, in file: File, above lower: Int?) -> [Int] {
        var openers: [Int] = []
        var closeBraces = 0
        var closeParens = 0
        var index = start
        while index > (lower ?? 0) {
            index -= 1
            switch file.bytes[index] {
            case UInt8(ascii: "}"): closeBraces += 1
            case UInt8(ascii: ")"): closeParens += 1
            case UInt8(ascii: "{") where closeBraces > 0: closeBraces -= 1
            case UInt8(ascii: "(") where closeParens > 0: closeParens -= 1
            case UInt8(ascii: "{"), UInt8(ascii: "("):
                if index == lower { return openers }
                openers.append(index)
            default: break
            }
        }
        return openers
    }

    /// The closure parameter of `declaration` that a closure with `label` binds to, and the body
    /// it is used in: a function's own body, or a view's or a view modifier's `body`.
    private func closureParameter(of declaration: Declaration, label: String?) -> (String, Range<Int>)? {
        let closureType = #"(?:@escaping\s+)?(?:@MainActor\s+)?\([^()]*\)\s*(?:async\s+)?(?:throws\s+)?->"#
        let parameter = #"(?:@ViewBuilder\s+)?(?:(\w+)\s+)?(\w+)\s*:\s*"#
        let file = declaration.file
        /// The closure parameter in a parameter list that `label` binds to: the first one for an
        /// unlabeled closure.
        func chosenParameter(in header: String) -> String? {
            let parameters = Self.matches(parameter + closureType, in: header).map {
                (
                    external: header.substring($0.range(at: $0.range(at: 1).location == NSNotFound ? 2 : 1)),
                    name: header.substring($0.range(at: 2))
                )
            }
            return (label.map { label in parameters.first { $0.external == label } } ?? parameters.first)?.name
        }
        if declaration.isFunction {
            return chosenParameter(in: declaration.header).map { ($0, declaration.body) }
        }
        let typeBody = file.text(declaration.body)
        let properties = Self.matches(#"(?:let|var)\s+(\w+)\s*:\s*"# + closureType, in: typeBody)
            .map { typeBody.substring($0.range(at: 1)) }
        let initializer = Self.matches(#"\binit\s*\(([^{]*)\)\s*\{"#, in: typeBody).first
        var chosen: String?
        if let initializer {
            chosen = chosenParameter(in: typeBody.substring(initializer.range(at: 1)))
        } else {
            chosen = label.map { label in properties.first { $0 == label } } ?? properties.first
        }
        guard let chosen,
            let viewBody = Self.matches(#"\b(?:var\s+body\s*:[^{]*|func\s+body\s*\([^)]*\)[^{]*)\{"#, in: typeBody)
                .first
        else { return nil }
        let open = declaration.body.lowerBound + viewBody.range.upperBound - 1
        return (chosen, open..<Self.closing(open, in: file))
    }

    // MARK: Styles

    /// Whether `chain` applies a button style: `.buttonStyle` itself, a hidden button, or a
    /// modifier whose every declaration styles what it modifies.
    private func chainStyles(_ chain: String, look: Look, depth: Int) -> Bool {
        if look.isApplied(in: chain) { return true }
        let names =
            Self.matches(#"\.(\w+)\s*[({]"#, in: chain).map { chain.substring($0.range(at: 1)) }
            + Self.matches(#"\.modifier\(\s*(\w+)"#, in: chain).map { chain.substring($0.range(at: 1)) }
        return names.contains { name in
            guard let found = declarations[name], !found.isEmpty, depth < Self.maxDepth else { return false }
            return found.allSatisfy { stylesWhatItModifies($0, look: look, depth: depth + 1) }
        }
    }

    /// Whether a view extension's body, or a view modifier's `body(content:)`, starts with a chain
    /// on what it modifies that applies a button style.
    private func stylesWhatItModifies(_ declaration: Declaration, look: Look, depth: Int) -> Bool {
        let file = declaration.file
        var bodyText: String
        if declaration.isFunction {
            bodyText = file.text(declaration.body)
        } else {
            let typeBody = file.text(declaration.body)
            guard let body = Self.matches(#"\bfunc\s+body\s*\(\s*content[^)]*\)[^{]*\{"#, in: typeBody).first else {
                return false
            }
            let open = declaration.body.lowerBound + body.range.upperBound - 1
            bodyText = file.text(open..<Self.closing(open, in: file))
        }
        bodyText = String(bodyText.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
        for prefix in ["return ", "self", "content"] where bodyText.hasPrefix(prefix) {
            bodyText = String(bodyText.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
        }
        if !bodyText.hasPrefix(".") { bodyText = "." + bodyText }
        let probe = File(path: "", code: bodyText)
        return chainStyles(Self.chain(after: 0, in: probe), look: look, depth: depth)
    }

    // MARK: Uses

    /// Where a view type is built, in any screen file.
    private func typeUses(_ type: String) -> [(File, Int, Int)] {
        screens.flatMap { file in
            Self.matches(#"(?<![\w.])\#(type)\b(?=\s*[(<{])"#, in: file.code)
                .filter {
                    !Self.contains(#"\b(?:struct|class|enum|extension)\s*$"#, in: file.text(0..<$0.range.lowerBound))
                }
                .map { (file, $0.range.lowerBound, $0.range.upperBound) }
        }
    }

    /// Where a property or function is used in its own file, or, for a method no line of its
    /// own file calls, wherever it is called on a value.
    private func declarationUses(_ name: String, in file: File, isFunction: Bool) -> [(File, Int, Int)] {
        let after = isFunction ? #"(?=\s*[(),])"# : #"\b(?!\s*[:(])"#
        let local = Self.matches(#"(?<![\w.])\#(name)\#(after)"#, in: file.code)
            .filter { !Self.contains(#"\b(?:var|func|let)\s*$"#, in: file.text(0..<$0.range.lowerBound)) }
            .map { (file, $0.range.lowerBound, $0.range.upperBound) }
        guard local.isEmpty, isFunction else { return local }
        return screens.flatMap { other in
            Self.matches(#"(?<=\w\.)\#(name)\("#, in: other.code).map {
                (other, $0.range.lowerBound, $0.range.upperBound - 1)
            }
        }
    }

    /// Whether the name at `index` is being assigned, as `self.name = name()` is in an initializer.
    private static func isAssignment(at index: Int, in file: File) -> Bool {
        contains(#"^\s*self\.\w+\s*=\s*$"#, in: lineHead(at: index, in: file))
    }

    /// The call the bracket at `index` belongs to, and the label of the closure it opens.
    private static func placement(of index: Int, in file: File) -> Placement {
        let head = lineHead(at: index, in: file)
        if file.bytes[index] == UInt8(ascii: "("), let callee = firstMatch(#"(\w+)\s*$"#, in: head) {
            return Placement(callee: callee, label: nil, nextLabel: nil)
        }
        // A labeled trailing closure belongs to the call that opens the first closure.
        if let label = firstMatch(#"^\s*\}\s*(\w+):\s*$"#, in: head), let close = head.lastIndex(of: "}") {
            let closeIndex = index - head.utf8.count + head.utf8.distance(from: head.startIndex, to: close)
            let first = placement(of: opening(closeIndex, in: file), in: file)
            return Placement(callee: first.callee, label: label, nextLabel: nil)
        }
        var before = index
        while before > 0, spaces.contains(file.bytes[before - 1]) { before -= 1 }
        let nextLabel = trailingClosure(after: closing(index, in: file), in: file).flatMap {
            firstMatch(#"^\s*(\w+):"#, in: file.text(closing(index, in: file)..<($0 + 1)))
        }
        // A closure passed as a labeled argument belongs to the call whose parentheses hold it.
        if let label = firstMatch(#"(\w+):\s*$"#, in: file.text(max(0, before - 60)..<before)),
            let open = unmatchedParenthesis(before: before, in: file)
        {
            let callee = firstMatch(#"(\w+)\s*$"#, in: file.text(max(0, open - 60)..<open)) ?? ""
            return Placement(callee: callee, label: label, nextLabel: nil)
        }
        if before > 0, file.bytes[before - 1] == UInt8(ascii: ")") {
            let open = opening(before - 1, in: file)
            let callee = firstMatch(#"(\w+)\s*$"#, in: file.text(max(0, open - 60)..<open)) ?? ""
            return Placement(callee: callee, label: nil, nextLabel: nextLabel)
        }
        let callee = firstMatch(#"(\w+)\s*$"#, in: file.text(max(0, before - 60)..<before)) ?? ""
        return Placement(callee: callee, label: nil, nextLabel: nextLabel)
    }

    /// The offset of the nearest `(` before `index` that is still open there.
    private static func unmatchedParenthesis(before index: Int, in file: File) -> Int? {
        var depth = 0
        var cursor = index
        while cursor > 0 {
            cursor -= 1
            switch file.bytes[cursor] {
            case UInt8(ascii: ")"), UInt8(ascii: "}"): depth += 1
            case UInt8(ascii: "{"):
                if depth == 0 { return nil }
                depth -= 1
            case UInt8(ascii: "("):
                if depth == 0 { return cursor }
                depth -= 1
            default: break
            }
        }
        return nil
    }

    // MARK: Reading the code

    /// The text from the start of the line to `index`.
    private static func lineHead(at index: Int, in file: File) -> String {
        var start = index
        while start > 0, file.bytes[start - 1] != UInt8(ascii: "\n") { start -= 1 }
        return file.text(start..<index)
    }

    private static func line(at index: Int, in file: File) -> String {
        var end = index
        while end < file.bytes.count, file.bytes[end] != UInt8(ascii: "\n") { end += 1 }
        return (lineHead(at: index, in: file) + file.text(index..<end)).trimmingCharacters(in: .whitespaces)
    }

    /// The offset after the bracket that closes the one at `open`.
    static func closing(_ open: Int, in file: File) -> Int {
        let (opening, closing) =
            file.bytes[open] == UInt8(ascii: "(")
            ? (UInt8(ascii: "("), UInt8(ascii: ")")) : (UInt8(ascii: "{"), UInt8(ascii: "}"))
        var depth = 0
        for index in open..<file.bytes.count {
            if file.bytes[index] == opening { depth += 1 }
            if file.bytes[index] == closing {
                depth -= 1
                if depth == 0 { return index + 1 }
            }
        }
        return file.bytes.count
    }

    /// The offset of the bracket that opens the one closing at `close`.
    private static func opening(_ close: Int, in file: File) -> Int {
        let (opening, closing) =
            file.bytes[close] == UInt8(ascii: ")")
            ? (UInt8(ascii: "("), UInt8(ascii: ")")) : (UInt8(ascii: "{"), UInt8(ascii: "}"))
        var depth = 0
        var index = close
        while index >= 0 {
            if file.bytes[index] == closing { depth += 1 }
            if file.bytes[index] == opening {
                depth -= 1
                if depth == 0 { return index }
            }
            index -= 1
        }
        return 0
    }

    /// The offset after a call that starts at `index`: its arguments, then each trailing closure.
    static func endOfCall(_ index: Int, in file: File) -> Int {
        var end = index
        if end < file.bytes.count, file.bytes[end] == UInt8(ascii: "(") { end = closing(end, in: file) }
        while let next = trailingClosure(after: end, in: file) { end = closing(next, in: file) }
        return end
    }

    /// The offset of a closure's brace right after `index`, labeled or not.
    static func trailingClosure(after index: Int, in file: File) -> Int? {
        let rest = file.text(index..<min(file.bytes.count, index + 80))
        guard let match = matches(#"^\s*(?:\w+:\s*)?\{"#, in: rest).first else { return nil }
        return index + match.range.upperBound - 1
    }

    /// The modifiers chained after `end`, each with its arguments and closures.
    static func chain(after end: Int, in file: File) -> String {
        var index = end
        while true {
            var dot = index
            while dot < file.bytes.count, spaces.contains(file.bytes[dot]) { dot += 1 }
            guard dot < file.bytes.count, file.bytes[dot] == UInt8(ascii: ".") else { break }
            var next = dot + 1
            while next < file.bytes.count,
                Character(UnicodeScalar(file.bytes[next])).isLetter
                    || Character(UnicodeScalar(file.bytes[next])).isNumber || file.bytes[next] == UInt8(ascii: "_")
            {
                next += 1
            }
            guard next > dot + 1 else { break }
            while let open = argumentsOrClosure(at: next, in: file) {
                next = closing(open, in: file)
            }
            index = next
        }
        return file.text(end..<index)
    }

    /// The offset of the `(` or `{` that opens a modifier's arguments or trailing closure at
    /// `index`, past any spaces before a closure on the same line.
    private static func argumentsOrClosure(at index: Int, in file: File) -> Int? {
        guard index < file.bytes.count else { return nil }
        if file.bytes[index] == UInt8(ascii: "(") || file.bytes[index] == UInt8(ascii: "{") { return index }
        var next = index
        while next < file.bytes.count, file.bytes[next] == UInt8(ascii: " ") { next += 1 }
        return next < file.bytes.count && file.bytes[next] == UInt8(ascii: "{") ? next : nil
    }

    // MARK: Patterns

    private static func matches(_ pattern: String, in text: String) -> [NSTextCheckingResult] {
        let regex = try! NSRegularExpression(pattern: pattern)
        return regex.matches(in: text, range: NSRange(location: 0, length: text.utf16.count))
    }

    fileprivate static func contains(_ pattern: String, in text: String) -> Bool {
        !matches(pattern, in: text).isEmpty
    }

    /// The first capture of the first match.
    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        matches(pattern, in: text).first.map { text.substring($0.range(at: 1)) }
    }
}

extension ButtonStyleScan.File {
    func text(_ range: Range<Int>) -> String {
        String(decoding: bytes[max(0, range.lowerBound)..<min(bytes.count, range.upperBound)], as: UTF8.self)
    }

    func text(_ range: NSRange) -> String { text(range.location..<(range.location + range.length)) }
}

extension String {
    fileprivate func substring(_ range: NSRange) -> String {
        (self as NSString).substring(with: range)
    }
}
