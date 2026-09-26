import CrosstuneCommands

/// One reorder as the musician made it: an item sent to one side of a target. The side is
/// decided once, when the move is made, so replaying it onto an order that already holds it
/// changes nothing.
struct ListMove: Equatable {
    let itemID: String
    let targetID: String
    let side: Side

    /// Moves the row at `from` to where the row at `to` stands, in rows as they are shown. Nil
    /// when either index is out of range or they are the same. A hidden archived tune keeps its
    /// place, because the target is a visible neighbor.
    init?(ids: [String], from: Int, to: Int) {
        guard ids.indices.contains(from), ids.indices.contains(to), from != to else { return nil }
        itemID = ids[from]
        targetID = ids[to]
        side = from < to ? .after : .before
    }

    func apply(to order: [String]) -> [String] {
        placeBeside(order, id: { $0 }, itemID: itemID, targetID: targetID, side: side)
    }
}

/// The reorders still being written, replayed onto the stored order so a move shows at once.
///
/// A move replays until its own write settles and the first read after that decides. A read that
/// landed before the write settled decides straight away, which the order the store held just
/// after the write answers. Nothing is inferred from the order alone, because a tune beside its
/// target says nothing about which move put it there. A move whose tune or target has left the
/// list stops early, having nothing left to say.
struct PendingMoves {
    private struct Pending {
        let id: Int
        let move: ListMove
        /// The read on screen, and the order the store held, when this move's write settled.
        var settled: (revision: Int, order: [String])?
    }

    private var pending: [Pending] = []
    private var nextID = 0

    var isEmpty: Bool { pending.isEmpty }

    /// Queues a move and returns its handle for ``settle(_:revision:storedOrder:)`` or
    /// ``drop(_:)``.
    mutating func begin(_ move: ListMove) -> Int {
        nextID += 1
        pending.append(Pending(id: nextID, move: move))
        return nextID
    }

    /// Marks a move's write as landed. `revision` names the read on screen when it landed, and
    /// `storedOrder` is what the store held just after.
    mutating func settle(_ id: Int, revision: Int, storedOrder: [String]) {
        guard let index = pending.firstIndex(where: { $0.id == id }) else { return }
        pending[index].settled = (revision, storedOrder)
    }

    /// Forgets a move whose write failed, or landed with no read to say when the screen caught
    /// up. The moves after it land where the store puts them.
    mutating func drop(_ id: Int) {
        pending.removeAll { $0.id == id }
    }

    /// Retires every move that has nothing more to say about `order`, read at `revision`.
    mutating func retire(order: [String], revision: Int) {
        pending.removeAll { !Self.replays($0, order: order, revision: revision) }
    }

    /// `order` with every move still in flight replayed, in the order they were made, which is
    /// the order the store applies them in.
    func apply(to order: [String]) -> [String] {
        pending.reduce(order) { current, pending in pending.move.apply(to: current) }
    }

    private static func replays(_ pending: Pending, order: [String], revision: Int) -> Bool {
        guard order.contains(pending.move.itemID), order.contains(pending.move.targetID) else { return false }
        guard let settled = pending.settled else { return true }
        return settled.revision == revision && !sameOrder(order, settled.order)
    }

    /// Whether two orders agree on the items both carry. A list view drops an item whose tune
    /// rows have not arrived yet, which a read of the stored order still counts, so one can be a
    /// superset of the other across a sync page boundary.
    static func sameOrder(_ first: [String], _ second: [String]) -> Bool {
        let inFirst = Set(first)
        let inSecond = Set(second)
        return first.filter(inSecond.contains) == second.filter(inFirst.contains)
    }
}

/// Where the move menu sends a tune among the rows on screen.
enum MovePlace: CaseIterable {
    case top
    case up
    case down
    case bottom

    static let moveToTop = "Move to top"
    static let moveUp = "Move up"
    static let moveDown = "Move down"
    static let moveToBottom = "Move to bottom"

    var label: String {
        switch self {
        case .top: Self.moveToTop
        case .up: Self.moveUp
        case .down: Self.moveDown
        case .bottom: Self.moveToBottom
        }
    }

    var systemImage: String {
        switch self {
        case .top: "arrow.up.to.line"
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .bottom: "arrow.down.to.line"
        }
    }

    /// The moves that go somewhere from `index` among `count` rows.
    static func places(at index: Int, count: Int) -> [MovePlace] {
        (index > 0 ? [.top, .up] : []) + (index < count - 1 ? [.down, .bottom] : [])
    }

    /// The row index this sends the row at `index` to, among `count` rows.
    func destination(from index: Int, count: Int) -> Int {
        switch self {
        case .top: 0
        case .up: index - 1
        case .down: index + 1
        case .bottom: count - 1
        }
    }

    /// The row a drag landed on, from SwiftUI's `onMove` offset: the index the row would be
    /// inserted before, counted in the rows as they were before the drag.
    static func dropTarget(from index: Int, offset: Int) -> Int {
        offset > index ? offset - 1 : offset
    }
}
