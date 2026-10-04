import CrosstuneStore

extension Commands {
    /// Stores an event, such as a play or a scan view, and queues its insert. The queued entry
    /// waits for the next sync something else starts; an event never starts one itself.
    public func recordEvent(_ row: some EventRecord) async throws {
        try await store.write { writer in try writer.record(row) }
    }
}
