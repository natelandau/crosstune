import CrosstuneStore

/// A synced row kept in a manual order among its siblings, such as the links on a tune.
public protocol OrderedRow {
    var position: Int { get }
    var deletedAt: Timestamp? { get }
}

extension RecordingLink: OrderedRow {}
extension TuneList: OrderedRow {}
extension ListItem: OrderedRow {}
extension Recording: OrderedRow {}

/// Rows that have not been tombstoned, in position order.
public func activeByPosition<Row: OrderedRow>(_ rows: [Row]) -> [Row] {
    rows.filter { $0.deletedAt == nil }.sorted { $0.position < $1.position }
}

/// One past the highest position among the given rows, or 0 when there are none.
public func nextPosition<Row: OrderedRow>(_ rows: [Row]) -> Int {
    rows.reduce(0) { max($0, $1.position + 1) }
}

/// Which side of the target an item moves to.
public enum Side {
    case before
    case after
}

/// Moves an item to the side of the target it was sent to. Naming a target and a side, rather
/// than a step, lets a caller that hides some items move past them without knowing where they
/// are, and makes the move idempotent: applying it again to an order that already holds it
/// changes nothing.
public func placeBeside<Item>(
    _ items: [Item], id: (Item) -> String, itemID: String, targetID: String, side: Side
) -> [Item] {
    var ordered = items
    guard let from = ordered.firstIndex(where: { id($0) == itemID }),
        let target = ordered.firstIndex(where: { id($0) == targetID }), itemID != targetID
    else { return ordered }
    let moved = ordered.remove(at: from)
    let landing = ordered.firstIndex(where: { id($0) == targetID }) ?? target
    ordered.insert(moved, at: side == .after ? landing + 1 : landing)
    return ordered
}

/// Moves an item just past the target: after it when the target was below, before it when above.
public func moveBeside<Item>(_ items: [Item], id: (Item) -> String, itemID: String, targetID: String) -> [Item] {
    let from = items.firstIndex(where: { id($0) == itemID }) ?? -1
    let target = items.firstIndex(where: { id($0) == targetID }) ?? -1
    return placeBeside(items, id: id, itemID: itemID, targetID: targetID, side: from < target ? .after : .before)
}
