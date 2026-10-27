#if os(macOS)
    import Foundation
    import Testing

    @testable import CrosstuneUI

    /// Every color outside `Style/` is a `Palette` role, so a retheme changes `Style/` and nothing
    /// else, and a contrast test there covers every color a view draws.
    @Suite struct PaletteRoleTests {
        /// Files that draw their own colors on purpose, with the reason.
        static let exemptFiles: [String: String] = [
            "Welcome/WelcomeIllustration.swift": "The welcome illustrations draw their own art.",
            "Welcome/WelcomeSlides.swift": "The welcome slides draw their own art.",
        ]

        /// Lines that draw their own colors on purpose, by file. Each entry covers one line, so a
        /// second line with the same text still fails.
        static let allowed: [String: [String]] = [
            // Sign in with Apple's button is black on white: Apple's rules fix its colors.
            "Welcome/WelcomeView.swift": [
                ".foregroundStyle(Color.black)",
                ".background(Color.white, in: .rect(cornerRadius: Self.radius))",
                "RoundedRectangle(cornerRadius: Self.radius).strokeBorder(Color.black)",
            ],
            // Inverted scans render the scan itself, white on black, not the interface.
            "Scans/ScanViewer.swift": [
                ".background(invert ? Color.black : Color.white)",
                ".foregroundStyle(invert ? Color.white : Palette.textPrimary)",
            ],
        ]

        private static let systemColors =
            "red|orange|yellow|green|mint|teal|cyan|blue|indigo|purple|pink|brown|gray|grey|white|black"
        private static let systemStyles = "primary|secondary|tertiary|quaternary|quinary|separator|" + systemColors

        /// A color written in place rather than named as a role.
        private static var oneOffs: [Regex<AnyRegexOutput>] {
            [
                // A color literal.
                try! Regex(#"\bColor\((red|white|hue|\.sRGB|\.displayP3|nsColor|uiColor|")"#),
                // A system color by name.
                try! Regex(#"\bColor\.(\#(systemStyles)|accentColor)\b"#),
                try! Regex(#"\b(NSColor|UIColor)\.(?!init\b)[a-z]\w*"#),
                // A system color or style handed to anything that draws one.
                try! Regex(
                    #"\b(foregroundStyle|foregroundColor|fill|stroke|strokeBorder|background|tint|style|shadow|"#
                        + #"listRowBackground|border|overlay|AnyShapeStyle|color|containerBackground|"#
                        + #"backgroundStyle|stackBackground|glassEffect)\((?:[^\n]*[^\w.])?\.(\#(systemStyles))\b"#),
                // A system color handed on as a value: `case .a: .red`, `return .orange`, `on ? .white : x`.
                try! Regex(#"[?:]\s*\.(\#(systemColors))\b|\breturn\s+\.(\#(systemColors))\b"#),
                // A system fill style.
                try! Regex(#"\.fill\.(primary|secondary|tertiary|quaternary|quinary)\b"#),
                // A color made translucent where it is drawn, not in `Style/`.
                try! Regex(
                    #"(\bPalette\.\w+(\([^()]*\))?|\bColor\.\w+|\b[a-z]\w*Color|\bcolor|\btint)\.opacity\("#
                        + #"|(?:^|[^\w.])\.(white|black|tint|primary|secondary)\.opacity\("#),
                // A hex value.
                try! Regex(##""#[0-9A-Fa-f]{6}""##),
                // A primitive, which only the roles in `Style/` name.
                try! Regex(#"\bPrimitive\."#),
            ]
        }

        static func violations(in text: String) -> [String] {
            let patterns = oneOffs
            return SourceScan.withoutComments(text).split(separator: "\n")
                .filter { line in patterns.contains { line.contains($0) } }
                .map { $0.trimmingCharacters(in: .whitespaces) }
        }

        @Test func componentCodeNamesOnlyPaletteRoles() throws {
            var found: [String] = []
            var stale: [String] = []
            for file in SourceScan.files() {
                let name = SourceScan.relative(file)
                if name.hasPrefix("Style/") || Self.exemptFiles[name] != nil { continue }
                var lines = Self.violations(in: try SourceScan.text(at: file))
                for entry in Self.allowed[name] ?? [] {
                    if let index = lines.firstIndex(of: entry) {
                        lines.remove(at: index)
                    } else {
                        stale.append("\(name) \(entry)")
                    }
                }
                found += lines.map { "\(name) \($0)" }
            }
            #expect(found.isEmpty, "\(found.count) lines:\n\(found.joined(separator: "\n"))")
            #expect(stale.isEmpty, "allowed lines no longer in the source:\n\(stale.joined(separator: "\n"))")
        }

        @Test func exemptFilesStillExist() {
            let names = Set(SourceScan.files().map(SourceScan.relative))
            for name in Self.exemptFiles.keys {
                #expect(names.contains(name), "\(name)")
            }
        }

        @Test func scanCatchesEachSpelling() {
            for line in [
                ".foregroundStyle(.red)",
                ".foregroundStyle(isOn ? .primary : .secondary)",
                "Text(failure).foregroundStyle(.red)",
                ".tint(.gray)",
                ".fill(.quaternary)",
                "AnyShapeStyle(.separator)",
                ".background(.fill.tertiary, in: .capsule)",
                "let c = Color.black",
                "Color(.sRGB, red: 1, green: 0, blue: 0)",
                "Color(red: 1, green: 0, blue: 0)",
                ".foregroundColor: UIColor.label,",
                ".overlay { Color.black.opacity(0.06) }",
                ".fill(Palette.accent.opacity(0.12))",
                ".fill(Palette.tint(scheme).opacity(0.5))",
                ".shadow(color: .black.opacity(0.18), radius: 8)",
                "Capsule().fill(.white.opacity(0.9))",
                "with: .color(loop.id == selectedID ? tint : tint.opacity(0.5)))",
                "case .pin: .indigo",
                "return .orange",
                "isTrim ? .white : Palette.brand",
                "let hex = \"#33373D\"",
                "Primitive.white",
            ] {
                #expect(Self.violations(in: line).count == 1, "\(line)")
            }
            for line in [
                ".foregroundStyle(Palette.danger)",
                ".opacity(isShown ? 1 : 0)",
                "configuration.label.opacity(configuration.isPressed ? 0.6 : 1)",
                "RoundedRectangle(cornerRadius: 10).fill(Palette.tint(scheme)).opacity(isHighlighted ? 1 : 0)",
                ".font(MacStyle.secondary)",
                "case .secondary, .destructive: control",
                ".buttonStyle(.mac(.secondary))",
                ".background(Color.clear)",
                "let color = Color(StatusGlyphStyle(status: status).resolve(in: environment))",
            ] {
                #expect(Self.violations(in: line).isEmpty, "\(line)")
            }
        }
    }
#endif
