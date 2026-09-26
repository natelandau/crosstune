import Foundation
import Testing

@testable import CrosstuneStore

private func wire(_ json: String) throws -> JSONObject {
    try JSONDecoder().decode(JSONObject.self, from: Data(json.utf8))
}

@Test func aWireRowDropsOwnershipAndKeepsWhatThisBuildDoesNotKnow() throws {
    let tune = try Tune(
        wire: wire(
            #"""
            {
              "id": "0b7c9a52-3f0e-4d6a-9d1e-6f4a2b8c1e01",
              "created_at": "2026-09-20T18:04:11Z",
              "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null,
              "server_seq": 41,
              "owner_user_id": "3e5b1b3a-1111-4444-8888-000000000000",
              "title": "Cluck Old Hen",
              "modes": ["lydian"],
              "tempo": 120
            }
            """#))

    #expect(tune.id == "0b7c9a52-3f0e-4d6a-9d1e-6f4a2b8c1e01")
    #expect(tune.modes == ["lydian"])
    #expect(tune.extra == ["tempo": .integer(120)])
}

@Test func aWireRowFillsAnOmittedFieldWithTheContractsDefault() throws {
    let tune = try Tune(
        wire: wire(
            #"""
            {
              "id": "0b7c9a52-3f0e-4d6a-9d1e-6f4a2b8c1e01",
              "created_at": "2026-09-20T18:04:11Z",
              "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null,
              "server_seq": 41,
              "owner_user_id": null,
              "title": "Cluck Old Hen",
              "modes": []
            }
            """#))

    #expect(tune.alternateTitles == [])
    #expect(tune.isCrooked == false)
    #expect(tune.tunings == [:])
    #expect(tune.extra == [:])
}

@Test func aWireRowDecodesAFullRowForEveryTable() throws {
    let tune = try Tune(
        wire: wire(
            #"""
            {
              "id": "tune-1", "created_at": "2026-09-20T18:04:11Z", "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null, "server_seq": 1, "owner_user_id": "owner-1",
              "title": "Grey Eagle", "alternate_titles": ["Gray Eagle"], "composer": "Traditional",
              "genre": "Old-Time", "tune_type": "reel", "key": "D", "modes": ["major", "mixolydian"],
              "time_signature": "2/4", "part_structure": "AABB", "is_crooked": true,
              "lyrics": "la la la", "tunings": {"violin": "AEAE"}
            }
            """#))
    #expect(tune.title == "Grey Eagle")
    #expect(tune.tunings == ["violin": .string("AEAE")])

    let userTune = try UserTune(
        wire: wire(
            #"""
            {
              "id": "user-tune-1", "created_at": "2026-09-20T18:04:11Z", "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null, "server_seq": 2, "user_id": "owner-1",
              "tune_id": "tune-1", "status": "learning", "learned_from": "a session",
              "learned_on": "2026-01-01", "notes": "sounds good", "archived_at": null
            }
            """#))
    #expect(userTune.status == "learning")
    #expect(userTune.learnedOn == "2026-01-01")

    let list = try TuneList(
        wire: wire(
            #"""
            {
              "id": "list-1", "created_at": "2026-09-20T18:04:11Z", "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null, "server_seq": 3, "user_id": "owner-1",
              "name": "Thursday jam", "position": 3
            }
            """#))
    #expect(list.name == "Thursday jam")
    #expect(list.position == 3)

    let item = try ListItem(
        wire: wire(
            #"""
            {
              "id": "item-1", "created_at": "2026-09-20T18:04:11Z", "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null, "server_seq": 4,
              "list_id": "list-1", "user_tune_id": "user-tune-1", "position": 1
            }
            """#))
    #expect(item.listID == "list-1")
    #expect(item.userTuneID == "user-tune-1")

    let link = try RecordingLink(
        wire: wire(
            #"""
            {
              "id": "link-1", "created_at": "2026-09-20T18:04:11Z", "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null, "server_seq": 5, "added_by_user_id": "owner-1",
              "tune_id": "tune-1", "url": "https://example.com", "provider": "youtube",
              "provider_ref": "abc123", "title": "A Recording", "label": "Live", "artwork_url": "a",
              "position": 2
            }
            """#))
    #expect(link.url == "https://example.com")
    #expect(link.artworkURL == "a")

    let recording = try Recording(
        wire: wire(
            #"""
            {
              "id": "recording-1", "created_at": "2026-09-20T18:04:11Z", "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null, "server_seq": 6, "user_id": "owner-1",
              "tune_id": "tune-1", "source": "microphone", "recorded_at": "2026-09-20T18:04:11Z",
              "label": "Take 1", "position": 0, "state": "ready", "duration_ms": 5000,
              "playback_mime": "audio/mp4", "playback_bytes": 2048, "error": null
            }
            """#))
    #expect(recording.source == "microphone")
    #expect(recording.durationMs == 5000)

    let settings = try UserSettings(
        wire: wire(
            #"""
            {
              "id": "settings-1", "created_at": "2026-09-20T18:04:11Z", "updated_at": "2026-09-21T02:15:40Z",
              "deleted_at": null, "server_seq": 7, "user_id": "owner-1",
              "audio_quality": "high", "instruments": ["violin", "banjo"]
            }
            """#))
    #expect(settings.audioQuality == "high")
    #expect(settings.instruments == ["violin", "banjo"])

    for record in [tune.extra, userTune.extra, list.extra, item.extra, link.extra, recording.extra, settings.extra] {
        #expect(record == [:])
    }
}
