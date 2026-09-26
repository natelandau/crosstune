import CrosstuneStore

/// One outbox entry's table and operation, comparable as a value since a tuple is not.
struct QueuedOp: Equatable {
    let table: SyncTable
    let op: OutboxEntry.Operation
}

extension Array where Element == OutboxEntry {
    var queuedOps: [QueuedOp] { map { QueuedOp(table: $0.tableName, op: $0.op) } }
}
