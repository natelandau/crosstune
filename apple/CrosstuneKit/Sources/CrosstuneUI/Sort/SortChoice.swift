import SwiftUI

/// The sorts one screen offers, each named for its menu, in menu order.
public protocol SortKind: RawRepresentable, CaseIterable, Hashable, Sendable
where RawValue == String, AllCases: RandomAccessCollection {
    /// True for a sort whose first direction is newest first rather than A first.
    var isDate: Bool { get }
    var label: String { get }
}

/// A sort and its direction, stored per device as `"<sort>.<asc|desc>"`. `descending` is newest
/// first for a date sort and Z first otherwise. A date sort starts descending; every other sort
/// starts ascending.
public struct SortChoice<Sort: SortKind>: Equatable, Sendable, RawRepresentable {
    public var sort: Sort
    public var descending: Bool

    public init(sort: Sort, descending: Bool) {
        self.sort = sort
        self.descending = descending
    }

    public init?(rawValue: String) {
        let parts = rawValue.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, let sort = Sort(rawValue: String(parts[0])),
            parts[1] == "asc" || parts[1] == "desc"
        else { return nil }
        self.init(sort: sort, descending: parts[1] == "desc")
    }

    public var rawValue: String { "\(sort.rawValue).\(descending ? "desc" : "asc")" }

    /// Picking the current sort reverses it; picking another starts it at its first direction.
    public func picking(_ picked: Sort) -> SortChoice {
        if picked == sort { return SortChoice(sort: picked, descending: !descending) }
        return SortChoice(sort: picked, descending: picked.isDate)
    }
}

public enum SortText {
    public static let sort = "Sort"
    public static let newestFirst = "Newest first"
    public static let oldestFirst = "Oldest first"
    public static let aToZ = "A to Z"
    public static let zToA = "Z to A"

    /// The words for a sort's direction, shown with its checked menu item.
    public static func direction<Sort>(_ choice: SortChoice<Sort>) -> String {
        if choice.sort.isDate { return choice.descending ? newestFirst : oldestFirst }
        return choice.descending ? zToA : aToZ
    }

    /// Down for newest first and Z to A, up for oldest first and A to Z.
    public static func directionSymbol<Sort>(_ choice: SortChoice<Sort>) -> String {
        choice.descending ? "arrow.down" : "arrow.up"
    }
}

/// One choice per sort, the current one checked; choosing it again reverses it. A screen's Sort
/// menu and the menu bar's View > Sort By.
public struct SortChoices<Sort: SortKind>: View {
    @Binding var choice: SortChoice<Sort>

    public init(choice: Binding<SortChoice<Sort>>) {
        _choice = choice
    }

    /// One menu item: the sort it picks, and for the current one its direction.
    struct Item: Equatable {
        let sort: Sort
        let label: String
        let isChecked: Bool
        let direction: String?
        let directionSymbol: String?
    }

    nonisolated static func items(for choice: SortChoice<Sort>) -> [Item] {
        Sort.allCases.map { sort in
            let checked = choice.sort == sort
            return Item(
                sort: sort, label: sort.label, isChecked: checked,
                direction: checked ? SortText.direction(choice) : nil,
                directionSymbol: checked ? SortText.directionSymbol(choice) : nil)
        }
    }

    /// What a toggle of `sort` leaves chosen. Choosing the checked item turns its toggle off,
    /// which still reverses the sort rather than leaving nothing chosen.
    nonisolated static func toggled(_ sort: Sort, isOn _: Bool, from choice: SortChoice<Sort>) -> SortChoice<Sort> {
        choice.picking(sort)
    }

    public var body: some View {
        ForEach(Self.items(for: choice), id: \.sort) { item in
            // A toggle, so the check reads as the choice's state rather than as an icon.
            Toggle(
                isOn: Binding {
                    item.isChecked
                } set: { isOn in
                    choice = Self.toggled(item.sort, isOn: isOn, from: choice)
                }
            ) {
                if let direction = item.direction, let symbol = item.directionSymbol {
                    // A menu shows the second text as the item's subtitle, which VoiceOver reads
                    // after its title.
                    Label {
                        Text(item.label)
                        Text(direction)
                    } icon: {
                        Image(systemName: symbol)
                    }
                } else {
                    Text(item.label)
                }
            }
        }
    }
}

/// A screen's toolbar Sort menu.
struct SortMenu<Sort: SortKind>: View {
    @Binding var choice: SortChoice<Sort>

    var body: some View {
        Menu(SortText.sort, systemImage: "arrow.up.arrow.down") {
            SortChoices(choice: $choice)
        }
        .help(SortText.sort)
    }
}
