import Foundation
import Testing

/// The controls sample screen is where a control's every state is looked at, so a control that
/// is missing from it goes unseen.
struct ControlGalleryTests {
    /// Every view and style declared among the library controls.
    static func controlNames() throws -> [String] {
        let folder = SourceScan.url(of: "Phone/Controls")
        let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "swift" }
        let declaration = /package struct (\w+)/
        return try files.flatMap { file in
            try SourceScan.withoutComments(SourceScan.text(at: file))
                .split(separator: "\n")
                .filter { line in
                    line.contains(": View") || line.contains("ButtonStyle") || line.contains("TextFieldStyle")
                }
                .compactMap { line in try declaration.firstMatch(in: String(line)).map { String($0.1) } }
        }
    }

    @Test func findsTheControls() throws {
        let names = try Self.controlNames()
        #expect(names.contains("Transport"))
        #expect(names.contains("LibraryButtonStyle"))
        #expect(names.contains("FilledTextFieldStyle"))
    }

    /// The gallery's code without comments or string literals, so a heading or a comment that
    /// names a control never counts as showing it.
    static func galleryCode() throws -> String {
        let text = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "Phone/ControlGallery.swift")))
        return SourceScan.withoutStrings(text)
    }

    /// The shorthands a style declares for itself, such as `filled` for `LibraryButtonStyle`:
    /// each `static var` or `static func` in an extension `where Self ==` the style.
    static func shorthands(of style: String) throws -> [String] {
        let member = /static\s+(?:var|func)\s+(\w+)/
        return try SourceScan.files().filter { $0.path.contains("/CrosstuneDesign/") }.flatMap { file in
            try SourceScan.withoutComments(SourceScan.text(at: file))
                .components(separatedBy: "extension ")
                .filter { $0.prefix(while: { $0 != "{" }).contains("where Self == \(style)") }
                .flatMap { $0.matches(of: member).map { String($0.1) } }
        }
    }

    /// Whether `code` uses `name`: a view or style built as `Name(`, or a style applied by one of
    /// its shorthands, as in `.buttonStyle(.filled)`. The name must start a word, so `ChipLabel(`
    /// never counts as `Chip(`.
    static func uses(_ name: String, in code: String, shorthands: [String] = []) -> Bool {
        let built = try! Regex("(?:^|[^A-Za-z0-9_.])\(name)(?:<[^>]*>)?\\(")
        if code.contains(built) { return true }
        return shorthands.contains { appliesShorthand($0, in: code) }
    }

    /// Whether `code` applies a style by its shorthand, as in `.buttonStyle(.filled)`.
    static func appliesShorthand(_ shorthand: String, in code: String) -> Bool {
        code.contains(try! Regex("\\.(?:buttonStyle|textFieldStyle)\\(\\.\(shorthand)\\b"))
    }

    @Test func galleryShowsEveryControl() throws {
        let code = try Self.galleryCode()
        for name in try Self.controlNames() {
            let shorthands = try Self.shorthands(of: name)
            #expect(Self.uses(name, in: code, shorthands: shorthands), "ControlGallery never shows \(name)")
        }
    }

    /// Styles kept outside the controls folder that a screen names directly.
    static let otherStyles = ["AccentWordsButtonStyle"]

    @Test func galleryShowsEveryShorthand() throws {
        let code = try Self.galleryCode()
        for name in try Self.controlNames() + Self.otherStyles {
            for shorthand in try Set(Self.shorthands(of: name)) {
                #expect(
                    Self.appliesShorthand(shorthand, in: code), "ControlGallery never shows .\(shorthand) of \(name)")
            }
        }
    }

    @Test func aNameInsideAnotherNameIsNotAUse() {
        #expect(!Self.uses("Chip", in: "ChipLabel(\"\", kind: .token)"))
        #expect(Self.uses("Chip", in: "Chip(\"\", kind: .token) {}"))
        #expect(Self.uses("PaneTabs", in: "PaneTabs<Mode>(selection: $mode, tabs: [])"))
        #expect(!Self.uses("IconButtonStyle", in: "Text(\"\")", shorthands: ["icon"]))
        #expect(Self.uses("IconButtonStyle", in: "Button {}.buttonStyle(.icon(.circled))", shorthands: ["icon"]))
    }

    @Test func findsAStylesShorthands() throws {
        #expect(try Set(Self.shorthands(of: "LibraryButtonStyle")) == ["filled", "tinted", "text"])
        #expect(try Self.shorthands(of: "IconButtonStyle").contains("icon"))
        #expect(
            try Set(Self.shorthands(of: "RowButtonStyle")) == ["rowLine", "rowHighlight", "pickRow", "formPickRow"])
        #expect(try Set(Self.shorthands(of: "LabelOnlyButtonStyle")) == ["labelOnly"])
    }
}
