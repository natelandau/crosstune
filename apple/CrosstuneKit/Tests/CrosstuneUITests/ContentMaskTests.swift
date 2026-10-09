import Foundation
import Testing

/// Session replay records the iPhone and iPad screens, so every view that shows what the
/// musician wrote or named carries `.contentMask()` in its own modifier chain. The scan reads
/// the source because a mask is invisible to everything but a recording.
///
/// The scan sees a content read written inside the view's own parentheses, or a local bound to
/// one with `let` or `var` in the same file. A value that arrives as a parameter or a stored
/// property, such as `Text(title)` in a row that is handed its title, passes unseen, so a view
/// like that is masked by hand.
@Suite struct ContentMaskTests {
    /// Properties that hold user content. A new content property belongs in this list, so every
    /// view that shows it must be masked.
    static let contentProperties: Set = [
        "title", "tuneTitle", "trackTitle", "alternateTitles", "name", "notes", "lyrics",
        // Facets the musician can type through Other.
        "composer", "learnedFrom", "genre", "tuneType", "partStructure",
        // Loop names.
        "selectedName", "switcherLabel",
        // A stats breakdown's value, which can be a composer or who a tune was learned from.
        "value",
        // The catalog's offer to add the typed search as a tune.
        "offerLabel",
        // The genre new tunes start with, and the settings line that shows it.
        "newTuneGenre", "newTunesSummary",
    ]

    /// Methods that return user content, for the same reason as `contentProperties`.
    static let contentMethods: Set = [
        "facetLine", "valueLabel", "capsuleLabel", "learned",
        // Lines built around a typed search, a tune title, or a list name.
        "noTuneCalled", "added", "removed", "openTune", "filingUnder",
    ]

    /// Reads whose property or method is named like content but hold the app's own words.
    static let notContent: Set = [
        "category.title", "TextSize.valueLabel", "RecordingText.added", "action.title",
    ]

    /// Views that show their argument. One whose argument reads a content property is masked.
    static let displays: Set = [
        "Text", "Label", "Button", "Toggle", "LabeledContent", "NavigationLink", "Menu", "Section", "Link",
    ]

    /// Views the musician types into. Every one is masked, whatever it is bound to.
    static let inputs: Set = ["TextField", "TextEditor", "SecureField"]

    struct Site: Equatable {
        let line: Int
        let view: String
        let masked: Bool
    }

    /// Every display that reads user content and every input in `text`, and whether its
    /// modifier chain carries `.contentMask()`.
    static func sites(in text: String) -> [Site] {
        let stripped = SourceScan.withoutComments(text)
        let locals = contentLocals(in: stripped)
        let chars = Array(stripped)
        var sites: [Site] = []
        var index = 0
        while index < chars.count {
            guard let (view, open) = viewCall(in: chars, at: index) else {
                index += 1
                continue
            }
            let close = matching(chars, from: open)
            let argument = String(chars[(open + 1)..<max(open + 1, close)])
            index = open + 1
            guard inputs.contains(view) || readsContent(argument, locals: locals) else { continue }
            let line = chars[..<index].count { $0 == "\n" } + 1
            sites.append(
                Site(line: line, view: view, masked: modifiers(in: chars, after: close).contains("contentMask")))
        }
        return sites
    }

    /// The view name and the index of its opening parenthesis when a view's initializer starts
    /// at `index`. A member call such as `.Text(` or `MyText(` is not one.
    private static func viewCall(in chars: [Character], at index: Int) -> (String, Int)? {
        if index > 0, chars[index - 1] == "." || isWordCharacter(chars[index - 1]) { return nil }
        for view in displays.union(inputs) {
            let end = index + view.count
            guard end < chars.count, chars[end] == "(", String(chars[index..<end]) == view else { continue }
            return (view, end)
        }
        return nil
    }

    private static func isWordCharacter(_ character: Character) -> Bool {
        character.isLetter || character.isNumber || character == "_"
    }

    /// The index of the bracket that closes the one at `open`, or the end of the text.
    private static func matching(_ chars: [Character], from open: Int) -> Int {
        var depth = 0
        var index = open
        while index < chars.count {
            switch chars[index] {
            case "(", "[", "{": depth += 1
            case ")", "]", "}":
                depth -= 1
                if depth == 0 { return index }
            default: break
            }
            index += 1
        }
        return chars.count
    }

    /// Whether `expression` reads a content property off a value, rather than off a type such as
    /// `Self` or `TuneFieldLabels`, calls a content method, or names one of `locals`.
    static func readsContent(_ expression: String, locals: Set<String> = []) -> Bool {
        let reads = expression.matches(of: /([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)\b(\s*\()?/)
        let readsMember = reads.contains { match in
            let root = String(match.1)
            let member = String(match.3)
            let owner = (String(match.2).split(separator: ".").last.map(String.init)) ?? root
            guard !notContent.contains("\(owner).\(member)") else { return false }
            if match.4 != nil { return contentMethods.contains(member) }
            return contentProperties.contains(member) && root.first?.isLowercase == true
        }
        return readsMember || !locals.isDisjoint(with: bareIdentifiers(in: expression))
    }

    /// Names bound with `let` or `var`, or later assigned, to an expression that reads content,
    /// followed through locals bound from those. The whole file is one scope, so a name reused for
    /// the app's own words is treated as content too.
    static func contentLocals(in text: String) -> Set<String> {
        let declared = text.matches(of: /\b(?:let|var)\s+([A-Za-z_]\w*)\s*=\s*([^\n]*)/)
            .map { (name: String($0.1), expression: String($0.2)) }
        // An assignment starts a line or follows a brace; `==` and `!=` are comparisons.
        let assigned = text.matches(of: /(?:^|\n|\{)\s*([A-Za-z_]\w*)\s*=(?!=)\s*([^\n]*)/)
            .map { (name: String($0.1), expression: String($0.2)) }
        let bindings = declared + assigned
        var locals: Set<String> = []
        while true {
            let found = Set(bindings.filter { readsContent($0.expression, locals: locals) }.map(\.name))
            if found.isSubset(of: locals) { return locals }
            locals.formUnion(found)
        }
    }

    /// Identifiers in `expression` that are not a member of something else.
    private static func bareIdentifiers(in expression: String) -> Set<String> {
        let chars = Array(expression)
        var names: Set<String> = []
        var index = 0
        while index < chars.count {
            guard isWordCharacter(chars[index]), !chars[index].isNumber else {
                index += 1
                continue
            }
            let start = index
            while index < chars.count, isWordCharacter(chars[index]) { index += 1 }
            if start == 0 || chars[start - 1] != "." { names.insert(String(chars[start..<index])) }
        }
        return names
    }

    /// The names of the modifiers chained onto the view whose arguments close at `close`.
    private static func modifiers(in chars: [Character], after close: Int) -> [String] {
        var names: [String] = []
        var index = skippingTrailingClosures(in: chars, from: close + 1)
        while true {
            while index < chars.count, chars[index].isWhitespace { index += 1 }
            guard index < chars.count, chars[index] == "." else { return names }
            index += 1
            let start = index
            while index < chars.count, isWordCharacter(chars[index]) { index += 1 }
            names.append(String(chars[start..<index]))
            // The modifier's arguments, then any trailing closures.
            while true {
                var next = index
                while next < chars.count, chars[next] == " " { next += 1 }
                guard next < chars.count, chars[next] == "(" || chars[next] == "{" else { break }
                index = matching(chars, from: next) + 1
            }
        }
    }

    /// Whether each use of `marker`, a view call up to its opening parenthesis's argument, carries
    /// `.contentMask()` in its modifier chain.
    static func masks(of marker: String, in text: String) -> [Bool] {
        let chars = Array(SourceScan.withoutComments(text))
        let target = Array(marker)
        guard let open = target.firstIndex(of: "(") else { return [] }
        var found: [Bool] = []
        var index = 0
        while index + target.count <= chars.count {
            if Array(chars[index..<(index + target.count)]) == target {
                let close = matching(chars, from: index + open)
                found.append(modifiers(in: chars, after: close).contains("contentMask"))
            }
            index += 1
        }
        return found
    }

    /// The index past any trailing closures, labeled or not, that follow a call ending at `index`.
    private static func skippingTrailingClosures(in chars: [Character], from index: Int) -> Int {
        var index = index
        while true {
            var next = index
            while next < chars.count, chars[next].isWhitespace { next += 1 }
            var label = next
            while label < chars.count, isWordCharacter(chars[label]) { label += 1 }
            // `label: {` after the first closure, as in `Button { } label: { }`.
            if label > next, label < chars.count, chars[label] == ":" {
                next = label + 1
                while next < chars.count, chars[next].isWhitespace { next += 1 }
            }
            guard next < chars.count, chars[next] == "{" else { return index }
            index = matching(chars, from: next) + 1
        }
    }

    /// Swipe-action labels, by file and text on the label's line. SwiftUI builds a swipe action's
    /// label into a UIKit button, which takes no SwiftUI overlay; the replay masks that button's
    /// title by type.
    static let swipeLabels: [(file: String, marker: String)] = [
        ("Lists/ListScreen.swift", "Label(ListScreen.reorder("),
        ("Lists/ListScreen.swift", "Section(ListScreen.move("),
    ]

    @Test func everyViewOfUserContentIsMasked() throws {
        var unmasked: [String] = []
        for file in SourceScan.files() {
            let relative = SourceScan.relative(file)
            let text = try SourceScan.text(at: file)
            let lines = text.components(separatedBy: "\n")
            for site in Self.sites(in: text) where !site.masked {
                let isSwipeLabel = Self.swipeLabels.contains {
                    $0.file == relative && lines[site.line - 1].contains($0.marker)
                }
                if isSwipeLabel { continue }
                unmasked.append("\(relative):\(site.line) \(site.view)")
            }
        }
        #expect(unmasked.isEmpty, "Add .contentMask() to the view's modifier chain: \(unmasked.sorted())")
    }

    /// A rename that hid the tune row from the scan fails here rather than passing quietly.
    @Test func theScanSeesTheTuneRowsTitle() throws {
        let row = try SourceScan.text(at: SourceScan.sources.appending(path: "Components/TuneRow.swift"))
        #expect(Self.sites(in: row).contains { $0.view == "Text" })
    }

    @Test func aBareTitleIsUnmasked() {
        #expect(Self.sites(in: "Text(tune.title)") == [Site(line: 1, view: "Text", masked: false)])
    }

    @Test func aMaskAnywhereInTheChainCounts() {
        let text = """
            VStack {
                Text(detail.tune.title)
                    .font(.headline)
                    .onTapGesture { open() }
                    .contentMask()
                Label(list.name, systemImage: "music.note.list").contentMask()
            }
            """
        #expect(
            Self.sites(in: text) == [
                Site(line: 2, view: "Text", masked: true), Site(line: 6, view: "Label", masked: true),
            ])
    }

    @Test func aMaskOnAnotherViewDoesNotCount() {
        let text = """
            Text(summary.name)
            Text(summary.detail).contentMask()
            """
        #expect(Self.sites(in: text) == [Site(line: 1, view: "Text", masked: false)])
    }

    @Test func everyInputCountsWhateverItIsBoundTo() {
        let text = """
            TextField(prompt, text: $query)
            TextEditor(text: $lyrics).contentMask()
            """
        #expect(
            Self.sites(in: text) == [
                Site(line: 1, view: "TextField", masked: false), Site(line: 2, view: "TextEditor", masked: true),
            ])
    }

    @Test func aLocalBoundToContentCounts() {
        let text = """
            let label = model.switcherLabel
            if let name = player.loops.selectedName {
                Text(label ?? PracticeText.noLoop)
                Text(PracticeText.repeating(name)).contentMask()
            }
            let line = TunePage.facetLine(detail)
            Text(Self.breakingAfterDots(line))
            Text(Self.breakingAfterDots(other))
            """
        #expect(
            Self.sites(in: text) == [
                Site(line: 3, view: "Text", masked: false), Site(line: 4, view: "Text", masked: true),
                Site(line: 7, view: "Text", masked: false),
            ])
    }

    @Test func aContentMethodCounts() {
        #expect(Self.sites(in: "Text(facet.valueLabel(value))").count == 1)
        #expect(Self.sites(in: "Text(TextSize.valueLabel(system: size, offset: 0))").isEmpty)
    }

    /// Views that show a value handed in, which the scan cannot trace, masked by hand. Each
    /// marker names every such view in its file.
    static let handMasks: [(file: String, marker: String)] = [
        ("Components/FilterSearchField.swift", "Text(label)"),
        ("Components/UndoBanner.swift", "Text(message)"),
        ("Catalog/SearchOffer.swift", "Label(label"),
        ("Catalog/SearchOffer.swift", "Text(match.note)"),
        // A category's summary, which for New tunes is the genre.
        ("Phone/SettingsRoot.swift", "Text(value(category))"),
        // The system picker shows a typed value as its own choice and as the row's selection.
        ("TuneForm/SuggestionPicker.swift", "Picker(selection: selection)"),
    ]

    @Test func everyHandMaskStaysInPlace() throws {
        for (file, marker) in Self.handMasks {
            let text = try SourceScan.text(at: SourceScan.sources.appending(path: file))
            let masks = Self.masks(of: marker, in: text)
            #expect(!masks.isEmpty, "\(file) no longer has \(marker)")
            #expect(masks.allSatisfy { $0 }, "\(file): add .contentMask() to every \(marker)")
        }
    }

    @Test func aHandMaskIsSeenOnEveryUse() {
        let text = """
            Text(label).contentMask()
            Text(label)
                .font(.body)
            """
        #expect(Self.masks(of: "Text(label)", in: text) == [true, false])
    }

    @Test func aReassignedLocalCounts() {
        let text = """
            var title = Self.nothingMatches
            if case .create(let typed, false, _) = outcome { title = CatalogScreen.noTuneCalled(typed) }
            Label(title, systemImage: "music.note")
            """
        #expect(Self.sites(in: text) == [Site(line: 3, view: "Label", masked: false)])
    }

    @Test func theSearchOfferAndUndoMessagesAreContent() {
        let text = """
            if let offer = results.outcome.offerLabel {
                Button(offer) { create() }
            }
            Text(BulkActions.added(addition))
            Text(BulkActions.removed(count, from: list))
            Text(RecordingText.added(recording.addedAt))
            """
        #expect(
            Self.sites(in: text) == [
                Site(line: 2, view: "Button", masked: false), Site(line: 4, view: "Text", masked: false),
                Site(line: 5, view: "Text", masked: false),
            ])
    }

    @Test func everyViewThatShowsAStringCounts() {
        let text = """
            Toggle(list.name, isOn: $on)
            LabeledContent(TuneFieldLabels.composer, value: tune.composer)
            NavigationLink(tune.title, value: route)
            Menu(list.name) { items }
            Section(ListScreen.move(entry.tune.title)) { items }
            Link(link.title, destination: url)
            """
        #expect(
            Self.sites(in: text).map(\.view) == [
                "Toggle", "LabeledContent", "NavigationLink", "Menu", "Section", "Link",
            ])
    }

    @Test func aMaskAfterATrailingClosureCounts() {
        let text = """
            Button(offer.title) { create() }
                .contentMask()
            """
        #expect(Self.sites(in: text) == [Site(line: 1, view: "Button", masked: true)])
    }

    @Test func aCommentMarkerInsideAStringIsNotAComment() {
        #expect(
            SourceScan.withoutComments(#"let url = "https://example.com" // the site"#)
                == #"let url = "https://example.com" "#)
        #expect(SourceScan.withoutComments(#"Text("a \" // b") // c"#) == #"Text("a \" // b") "#)
    }

    @Test func theAppsOwnWordsAndCommentsAreNotContent() {
        let text = """
            Text(Self.title)
            Text(TuneFieldLabels.notes)
            Text(category.title)
            Text(mode.title(speedPercent: 100))
            // Text(tune.title)
            """
        #expect(Self.sites(in: text).isEmpty)
    }
}
