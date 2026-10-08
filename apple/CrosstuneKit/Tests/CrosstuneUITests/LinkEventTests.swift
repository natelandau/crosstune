import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// A link reports its service, how it came in, and its ID once it is stored, and a search in Find
/// recordings reports its service and how much it found once it answers. Never the link itself.
@MainActor
@Suite struct LinkEventTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()
    private let tuneID = SampleCatalog.entries[0].tune.id

    private func found(_ count: Int) -> RecordingSearchOutcome {
        .ok([
            SearchGroup(
                provider: "tidal", status: .results,
                results: (0..<count).map {
                    SearchResult(
                        url: "https://tidal.com/track/\($0)", provider: "tidal", providerRef: "\($0)",
                        title: "Take \($0)")
                },
                searchURL: "https://tidal.com/search")
        ])
    }

    /// The ID of the link stored at `url`.
    private func linkID(_ url: String, in store: CrosstuneStore) async throws -> String {
        try #require(
            try await store.read { db in
                try RecordingLink.fetchAll(db).first { $0.url == url }?.id
            })
    }

    @Test func reportsAPastedLinkByItsService() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = LinkSheetModel(store: store, tuneID: tuneID, resolve: nil, analytics: sink.client)
        model.setURL("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

        #expect(await model.save())

        let linkID = try await linkID("https://www.youtube.com/watch?v=dQw4w9WgXcQ", in: store)
        #expect(
            sink.captures == [
                .init(
                    name: "link_added",
                    properties: [
                        "service": .string("youtube"), "via": .string("paste"), "link_id": .string(linkID),
                        "tune_id": .string(tuneID),
                    ])
            ])
    }

    @Test func reportsNothingForALinkThatIsNotSaved() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = LinkSheetModel(store: store, tuneID: tuneID, resolve: nil, analytics: sink.client)
        model.setURL("not a link")

        #expect(!(await model.save()))

        #expect(sink.calls.isEmpty)
    }

    @Test func reportsASearchThatAnsweredAndALinkFoundByIt() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let outcome = found(3)
        let model = FindRecordingsModel(
            store: store, tuneID: tuneID, service: "tidal", search: { _, _, _ in outcome }, analytics: sink.client)
        #expect(try await poll { model.group != nil })

        let result = try #require(model.group?.results.first)
        await model.link(result)

        let linkID = try await linkID(result.url, in: store)
        #expect(
            sink.captures == [
                .init(
                    name: "find_recordings_used",
                    properties: ["service": .string("tidal"), "result_count_bucket": .string("1-9")]),
                .init(
                    name: "link_added",
                    properties: [
                        "service": .string("tidal"), "via": .string("find"), "link_id": .string(linkID),
                        "tune_id": .string(tuneID),
                    ]),
            ])
    }

    @Test func reportsNoSearchThatFailed() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = FindRecordingsModel(
            store: store, tuneID: tuneID, service: "tidal", search: { _, _, _ in .offline }, analytics: sink.client)
        #expect(try await poll { model.failure != nil })

        #expect(sink.calls.isEmpty)
    }
}
