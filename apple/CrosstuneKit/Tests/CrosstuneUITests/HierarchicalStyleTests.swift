#if os(macOS)
    import Foundation
    import Testing

    @testable import CrosstuneUI

    @Suite struct HierarchicalStyleTests {
        /// Lines whose hierarchical style is proven to hold where it draws, by file. Each entry
        /// covers one line, so a second line with the same text still fails. A new entry names the
        /// background it sits on and why `textSecondary` cannot replace it.
        static let allowed: [String: [String]] = [
            // Drawn only on the practice background, a dark background where the system's
            // hierarchical styles resolve against the dark scheme and hold contrast.
            "RecordingScreen/Practice/PracticeWaveform.swift": [
                "return .style(.tertiary)",
                "return .style(.secondary)",
            ],
            // The audio a trim cuts away is faded back on purpose, so it stays quieter than the primary text color.
            "RecordingScreen/TrimScreen.swift": ["context.fill(cut, with: .style(.quaternary))"],
        ]

        /// A hierarchical style as a foreground: `.foregroundStyle(.secondary)`, one in a
        /// ternary, a canvas `.style(.tertiary)`, `Color.secondary`, or `.foregroundColor(.tertiary)`.
        /// AppKit resolves these as a translucent gray that falls under 4.5:1 on the Mac's surface
        /// and field fills, and UIKit's falls under it on the page background.
        private static var foreground: Regex<(Substring, Substring, Substring)> {
            /(\.(?:foreground(?:Style|Color)|style)\((?:[^\n]*[^A-Za-z0-9_])?\.|\bColor\.)(secondary|tertiary|quaternary)\b/
                .wordBoundaryKind(.simple)
        }

        /// A secondary or tertiary style handed on as a value: `AnyShapeStyle(.secondary)`, a
        /// switch case or `default:` that yields one, or `return .tertiary`.
        private static var handedOn: Regex<(Substring, Substring)> {
            /(?:\bAnyShapeStyle\(|\b(?:case\b[^\n]*|default):\s*|\breturn\s+)\.(secondary|tertiary)\b/
                .wordBoundaryKind(.simple)
        }

        static func violations(in text: String) -> [String] {
            SourceScan.withoutComments(text).split(separator: "\n")
                .filter { $0.contains(foreground) || $0.contains(handedOn) }
                .map { $0.trimmingCharacters(in: .whitespaces) }
        }

        /// `found` less one line for each allowed entry, and the entries no line used.
        static func unallowed(_ found: [String], allowed: [String]) -> (lines: [String], unused: [String]) {
            var lines = found
            var unused: [String] = []
            for entry in allowed {
                if let index = lines.firstIndex(of: entry) {
                    lines.remove(at: index)
                } else {
                    unused.append(entry)
                }
            }
            return (lines, unused)
        }

        @Test func compiledCodeDrawsNoHierarchicalStyle() throws {
            var found: [String] = []
            var stale: [String] = []
            for file in SourceScan.files() {
                let name = SourceScan.relative(file)
                let text = try SourceScan.text(at: file)
                let (lines, unused) = Self.unallowed(Self.violations(in: text), allowed: Self.allowed[name] ?? [])
                found += lines.map { "\(name) \($0)" }
                stale += unused.map { "\(name) \($0)" }
            }
            #expect(found.isEmpty, "\(found.count) lines:\n\(found.joined(separator: "\n"))")
            #expect(stale.isEmpty, "allowed lines no longer in the source:\n\(stale.joined(separator: "\n"))")
        }

        @Test func scanCatchesEachSpelling() {
            #expect(Self.violations(in: ".foregroundStyle(.secondary)").count == 1)
            #expect(Self.violations(in: ".foregroundStyle(.secondary.opacity(0.5))").count == 1)
            #expect(Self.violations(in: ".foregroundStyle(isOn ? .primary : .tertiary)").count == 1)
            #expect(Self.violations(in: "context.fill(path, with: .style(.secondary))").count == 1)
            #expect(Self.violations(in: "context.fill(path, with: .style(.tertiary))").count == 1)
            #expect(Self.violations(in: "let c = Color.secondary").count == 1)
            #expect(Self.violations(in: "let c = AnyShapeStyle(.secondary)").count == 1)
            #expect(Self.violations(in: "let c = premium ? primary : AnyShapeStyle(.tertiary)").count == 1)
            #expect(Self.violations(in: "case .ring: .secondary").count == 1)
            #expect(Self.violations(in: "case .ring: .secondary.opacity(0.4)").count == 1)
            #expect(Self.violations(in: "case .a, .b: .tertiary").count == 1)
            #expect(Self.violations(in: "default: .tertiary").count == 1)
            #expect(Self.violations(in: "return .secondary").count == 1)
            #expect(Self.violations(in: "if off { return .tertiary }").count == 1)
            #expect(Self.violations(in: "case .secondary, .destructive: control").isEmpty)
            #expect(Self.violations(in: "case .caption: self = .secondary").isEmpty)
            #expect(Self.violations(in: "AnyShapeStyle(.quaternary)").isEmpty)
            #expect(Self.violations(in: ".foregroundStyle(Palette.textSecondary)").isEmpty)
            #expect(Self.violations(in: ".font(MacStyle.secondary)").isEmpty)
        }
    }
#endif
