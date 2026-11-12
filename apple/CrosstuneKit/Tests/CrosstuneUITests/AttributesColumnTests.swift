import Testing

@testable import CrosstuneUI

struct AttributesColumnTests {
    private typealias Row = AttributeColumnRow<String>
    private typealias Entry = AttributeColumnEntry<String>

    private static let rows = [
        Row(id: "name", label: "Name", text: "Morning reel", group: "Details"),
        Row(id: "players", label: "Players", text: nil, group: "Details"),
        Row(id: "added", label: "Added", text: "Today", group: "Details"),
        Row(id: "location", label: "Location", text: "Brooklyn", group: "Place"),
    ]

    @Test func anEmptyRowShowsItsEmptyText() {
        let players = Self.rows.first { $0.id == "players" }!
        let name = Self.rows.first { $0.id == "name" }!
        #expect(players.value(emptyText: "Not set") == "Not set")
        #expect(players.accessibilityLabel(emptyText: "Not set") == "Players, Not set")
        #expect(name.value(emptyText: "Not set") == "Morning reel")
    }

    @Test func aCompactWidthOrHeightPresentsAsASheet() {
        #expect(AttributeEditorPresentation.presentsAsSheet(compactWidth: false, compactHeight: false) == false)
        #expect(AttributeEditorPresentation.presentsAsSheet(compactWidth: true, compactHeight: false))
        #expect(AttributeEditorPresentation.presentsAsSheet(compactWidth: false, compactHeight: true))
    }

    @Test func belowContentFollowsItsRow() throws {
        let entries = Entry.entries(groups: ["Details", "Place"], rows: Self.rows)
        for row in Self.rows {
            let index = try #require(entries.firstIndex(of: .row(row)))
            #expect(entries[index + 1] == .below(row.id), "\(row.id)")
        }
    }

    @Test func eachGroupHeadsItsRowsInOrder() {
        let entries = Entry.entries(groups: ["Place", "Details", "Empty"], rows: Self.rows)
        let byID = Dictionary(uniqueKeysWithValues: Self.rows.map { ($0.id, $0) })
        #expect(
            entries == [
                .heading("Place", isFirst: true), .row(byID["location"]!), .below("location"),
                .heading("Details", isFirst: false), .row(byID["name"]!), .below("name"),
                .row(byID["players"]!), .below("players"), .row(byID["added"]!), .below("added"),
            ])
    }

    // MARK: Card

    private typealias Section = AttributeCardSection<String>

    @Test func theCardHoldsBackRowsBehindMoreDetails() {
        let closed = Section.sections(
            groups: ["Details", "Place"], rows: Self.rows, beforeMoreDetails: ["name", "players"], expanded: false)
        #expect(closed.map(\.heading) == [nil])
        #expect(closed[0].rows.map(\.id) == ["name", "players"])
        #expect(closed[0].hasMoreDetails)
        #expect(closed[0].more.isEmpty)

        let open = Section.sections(
            groups: ["Details", "Place"], rows: Self.rows, beforeMoreDetails: ["name", "players"], expanded: true)
        #expect(open.map(\.heading) == [nil, "Place"])
        #expect(open[0].more.map(\.id) == ["added"])
        #expect(open[1].rows.map(\.id) == ["location"])
    }

    @Test func aLaterGroupBeforeMoreDetailsShowsWhileClosed() {
        let closed = Section.sections(
            groups: ["Details", "Place"], rows: Self.rows, beforeMoreDetails: ["name", "location"], expanded: false)
        #expect(closed.map(\.heading) == [nil, "Place"])
        #expect(closed[1].rows.map(\.id) == ["location"])
    }

    @Test(arguments: [nil, Set(Self.rows.map(\.id))] as [Set<String>?])
    func aCardWithNothingHeldBackHasNoMoreDetails(upFront: Set<String>?) {
        let sections = Section.sections(
            groups: ["Details", "Place"], rows: Self.rows, beforeMoreDetails: upFront, expanded: false)
        #expect(sections.map(\.heading) == [nil, "Place"])
        #expect(sections.allSatisfy { !$0.hasMoreDetails && $0.more.isEmpty })
        #expect(sections[0].rows.map(\.id) == ["name", "players", "added"])
    }
}
