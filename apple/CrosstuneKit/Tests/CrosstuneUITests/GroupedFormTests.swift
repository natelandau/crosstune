import CrosstuneDesign
import Foundation
import SwiftUI
import Testing

@Suite struct GroupedFormTests {
    /// A row's own background (the iPad's open Settings page draws `field`) must win over the
    /// card's. Rebuilding the form's sections drops a row's own list modifiers, so `GroupedForm`
    /// keeps its sections as written.
    @Test func groupedFormKeepsItsSectionsAsWritten() throws {
        let code = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "Style/PaletteStyles.swift")))
        #expect(!code.contains("ForEach(sections:"))
        #expect(!code.contains("Group(sections:"))
        #expect(code.contains("Group { content }"))
    }

    /// On the page background a row the list does not select passes `Color.clear`: `nil` there falls
    /// back to the system cell color, a seam against the filter band. `nil` is allowed only as
    /// the selected branch of a ternary (`isSelected ? nil : ...`), so a selected row keeps the
    /// system's selection fill.
    @Test func noRowBackgroundFallsBackToNilWhenUnselected() throws {
        var violations: [String] = []
        for file in SourceScan.files() {
            let code = SourceScan.iOSCompiled(
                SourceScan.withoutPreviews(SourceScan.withoutComments(try SourceScan.text(at: file))))
            var from = code.startIndex
            while let found = code.range(of: "listRowBackground(", range: from..<code.endIndex) {
                let open = code.index(before: found.upperBound)
                let span = SourceScan.call(in: code, opening: open)
                if Self.unselectedBranchIsNil(span) {
                    violations.append("\(SourceScan.relative(file)): \(span.prefix(80))")
                }
                from = found.upperBound
            }
        }
        #expect(violations.isEmpty, "listRowBackground falls back to nil for an unselected row: \(violations)")
    }

    @Test func theNilCheckFlagsEveryNilButTheSelectedBranch() {
        #expect(Self.unselectedBranchIsNil("listRowBackground(\n    nil\n)"))
        #expect(Self.unselectedBranchIsNil("listRowBackground(isCurrent ? tint : nil)"))
        #expect(Self.unselectedBranchIsNil("listRowBackground(\n  isCurrent\n  ? tint\n  : nil\n)"))
        #expect(Self.unselectedBranchIsNil("listRowBackground(row ?? nil)"))
        #expect(Self.unselectedBranchIsNil("listRowBackground(\n  row\n  ??\n  nil\n)"))
        #expect(!Self.unselectedBranchIsNil("listRowBackground(isSelected ? nil : Color.clear)"))
        #expect(!Self.unselectedBranchIsNil("listRowBackground(\n  isSelected\n  ? nil\n  : AnyView(tint)\n)"))
        #expect(!Self.unselectedBranchIsNil("listRowBackground(Palette.groupedSurface)"))
        #expect(!Self.unselectedBranchIsNil("listRowBackground(nilFill)"))
    }

    /// The shared modifier clears an unselected row and leaves a selected one to the system,
    /// and the screens whose rows the list can select apply it.
    @Test func selectableRowsClearTheirBackgroundOnlyWhenUnselected() throws {
        let tuneRow = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "Components/TuneRow.swift")))
        let start = try #require(tuneRow.range(of: "func unselectedRowBackground("))
        let rest = tuneRow[start.lowerBound...]
        let end = try #require(rest.range(of: "\n    }\n"))
        #expect(rest[..<end.upperBound].contains("listRowBackground(isSelected ? nil : Color.clear)"))
        for screen in ["Catalog/CatalogScreen.swift", "Recordings/RecordingsScreen.swift"] {
            let code = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: screen)))
            #expect(code.contains(".unselectedRowBackground("), "\(screen) rows clear their background")
        }
    }

    /// A selection form's chosen row draws its title, value, and icon in white on the accent
    /// selection, at the same contrast in both appearances.
    @Test(arguments: [ColorScheme.light, .dark])
    func chosenSelectionRowTextPassesContrastOnItsFill(scheme: ColorScheme) throws {
        let fill = GroupedSelectionRowColors.background(isSelected: true)
        #expect(contrastRatio(Palette.hex(.onAccentFill, scheme), Palette.hex(fill, scheme)) >= 4.5)
        var environment = EnvironmentValues()
        environment.colorScheme = scheme
        environment.backgroundProminence = .increased
        for level in [SelectionAwareColor(Palette.textPrimary), SelectionAwareColor(Palette.textTertiary)] {
            #expect(level.resolve(in: environment) == Palette.onAccentFill)
        }
        #expect(SecondaryText.token(in: environment) == .onAccentFill)
    }

    /// The chosen row sets every hierarchical level and raises the background prominence, so a
    /// value in the system's secondary or in `.textSecondary` turns white with the title. One
    /// branch draws both states, so choosing a row never rebuilds it.
    @Test func chosenSelectionRowOverridesEveryForegroundLevel() throws {
        let code = SourceScan.iOSCompiled(
            SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Phone/Controls/GroupedSelectionForm.swift"))))
        #expect(code.contains(".groupedRowText()"))
        let styles = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "Phone/Controls/GroupedSelectionForm.swift")))
        #expect(styles.contains("foregroundStyle(.textPrimary, .textSecondary, .textTertiary)"))
        #expect(code.contains(".environment(\\.backgroundProminence, isSelected ? .increased : .standard)"))
    }

    /// A fixed color keeps its value at rest and turns white on an emphasized selection.
    @Test func selectionAwareColorTurnsWhiteOnlyOnAnEmphasizedSelection() {
        var environment = EnvironmentValues()
        environment.backgroundProminence = .standard
        #expect(SelectionAwareColor(.red).resolve(in: environment) == .red)
        environment.backgroundProminence = .increased
        #expect(SelectionAwareColor(.red).resolve(in: environment) == Palette.onAccentFill)
    }

    /// The Settings root's rows that a selection can fill draw their fixed colors through
    /// `selectionAware`: the account row's sync line and the stats card's status bar.
    @Test func settingsRootFixedColorsTurnWhiteOnTheSelection() throws {
        let root = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "Phone/SettingsRoot.swift")))
        #expect(root.contains(".foregroundStyle(.selectionAware(Palette.color(SyncBadge.tone(attention))))"))
        let bar = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "Phone/StatusBar.swift")))
        #expect(bar.contains(".fill(.selectionAware(Self.color(segment.status)))"))
    }

    /// Whether a `listRowBackground(...)` call, as written across its lines, passes `nil` for the
    /// unselected row: any `nil` word not directly after the `?` of a ternary. A nil-coalescing
    /// `?? nil` counts as a fallback, not a selected branch.
    private static func unselectedBranchIsNil(_ span: some StringProtocol) -> Bool {
        let call = Array(span.filter { !$0.isWhitespace })
        func isWord(_ char: Character) -> Bool { char.isLetter || char.isNumber || char == "_" }
        for start in call.indices where call[start...].starts(with: "nil") {
            let end = start + 3
            if start > 0, isWord(call[start - 1]) { continue }
            if end < call.count, isWord(call[end]) { continue }
            let afterTernary = start > 0 && call[start - 1] == "?" && (start < 2 || call[start - 2] != "?")
            if afterTernary { continue }
            return true
        }
        return false
    }
}
