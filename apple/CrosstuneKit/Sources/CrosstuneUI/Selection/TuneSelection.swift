import SwiftUI

/// Selection mode on a screen of tune rows: whether it is on, and which rows are in it, by the
/// id each row is tagged with. Only visible tunes are ever selected, so an action never reaches
/// a tune the musician cannot see.
public struct TuneSelection: Equatable, Sendable {
    public static let selectAll = "Select All"
    public static let deselectAll = "Deselect All"
    /// The Mac's More menu item, in the app's sentence case.
    public static let selectAllItem = "Select all"
    public static let deselectAllItem = "Deselect all"
    public static let done = "Done"

    public private(set) var isActive = false
    public private(set) var ids: Set<String> = []
    /// The row the mode was last entered from, which VoiceOver returns to when it ends. Kept
    /// after the mode ends, for that return.
    public private(set) var origin: String?

    public init() {}

    /// The toolbar's count while selecting: "3 tunes".
    public static func title(_ count: Int) -> String {
        CatalogSearch.tunes(count)
    }

    /// Turns the mode on, with `row` selected when it is entered from one.
    public mutating func enter(with row: String? = nil) {
        isActive = true
        ids = row.map { [$0] } ?? []
        origin = row
    }

    /// Turns the mode on with several rows already chosen, as a Mac's Command- or Shift-click
    /// chooses them.
    public mutating func enter(selecting rows: Set<String>) {
        isActive = true
        ids = rows
        origin = nil
    }

    /// Ends the mode and forgets the selection.
    public mutating func exit() {
        isActive = false
        ids = []
    }

    /// Replaces the selected rows, keeping only visible ones.
    public mutating func set(_ rows: Set<String>, visible: [String]) {
        ids = rows.intersection(visible)
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
            enter(selecting: rows)
        } else {
            detail = rows.first
        }
    }
}

extension TuneSelection {
    /// The selection binding for a screen's list of rows: the selection while the mode is on; the
    /// detail column's tune while it is off, where there is one; and none on a phone, whose rows
    /// push their tune instead.
    @MainActor static func listBinding(
        _ selection: Binding<TuneSelection>, visible: [String], detailTune: Binding<String?>?
    ) -> Binding<Set<String>>? {
        if selection.wrappedValue.isActive {
            return Binding {
                selection.wrappedValue.ids
            } set: { rows in
                selection.wrappedValue.set(rows, visible: visible)
            }
        }
        guard let detailTune else { return nil }
        return Binding {
            detailTune.wrappedValue.map { [$0] } ?? []
        } set: { rows in
            var detail = detailTune.wrappedValue
            selection.wrappedValue.choose(rows, detail: &detail)
            if detail != detailTune.wrappedValue { detailTune.wrappedValue = detail }
        }
    }
}
