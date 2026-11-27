import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneSync

struct EngineCaseInput: Decodable, Sendable {
    enum Action: String, Decodable, Sendable {
        case sync
        case pullEvents = "pull_events"
        case stop
    }

    let local: SyncCaseLocalState
    let batchSize: Int?
    let responses: [ScriptedResponse]
    let actions: [Action]

    enum CodingKeys: String, CodingKey {
        case local, responses, actions
        case batchSize = "batch_size"
    }
}

struct EngineCaseExpected: Decodable, Sendable {
    let requests: [SentRequest]
    let local: SyncCaseLocalState
}

/// Reads fixtures/sync-engine, which the web client's sync engine also reads. Every request goes
/// through the generated API client to a scripted server, so the routes and bodies are the wire's.
@Suite(.timeLimit(.minutes(1))) struct SharedSyncEngineCases {
    fileprivate static let cases: [SharedCase<EngineCaseInput, EngineCaseExpected>] = SharedCases.loadOrTrap(
        "sync-engine", platform: .apple, minimum: 9)

    @Test(arguments: cases) @MainActor
    fileprivate func syncsLikeTheSharedCase(sharedCase: SharedCase<EngineCaseInput, EngineCaseExpected>) async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let input = sharedCase.input
        let expected = sharedCase.expected
        try await store.write { writer in try SyncCaseDatabase.seed(input.local, in: writer) }
        let server = ScriptedTransport(responses: input.responses)
        let api = liveSyncAPI(server, session: .crosstune)
        let sleeper = ManualSleeper()
        // The transfer loop moves files only, and a case seeds none.
        let engine = SyncEngine(
            store: store, api: api, isOffline: { false }, batchSize: input.batchSize ?? SyncEngine.pushBatchSize,
            sleep: sleeper.sleep, transferPass: {})

        var runs: [Task<Void, Never>] = []
        for action in input.actions {
            switch action {
            case .sync: runs.append(Task { await engine.sync() })
            case .pullEvents: runs.append(Task { await engine.pullEvents() })
            case .stop: server.onNextResponse { await engine.stop() }
            }
        }
        for run in runs { await run.value }
        engine.stop()

        #expect(server.unexpected.isEmpty, "requests the script did not expect: \(server.unexpected)")
        #expect(server.remaining == 0, "scripted responses no request took: \(server.remaining)")
        #expect(
            server.sent.map(\.withCanonicalTimestamps) == expected.requests.map(\.withCanonicalTimestamps),
            "requests: got \(server.sent), expected \(expected.requests)")
        try await store.write { writer in try SyncCaseDatabase.expectMatches(expected.local, in: writer) }
    }
}
