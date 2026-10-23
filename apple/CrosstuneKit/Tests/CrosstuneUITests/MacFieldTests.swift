#if os(macOS)
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @Suite struct MacFieldTests {
        /// The Mac-compiled text of every file the Mac draws, by its path.
        private static func macDrawn() throws -> [(name: String, text: String)] {
            try SourceScan.files().compactMap { file in
                guard let drawn = try MacTypeTests.macDrawn(file) else { return nil }
                return (SourceScan.relative(file), SourceScan.withoutComments(drawn))
            }
        }

        /// The first SwiftUI `TextField(` on `line`, never AppKit's `NSTextField(`.
        private static func swiftUITextField(in line: String) -> Range<String.Index>? {
            line.ranges(of: "TextField(").first { range in
                range.lowerBound == line.startIndex || !line[line.index(before: range.lowerBound)].isLetter
            }
        }

        /// Each `TextField(` call in `text` with the modifier chain that follows it: the call's
        /// own parentheses, then every following line that starts with a `.`.
        static func textFieldChains(in text: String) -> [String] {
            let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            var chains: [String] = []
            var index = 0
            while index < lines.count {
                guard let start = swiftUITextField(in: lines[index]) else {
                    index += 1
                    continue
                }
                var chain = String(lines[index][start.lowerBound...])
                var depth = chain.count { $0 == "(" } - chain.count { $0 == ")" }
                var next = index + 1
                while depth > 0, next < lines.count {
                    chain += "\n" + lines[next]
                    depth += lines[next].count { $0 == "(" } - lines[next].count { $0 == ")" }
                    next += 1
                }
                // A removed comment leaves a blank line inside a chain, so blanks are skipped.
                var ahead = next
                while ahead < lines.count {
                    let trimmed = lines[ahead].trimmingCharacters(in: .whitespaces)
                    if trimmed.isEmpty {
                        ahead += 1
                        continue
                    }
                    guard trimmed.hasPrefix(".") else { break }
                    chain += "\n" + lines[ahead]
                    ahead += 1
                    next = ahead
                }
                chains.append(chain)
                index = next
            }
            return chains
        }

        /// Mac text fields that keep their own label on purpose, each checked against its use.
        static let labeledFields: [String] = []

        /// A Mac grouped form draws a text field's title beside the field and beside any
        /// `LabeledContent` around it, so a field there reads "Violin | Violin tuning". Every
        /// Mac text field hides its label or draws plain, where no title shows.
        @Test func noMacFieldDrawsItsOwnLabelBesideALabeledContent() throws {
            var found: [String] = []
            for (name, text) in try Self.macDrawn() where !Self.labeledFields.contains(name) {
                for chain in Self.textFieldChains(in: text)
                where !chain.contains(".labelsHidden()") && !chain.contains(".textFieldStyle(.plain)") {
                    found.append("\(name): \(chain.split(separator: "\n").first ?? "")")
                }
            }
            #expect(found.isEmpty, "\(found.joined(separator: "\n"))")
        }

        @Test func labeledFieldsListNamesFieldsThatKeepALabel() throws {
            let drawn = try Self.macDrawn()
            for name in Self.labeledFields {
                let text = try #require(drawn.first { $0.name == name }?.text, "\(name)")
                #expect(Self.textFieldChains(in: text).contains { !$0.contains(".labelsHidden()") }, "\(name)")
            }
        }

        @Test func textFieldChainsFollowModifiersAndArguments() {
            let text = """
                TextField(
                    "A", text: $a)
                    .contentMask()

                    .labelsHidden()
                Text("b")
                NSTextField(wrappingLabelWithString: "")
                TextField("C", text: $c)
                """
            let chains = Self.textFieldChains(in: text)
            #expect(chains.count == 2)
            #expect(chains[0].contains(".labelsHidden()"))
            #expect(!chains[1].contains(".labelsHidden()"))
        }

        /// The system search field draws apart from the app's own, so a Mac sheet searches with
        /// ``FilterSearchField``.
        @Test func noSearchableInMacSheets() throws {
            let found = try Self.macDrawn().filter { $0.text.contains(".searchable(") }.map(\.name)
            #expect(found.isEmpty, "\(found.joined(separator: "\n"))")
        }

        /// The search field fills the bar up to the column's constant trailing slot, whether one
        /// control, two, or a selection's five sit beside it, so it never resizes.
        @Test func searchFieldWidthDoesNotDependOnTrailingControls() {
            let width: CGFloat = 640
            let slot = PaneBarLayout.slotWidth(icons: 2)
            let one = PaneBarLayout.leadingRoom(width: width, slot: slot, trailing: 36, count: 1)
            let two = PaneBarLayout.leadingRoom(width: width, slot: slot, trailing: slot, count: 1)
            let five = PaneBarLayout.leadingRoom(
                width: width, slot: slot, trailing: 5 * 36 + 4 * PaneBarLayout.spacing, count: 1)
            let none = PaneBarLayout.leadingRoom(width: width, slot: slot, trailing: 0, count: 1)
            #expect(one.sharesLine && two.sharesLine && none.sharesLine)
            #expect(one.each == two.each && one.each == five.each && one.each == none.each)
            #expect(one.each == width - slot - PaneBarLayout.spacing)
        }

        /// The slot is the width of its glyph controls, so the field ends one gap before them.
        @Test func slotIsItsGlyphControlsWide() {
            #expect(PaneBarLayout.slotWidth(icons: 1) == MacStyle.paneIconWidth)
            #expect(PaneBarLayout.slotWidth(icons: 2) == 2 * MacStyle.paneIconWidth + PaneBarLayout.spacing)
        }

        /// Controls wider than the slot take a line of their own, and the search field keeps its
        /// width over them.
        @Test func searchFieldKeepsItsWidthOverControlsThatWrap() {
            let width: CGFloat = 300
            let slot = PaneBarLayout.slotWidth(icons: 2)
            let wide = PaneBarLayout.leadingRoom(width: width, slot: slot, trailing: 260, count: 1)
            #expect(!wide.sharesLine)
            #expect(wide.each == width - slot - PaneBarLayout.spacing)
        }

        /// Too narrow a bar for the field beside its slot: the field takes the bar whole.
        @Test func narrowBarGivesTheFieldTheWholeWidth() {
            let width: CGFloat = 200
            let room = PaneBarLayout.leadingRoom(
                width: width, slot: PaneBarLayout.slotWidth(icons: 2), trailing: 36, count: 1)
            #expect(room.each == width)
            #expect(!room.sharesLine)
        }

        /// The filters control at rest is a glyph in secondary ink; set, it is a set chip whose
        /// count reads on the field it sits in.
        @Test(arguments: [ColorScheme.light, .dark])
        func searchFiltersCountReadsOnTheField(scheme: ColorScheme) {
            let field = Palette.hex(.field, scheme)
            let wash = MacChip.setWashHex(over: Palette.hex(SearchFiltersStyle.chipGround, scheme), scheme: scheme)
            let label = MacChip.labelRGB(state: .set, scheme: scheme).hex
            #expect(contrastRatio(label, wash) >= 4.5)
            #expect(contrastRatio(Palette.hex(.inkSecondary, scheme), field) >= 3)
        }

        @Test(arguments: [ColorScheme.light, .dark])
        func popUpValuePassesContrastOnEveryGround(scheme: ColorScheme) {
            for isSet in [false, true] {
                let value = MacPopUpStyle.valueRGB(isSet: isSet, scheme: scheme).hex
                for ground in [Palette.Token.ground, .surface, .field, .raised] {
                    #expect(contrastRatio(value, Palette.hex(ground, scheme)) >= 4.5, "set \(isSet) on \(ground)")
                }
            }
        }

        @Test(arguments: [ColorScheme.light, .dark])
        func popUpValueTakesTheAccentOnlyWhenSet(scheme: ColorScheme) {
            #expect(
                MacPopUpStyle.valueRGB(isSet: true, scheme: scheme).hex == Palette.hex(.accent, scheme).lowercased())
            #expect(
                MacPopUpStyle.valueRGB(isSet: false, scheme: scheme).hex
                    == Palette.hex(.inkSecondary, scheme).lowercased())
        }

        /// The ring is a non-text indicator, so it holds 3:1 against the fill it rings and the
        /// ground around it, which only the full accent does.
        @Test(arguments: [ColorScheme.light, .dark])
        func focusRingIsTheFullAccent(scheme: ColorScheme) {
            let ring = MacFieldStyle.focusRingRGB(scheme).hex
            #expect(ring == Palette.hex(.accent, scheme).lowercased())
            for ground in [Palette.Token.ground, .surface, .field, .raised] {
                #expect(contrastRatio(ring, Palette.hex(ground, scheme)) >= 3, "\(ground)")
            }
            #expect(MacFieldStyle.focusRingWidth == 2)
        }

        /// A field's text and prompt read on the fill it takes in each container, and the fill
        /// stands off the container: on `surface` it is lighter, never the gray `field`.
        @Test(arguments: [ColorScheme.light, .dark])
        func fieldsReadOnEveryContainer(scheme: ColorScheme) {
            for container in MacContainer.allCases {
                let fill = Palette.hex(container.controlFill, scheme)
                #expect(contrastRatio(Palette.hex(.ink, scheme), fill) >= 4.5, "text in \(container)")
                #expect(contrastRatio(Palette.hex(.inkSecondary, scheme), fill) >= 4.5, "prompt in \(container)")
                #expect(fill != Palette.hex(container.fill, scheme))
            }
            #expect(MacContainer.surface.controlFill != .field)
            #expect(
                relativeLuminance(Palette.hex(MacContainer.surface.controlFill, scheme))
                    > relativeLuminance(Palette.hex(.surface, scheme)))
        }

        /// Fields, pop-ups, and the search field take their fill from the container, never a
        /// fixed `field`, so none reads gray on a card.
        @Test func controlsTakeTheirFillFromTheContainer() throws {
            for name in ["Mac/MacFieldStyle.swift", "Mac/MacButtonStyle.swift", "Components/FilterSearchField.swift"] {
                let text = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.sources.appending(path: name)))
                #expect(!text.contains("Palette.field"), "\(name)")
                #expect(text.contains("@Environment(\\.macContainer)"), "\(name)")
                #expect(text.contains(".macControlEdge("), "\(name)")
            }
        }

        /// Every surface card and footer marks itself, so the controls in it take the raised fill.
        @Test func surfaceCardsMarkTheirContainer() throws {
            for name in ["Mac/MacForm.swift", "Mac/MacSheet.swift", "Plan/PlanComparison.swift"] {
                let text = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.sources.appending(path: name)))
                #expect(text.contains(".macSurfaceContainer()"), "\(name)")
            }
        }

        @Test func searchFieldDrawsNoGlass() throws {
            let file = try #require(SourceScan.files().first { $0.lastPathComponent == "FilterSearchField.swift" })
            let text = SourceScan.withoutComments(try SourceScan.text(at: file))
            #expect(!text.contains("macGlass"))
            #expect(!text.contains("glassEffect"))
            #expect(text.contains("container.controlColor"))
        }
    }
#endif
