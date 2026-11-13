import SwiftUI

/// Selection mode on a screen of tune rows: whether it is on, and which rows are in it, by the
/// id each row is tagged with. Only visible tunes are ever selected, so an action never reaches
/// a tune the musician cannot see.
public struct TuneSelection: Equatable, Sendable {
    public static let selectAll = "Select All"
    public static let deselectAll = "Deselect All"
    /// The Mac selection bar's words, in the app's sentence case.
    public static let selectAllItem = "Select all"
    public static let deselectAllItem = "Deselect all"
    public static let done = "Done"
    /// The Mac selection bar's one menu of bulk actions.
    public static let actions = "Actions"

    public private(set) var isActive = false
    public private(set) var ids: Set<String> = []
    /// The row the mode was last entered from, which VoiceOver returns to when it ends. Kept
    /// after the mode ends, for that return.
    public private(set) var origin: String?
    /// The row a Shift-click selects from: the last row a click or a checkbox changed.
    public private(set) var anchor: String?

    public init() {}

    /// The toolbar's count while selecting: "3 tunes".
    public static func title(_ count: Int) -> String {
        CatalogSearch.tunes(count)
    }

    /// The Mac column title while selecting: "3 selected".
    public static func selectedTitle(_ count: Int) -> String {
        "\(count) selected"
    }

    /// Turns the mode on, with `row` selected when it is entered from one.
    public mutating func enter(with row: String? = nil) {
        isActive = true
        ids = row.map { [$0] } ?? []
        origin = row
        anchor = row
    }

    /// Turns the mode on with several rows already chosen, as a Mac's Command- or Shift-click
    /// chooses them.
    public mutating func enter(selecting rows: Set<String>) {
        isActive = true
        ids = rows
        origin = nil
        anchor = nil
    }

    /// Ends the mode and forgets the selection.
    public mutating func exit() {
        isActive = false
        ids = []
        anchor = nil
    }

    /// Replaces the selected rows, keeping only visible ones.
    public mutating func set(_ rows: Set<String>, visible: [String]) {
        ids = rows.intersection(visible)
    }

    /// Adds `row` to the selection or takes it out, as its checkbox does. Only a visible row is
    /// ever added.
    public mutating func setSelected(_ row: String, _ isSelected: Bool, visible: [String]) {
        var rows = ids
        if isSelected { rows.insert(row) } else { rows.remove(row) }
        set(rows, visible: visible)
        anchor = row
    }

    /// Whether `row` is selected, for its checkbox, which adds or takes out that row alone.
    public subscript(isSelected row: String, visible visible: [String]) -> Bool {
        get { ids.contains(row) }
        set { setSelected(row, newValue, visible: visible) }
    }

    /// A click on a row while the mode is on: adds or takes out that row, as its checkbox does.
    /// With `extending`, as a Shift-click, also selects every visible row from the anchor to it.
    public mutating func click(_ row: String, extending: Bool, visible: [String]) {
        if extending, let anchor, let from = visible.firstIndex(of: anchor),
            let to = visible.firstIndex(of: row)
        {
            set(ids.union(visible[min(from, to)...max(from, to)]), visible: visible)
        } else {
            setSelected(row, !ids.contains(row), visible: visible)
        }
    }

    /// Drops rows that are no longer visible, such as ones a search or a filter hides.
    public mutating func prune(visible: [String]) {
        let kept = ids.intersection(visible)
        if kept != ids { ids = kept }
    }

    /// Whether every visible row is selected. Never true with nothing visible.
    public func allSelected(visible: [String]) -> Bool {
        !visible.isEmpty && visible.allSatisfy(ids.contains)
    }

    /// Selects every visible row.
    public mutating func selectAll(visible: [String]) {
        ids = Set(visible)
    }

    /// Selects every visible row, or none when all of them already are.
    public mutating func toggleAll(visible: [String]) {
        if allSelected(visible: visible) { ids = [] } else { selectAll(visible: visible) }
    }

    /// The selected rows among `visible`, in screen order.
    public func selected<Row>(in visible: [Row], id: (Row) -> String) -> [Row] {
        visible.filter { ids.contains(id($0)) }
    }

    /// What the rows' list chooses when the mode is off and a detail column shows one tune.
    /// Choosing several, as a Mac's Command- or Shift-click does, enters the mode with them.
    public mutating func choose(_ rows: Set<String>, detail: inout String?) {
        if rows.count > 1 {
            let open = detail
            enter(selecting: rows)
            // The open row is the list's anchor for that click, so a later Shift-click extends from it.
            anchor = open.flatMap { rows.contains($0) ? $0 : nil }
        } else {
            detail = rows.first
        }
    }
}

extension TuneSelection {
    /// Whether `id`'s row draws as the list's selection: one of the selection while it lasts,
    /// else the detail column's tune.
    @MainActor static func rowIsSelected(
        _ id: String, selection: TuneSelection, detailTune: ShellValue<String?>?
    ) -> Bool {
        selection.isActive ? selection.ids.contains(id) : detailTune?.value == id
    }

    /// The selection binding for a screen's list of rows: the selection while the mode is on;
    /// the row the detail column shows while it is off, where there is one; and none on a phone,
    /// whose rows push their page instead. `visible` is read only when the list sets the binding.
    @MainActor static func listBinding(
        _ selection: Binding<TuneSelection>, visible: @escaping () -> [String], detail: Binding<String?>?
    ) -> Binding<Set<String>>? {
        if selection.wrappedValue.isActive {
            return Binding {
                selection.wrappedValue.ids
            } set: { rows in
                selection.wrappedValue.set(rows, visible: visible())
            }
        }
        guard let detail else { return nil }
        // Read here, so the screen building the binding redraws when the detail column's row changes.
        _ = detail.wrappedValue
        return Binding {
            detail.wrappedValue.map { [$0] } ?? []
        } set: { rows in
            var chosen = detail.wrappedValue
            selection.wrappedValue.choose(rows, detail: &chosen)
            if chosen != detail.wrappedValue { detail.wrappedValue = chosen }
        }
    }
}
