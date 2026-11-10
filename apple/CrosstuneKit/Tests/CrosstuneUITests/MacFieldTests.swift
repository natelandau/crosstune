#if os(macOS)
    import CrosstuneDesign
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    struct MacFieldTests {
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
        /// Mac text field hides its label or draws plain, as the title field does, where no title
        /// shows.
        @Test func noMacFieldDrawsItsOwnLabelBesideALabeledContent() throws {
            let plain = [".labelsHidden()", ".textFieldStyle(.plain)", ".textFieldStyle(.macTitleField"]
            var found: [String] = []
            for (name, text) in try Self.macDrawn() where !Self.labeledFields.contains(name) {
                for chain in Self.textFieldChains(in: text) where !plain.contains(where: chain.contains) {
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
            #expect(chains[1].contains(".labelsHidden()") == false)
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
            #expect(wide.sharesLine == false)
            #expect(wide.each == width - slot - PaneBarLayout.spacing)
        }

        /// Too narrow a bar for the field beside its slot: the field takes the bar whole.
        @Test func narrowBarGivesTheFieldTheWholeWidth() {
            let width: CGFloat = 200
            let room = PaneBarLayout.leadingRoom(
                width: width, slot: PaneBarLayout.slotWidth(icons: 2), trailing: 36, count: 1)
            #expect(room.each == width)
            #expect(room.sharesLine == false)
        }

        /// The filters control at rest is a glyph in secondary text; set, it is a set chip whose
        /// count reads on the field it sits in.
        @Test(arguments: [ColorScheme.light, .dark])
        func searchFiltersCountReadsOnTheField(scheme: ColorScheme) {
            let field = Palette.hex(.field, scheme)
            let label = MacChip.labelRGB(state: .set, scheme: scheme).hex
            for press in [MacPressState.rest, .hover, .pressed] {
                let tint = MacChip.setTintHex(
                    over: Palette.hex(SearchFiltersStyle.chipBackground, scheme), scheme: scheme, press: press)
                #expect(contrastRatio(label, tint) >= 4.5, "\(press)")
            }
            #expect(contrastRatio(Palette.hex(.textSecondary, scheme), field) >= 3)
        }

        @Test(arguments: [ColorScheme.light, .dark], [false, true])
        func popUpValuePassesContrastOnEveryBackground(scheme: ColorScheme, isSet: Bool) {
            let value = MacPopUpStyle.valueRGB(isSet: isSet, scheme: scheme).hex
            for background in [Palette.Token.pageBackground, .surface, .field, .surfaceRaised] {
                #expect(contrastRatio(value, Palette.hex(background, scheme)) >= 4.5, "\(background)")
            }
        }

        /// An invalid field rings in danger whether or not it is focused; a valid one rings in the
        /// accent only while it shows focus.
        @Test(arguments: [
            (true, false, Palette.Token?.some(.danger)), (true, true, .danger), (false, true, .accent),
            (false, false, nil),
        ])
        func anInvalidFieldRingsInDanger(isInvalid: Bool, isFocused: Bool, ring: Palette.Token?) {
            #expect(MacFieldStyle.ringToken(isInvalid: isInvalid, isFocused: isFocused) == ring)
        }

        /// The ring is a non-text indicator, so it holds 3:1 against the fill it rings and the
        /// background around it.
        @Test(arguments: [ColorScheme.light, .dark])
        func focusRingPassesContrast(scheme: ColorScheme) {
            let ring = Palette.rgb(MacControl.focusRingToken, scheme).hex
            for background in [Palette.Token.pageBackground, .surface, .field, .surfaceRaised] {
                #expect(contrastRatio(ring, Palette.hex(background, scheme)) >= 3, "\(background)")
            }
        }

        /// A field's text and prompt read on the fill it takes in each container, and the fill
        /// differs from the container.
        @Test(arguments: [ColorScheme.light, .dark])
        func fieldsReadOnEveryContainer(scheme: ColorScheme) {
            for container in MacContainer.allCases {
                let fill = Palette.hex(container.controlFill, scheme)
                #expect(contrastRatio(Palette.hex(.textPrimary, scheme), fill) >= 4.5, "text in \(container)")
                #expect(contrastRatio(Palette.hex(.textSecondary, scheme), fill) >= 4.5, "prompt in \(container)")
                #expect(fill != Palette.hex(container.fill, scheme))
            }
        }

        /// Fields, pop-ups, segmented tracks, chips, steppers, and the search field take their
        /// fill from the container, never a fixed `field`, so none reads gray on a card. A
        /// stepper half shows hover and press.
        @Test func controlsTakeTheirFillFromTheContainer() throws {
            for name in [
                "Mac/MacFieldStyle.swift", "Mac/MacPopUp.swift", "Mac/MacButtonStyle.swift", "Mac/MacSegmented.swift",
                "Mac/MacChip.swift",
                "Mac/MacStepper.swift", "Mac/MacRowStyle.swift", "Components/FilterSearchField.swift",
            ] {
                let text = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: name)))
                #expect(text.contains("Palette.field") == false, "\(name)")
                #expect(text.contains("@Environment(\\.macContainer)"), "\(name)")
                #expect(text.contains(".macControlEdge("), "\(name)")
            }
            let stepper = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Mac/MacStepper.swift")))
            #expect(stepper.contains("MacPressState"))
        }

        /// Every surface card and footer marks itself, so the controls in it take the raised fill.
        @Test func surfaceCardsMarkTheirContainer() throws {
            for name in ["Mac/MacForm.swift", "Mac/MacActionBar.swift", "Plan/PlanComparison.swift"] {
                let text = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: name)))
                #expect(text.contains(".macSurfaceContainer()"), "\(name)")
            }
        }

        @Test func searchFieldTakesItsContainersFill() throws {
            let file = try #require(SourceScan.files().first { $0.lastPathComponent == "FilterSearchField.swift" })
            let text = SourceScan.withoutComments(try SourceScan.text(at: file))
            #expect(text.contains("container.controlColor"))
        }
    }
#endif
