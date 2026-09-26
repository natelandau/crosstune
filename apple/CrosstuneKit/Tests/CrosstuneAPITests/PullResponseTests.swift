import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import CrosstuneAPI

/// Answers every request with one fixture body, so a test runs the generated client's real
/// decoding path with no network.
struct FixtureTransport: ClientTransport {
    let body: Data

    func send(
        _ request: HTTPRequest,
        body requestBody: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var response = HTTPResponse(status: .ok)
        response.headerFields[.contentType] = "application/json"
        return (response, HTTPBody(body))
    }
}

func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

@Test func decodesAPullPageThroughTheGeneratedClient() async throws {
    let client = Client(
        serverURL: URL(string: "https://api.example.test")!,
        configuration: .crosstune,
        transport: FixtureTransport(body: try fixture("pull-response"))
    )

    let page = try await client.pullV1SyncPullGet(.init(query: .init(since: 0))).ok.body.json

    #expect(page.nextSince == 42)
    #expect(page.hasMore == false)
    #expect(page.rows.count == 2)

    guard case .tunes(let tune) = page.rows[0] else {
        Issue.record("first row is not a tune: \(page.rows[0])")
        return
    }
    #expect(tune.row.title == "Cluck Old Hen")
    #expect(tune.row.tunings?.violin?.tuning == "AEAE")

    guard case .lists(let list) = page.rows[1] else {
        Issue.record("second row is not a list: \(page.rows[1])")
        return
    }
    #expect(list.row.name == "Thursday jam")
}

@Test func decodesARowFromANewerServer() async throws {
    let newer = """
        {
          "rows": [{
            "table": "tunes",
            "row": {
              "id": "0b7c9a52-3f0e-4d6a-9d1e-6f4a2b8c1e01",
              "created_at": "2026-09-20T18:04:11Z",
              "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null,
              "server_seq": 41,
              "owner_user_id": null,
              "title": "Cluck Old Hen",
              "modes": ["lydian"],
              "time_signature": "5/4",
              "field_added_later": true
            }
          }],
          "next_since": 41,
          "has_more": false
        }
        """
    let client = Client(
        serverURL: URL(string: "https://api.example.test")!,
        configuration: .crosstune,
        transport: FixtureTransport(body: Data(newer.utf8))
    )

    let page = try await client.pullV1SyncPullGet(.init(query: .init(since: 0))).ok.body.json

    guard case .tunes(let tune) = page.rows.first else {
        Issue.record("first row is not a tune")
        return
    }
    #expect(tune.row.modes == ["lydian"])
    #expect(tune.row.timeSignature == "5/4")
    #expect((tune.row.additionalProperties.value["field_added_later"] ?? nil) as? Bool == true)
}
