#if os(macOS)
    import Foundation
    import Testing

    @testable import CrosstuneUI

    @Suite struct MacTypeTests {
        /// Files, and folders ending in `/`, that only the iPhone and iPad drawing reaches. Each is
        /// checked against its use, since a file with no `#if` is compiled for the Mac too.
        static let iOSOnly = [
            "Phone/", "Pad/",
        ]

        /// Drawing that only the iPhone and iPad reach in a file the Mac also compiles for its
        /// other parts: from the line holding the first marker up to the one holding the second.
        static let iOSOnlyDrawing: [String: (from: String, to: String)] = [
            // The bar itself shows only in the phone's tab accessory and the iPad's foot; the Mac
            // reads its labels and its close control.
            "Player/PlayerBar.swift": ("public var body: some View", "struct PlayerCloseButton")
        ]

        /// The lines of `file` the Mac compiles and may draw, previews left out, or nil for a
        /// file only the iPhone and iPad reach.
        static func macDrawn(_ file: URL) throws -> String? {
            let name = SourceScan.relative(file)
            if iOSOnly.contains(where: { name.hasPrefix($0) }) { return nil }
            let text = SourceScan.withoutPreviews(try SourceScan.text(at: file))
            let drawn = name.hasPrefix("Mac/") ? text : SourceScan.macCompiled(text)
            guard let (from, to) = iOSOnlyDrawing[name] else { return drawn }
            var lines = drawn.split(separator: "\n", omittingEmptySubsequences: false)
            guard let start = lines.firstIndex(where: { $0.contains(from) }),
                let end = lines[start...].firstIndex(where: { $0.contains(to) })
            else { return drawn }
            lines.removeSubrange(start..<end)
            return lines.joined(separator: "\n")
        }

        /// A SwiftUI text style used as a font: `.font(.footnote)`, `Font.title3`, `font: .body`,
        /// `: Font = .caption`, or a style in a ternary inside `.font(`.
        private static var textStyle: Regex<(Substring, Substring, Substring)> {
            /(\.font\(\s*\.|\.font\((?!\.platform)[^\n]*[?:]\s*\.|\bFont\.|font:\s*\.|:\s*Font\s*=\s*\.)(largeTitle|title3|title2|title|headline|subheadline|footnote|caption2|caption|callout|body)\b/
                // Simple boundaries, so a style followed by `.weight(` still ends at its dot.
                .wordBoundaryKind(.simple)
        }

        private static func offenders(in text: String) -> [String] {
            SourceScan.withoutComments(text).split(separator: "\n")
                .filter { $0.contains(textStyle) }
                .map { $0.trimmingCharacters(in: .whitespaces) }
        }

        @Test func macCompiledCodeUsesOnlyMacTypeRoles() throws {
            var found: [String] = []
            for file in SourceScan.files() {
                guard let drawn = try Self.macDrawn(file) else { continue }
                found += Self.offenders(in: drawn).map { "\(SourceScan.relative(file)) \($0)" }
            }
            #expect(found.isEmpty, "\(found.joined(separator: "\n"))")
        }

        @Test func iOSOnlyListNamesRealFiles() throws {
            let names = SourceScan.files().map(SourceScan.relative)
            for entry in Self.iOSOnly {
                #expect(names.contains { $0.hasPrefix(entry) }, "\(entry)")
            }
            for (name, markers) in Self.iOSOnlyDrawing {
                let text = try SourceScan.text(at: SourceScan.sources.appending(path: name))
                #expect(text.contains(markers.from) && text.contains(markers.to), "\(name)")
            }
        }

        @Test func conditionsThatIncludeTheMacCountAsMac() {
            let text = """
                #if !os(iOS)
                a
                #else
                b
                #endif
                #if os(macOS) && DEBUG
                c
                #else
                d
                #endif
                #if os(iOS) && DEBUG
                e
                #else
                f
                #endif
                #if os(macOS) || DEBUG
                g
                #else
                h
                #endif
                """
            #expect(
                SourceScan.macCompiled(text).split(separator: "\n").map(String.init) == ["a", "c", "d", "f", "g"])
            #expect(SourceScan.macOSRegions(of: text).split(separator: "\n").map(String.init) == ["a", "c"])
        }

        @Test func scanCatchesAStyleWithAModifier() {
            #expect(Self.offenders(in: ".font(.body.weight(.semibold))").count == 1)
            #expect(Self.offenders(in: ".font(MacStyle.body)").isEmpty)
        }

        @Test func previewsEndWhereTheirBracesClose() {
            let text = """
                a
                #Preview("Brace { in a title")
                {
                    /* } */
                    Text("}")
                }
                b
                """
            #expect(SourceScan.withoutPreviews(text).split(separator: "\n").map(String.init) == ["a", "b"])
        }

        @Test func regionsFollowElseAndNesting() {
            let text = """
                a
                #if os(macOS)
                b
                #else
                c
                #endif
                #if os(iOS)
                d
                #else
                e
                #if DEBUG
                f
                #endif
                #endif
                #if os(iOS)
                g
                #elseif os(macOS)
                h
                #endif
                """
            #expect(SourceScan.macOSRegions(of: text).split(separator: "\n").map(String.init) == ["b", "e", "f", "h"])
            #expect(SourceScan.macCompiled(text).split(separator: "\n").map(String.init).contains("c") == false)
        }
    }
#endif
