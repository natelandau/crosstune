#if os(macOS)
    import Foundation
    import Testing

    @testable import CrosstuneUI

    @Suite struct MacInkTests {
        /// Lines whose hierarchical style is proven to hold 4.5:1 where it draws, by file. Empty:
        /// a new entry names the ground it sits on and why `inkSecondary` cannot stand in.
        static let allowed: [String: [String]] = [:]

        /// A hierarchical style as a foreground: `.foregroundStyle(.secondary)`, one in a
        /// ternary, `Color.secondary`, or `.foregroundColor(.tertiary)`. AppKit resolves these
        /// as a translucent gray that falls under 4.5:1 on the Mac's surface and field fills.
        private static var hierarchical: Regex<(Substring, Substring, Substring)> {
            /(\.foreground(?:Style|Color)\((?:[^\n]*[^A-Za-z0-9_])?\.|\bColor\.)(secondary|tertiary|quaternary)\b/
                .wordBoundaryKind(.simple)
        }

        static func offenders(in text: String) -> [String] {
            SourceScan.withoutComments(text).split(separator: "\n")
                .filter { $0.contains(hierarchical) }
                .map { $0.trimmingCharacters(in: .whitespaces) }
        }

        @Test func macCompiledCodeDrawsNoHierarchicalInk() throws {
            var found: [String] = []
            for file in SourceScan.files() {
                let name = SourceScan.relative(file)
                guard let drawn = try MacTypeTests.macDrawn(file) else { continue }
                let allowed = Self.allowed[name] ?? []
                found += Self.offenders(in: drawn).filter { !allowed.contains($0) }.map { "\(name) \($0)" }
            }
            #expect(found.isEmpty, "\(found.count) lines:\n\(found.joined(separator: "\n"))")
        }

        @Test func scanCatchesEachSpelling() {
            #expect(Self.offenders(in: ".foregroundStyle(.secondary)").count == 1)
            #expect(Self.offenders(in: ".foregroundStyle(.secondary.opacity(0.5))").count == 1)
            #expect(Self.offenders(in: ".foregroundStyle(isOn ? .primary : .tertiary)").count == 1)
            #expect(Self.offenders(in: "let c = Color.secondary").count == 1)
            #expect(Self.offenders(in: ".foregroundStyle(MacPalette.inkSecondary)").isEmpty)
            #expect(Self.offenders(in: ".font(MacStyle.secondary)").isEmpty)
        }
    }
#endif
