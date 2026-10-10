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

    #expect(page.nextSince == 43)
    #expect(page.hasMore == false)
    let tables = page.rows.map { $0.additionalProperties.value["table"] as? String }
    #expect(tables == ["tunes", "lists", "recording_loops"])
    let tune = page.rows[0].additionalProperties.value["row"] as? [String: (any Sendable)?]
    #expect(tune?["title"] as? String == "Cluck Old Hen")
}

@Test func decodesAPullPageFromANewerServer() async throws {
    let newer = """
        {
          "rows": [
            {"table": "tempo_marks", "row": {"id": "x1", "server_seq": 40}},
            {
              "table": "tunes",
              "row": {
                "id": "0b7c9a52-3f0e-4d6a-9d1e-6f4a2b8c1e01",
                "created_at": "2026-09-20T18:04:11Z",
                "updated_at": "2026-09-21T02:15:40Z",
                "deleted_at": null,
                "server_seq": 41,
                "owner_user_id": null,
                "title": "Cluck Old Hen",
                "field_added_later": true
              }
            }
          ],
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

    #expect(page.rows.map { $0.additionalProperties.value["table"] as? String } == ["tempo_marks", "tunes"])
    let tune = page.rows[1].additionalProperties.value["row"] as? [String: (any Sendable)?]
    #expect((tune?["field_added_later"] ?? nil) as? Bool == true)
    #expect(page.nextSince == 41)
}
