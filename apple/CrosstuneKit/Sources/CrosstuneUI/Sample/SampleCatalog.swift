#if DEBUG
    import CrosstuneCommands
    import CrosstuneStore
    import CrosstuneSync
    import Foundation

    /// A realistic catalog for previews and snapshots: tunes across genres and keys, lists,
    /// links, and recordings in every state a row can show. Debug builds only.
    public enum SampleCatalog {
        /// A tune and the musician's own row for it.
        public struct Entry: Sendable {
            public let tune: Tune
            public let userTune: UserTune
        }

        /// A recording with its local file and the title of the tune it belongs to.
        public struct RecordingEntry: Sendable, Identifiable {
            public let recording: Recording
            public let file: RecordingFile?
            public let tuneTitle: String?

            public var id: String { recording.id }
        }

        /// The fixed time the sample is written at, so dates read the same on every run.
        public static let now = Timestamp(iso: "2026-09-25T17:00:00.000Z")!

        /// The instruments the sample musician plays.
        public static let instruments: Set<String> = ["violin", "five_string_banjo"]

        /// The user the sample store opens for.
        public static let userID = "sample_user"

        public static let settings = UserSettings(
            id: settingsID(clerkUserID: userID), createdAt: now, audioQuality: "standard",
            instruments: instruments.sorted())

        /// The account's storage, as the last sync would have left it.
        public static let storage = StorageFigures(
            usedBytes: 48_200_000, quotaBytes: 1_000_000_000, maxFileBytes: 100_000_000)

        public static let entries: [Entry] = [
            entry(
                "Soldier's Joy", key: "D", modes: ["major"], status: "known", genre: "Old-time", type: "Reel",
                tunings: tunings(violin: "Standard (GDAE)"),
                details: Details(
                    alternateTitles: ["Love Somebody"], timeSignature: "2/4", partStructure: "AABB",
                    lyrics: "Grasshopper sitting on a sweet potato vine\nAlong came a chicken and says you're mine",
                    learnedFrom: "Tommy Jarrell", learnedOn: "2024-03-04",
                    notes: "Drive the B part hard, and let the last line of the A part breathe.")),
            entry(
                "Cluck Old Hen", key: "A", modes: ["modal"], status: "learning", genre: "Old-time", type: "Reel",
                tunings: tunings(violin: "Cross A (AEAE)", banjo: ("Sawmill (gDGCD)", 2))),
            entry(
                "Kitchen Girl", key: "A", modes: ["mixolydian", "dorian"], status: "known", genre: "Old-time",
                type: "Reel", tunings: tunings(violin: "Cross A (AEAE)", banjo: ("Open A (aEAC#E)", nil))),
            entry(
                "The Butterfly", key: "E", modes: ["minor"], status: "want_to_learn", genre: "Irish", type: "Slip jig"),
            entry(
                "Ashokan Farewell", key: "D", modes: ["major"], status: "learning", genre: "Contemporary",
                type: "Waltz", composer: "Jay Ungar"),
            entry("Tam Lin", key: "D", modes: ["minor"], status: "known", genre: "Irish", type: "Reel"),
            entry(
                "Blackberry Blossom", key: "G", modes: ["major"], status: "learning", genre: "Bluegrass",
                type: "Breakdown", tunings: tunings(banjo: ("Open G (gDGBD)", 2))),
            entry("Elzic's Farewell", key: "A", modes: ["dorian"], status: "want_to_learn", genre: "Old-time"),
            entry("Big Scioty", key: "C/G", modes: [], status: "learning", genre: "Old-time", type: "Reel"),
            entry("Say Old Man", key: "Bb", modes: ["major"], status: "known", genre: "Old-time", archived: true),
            entry("A tune with no key yet", key: nil, modes: [], status: "want_to_learn"),
        ]

        public static let lists: [TuneList] = [
            TuneList(id: "sample_list_session", createdAt: now, name: "Tuesday session", position: 0),
            TuneList(id: "sample_list_waltzes", createdAt: now, name: "Waltzes", position: 1),
        ]

        public static let listItems: [ListItem] =
            [0, 1, 2, 5, 6].enumerated().map { position, index in
                ListItem(
                    id: "sample_item_session_\(position)", createdAt: now, listID: lists[0].id,
                    userTuneID: entries[index].userTune.id, position: position)
            } + [
                ListItem(
                    id: "sample_item_waltzes_0", createdAt: now, listID: lists[1].id,
                    userTuneID: entries[4].userTune.id, position: 0)
            ]

        public static let links: [RecordingLink] = [
            RecordingLink(
                id: "sample_link_youtube", createdAt: now, tuneID: entries[0].tune.id,
                url: "https://www.youtube.com/watch?v=M7lc1UVf-VE", provider: "youtube", providerRef: "M7lc1UVf-VE",
                title: "Soldier's Joy - Tommy Jarrell", position: 0),
            RecordingLink(
                id: "sample_link_spotify", createdAt: now, tuneID: entries[0].tune.id,
                url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", provider: "spotify",
                providerRef: "track:4uLU6hMCjMI75M1A2tKUQC", label: "Bruce Molsky's version",
                position: 1),
            RecordingLink(
                id: "sample_link_other", createdAt: now, tuneID: entries[1].tune.id,
                url: "https://www.slippery-hill.com/content/cluck-old-hen", provider: "other", position: 0),
        ]

        public static let recordings: [RecordingEntry] = [
            recording(
                "ready_here", tune: 0, label: "Jam at Mike's", state: "ready", seconds: 184,
                file: .downloaded, minutesAgo: 60 * 26),
            recording("ready_server", tune: 1, state: "ready", seconds: 95, file: nil, minutesAgo: 60 * 50),
            recording("waiting", tune: 2, state: "pending_upload", seconds: 42, file: .captured, minutesAgo: 5),
            recording(
                "upload_failed", tune: 6, state: "pending_upload", seconds: 61, file: .failedUpload,
                fileError: "The server refused the upload.", minutesAgo: 30),
            recording("processing", tune: nil, state: "processing", seconds: nil, file: .uploaded, minutesAgo: 2),
            recording("transcode_failed", tune: 4, state: "failed", seconds: 12, file: nil, minutesAgo: 90),
        ]

        /// A capture an earlier run left that recovery could not save.
        public static let unfinishedCaptures: [RecordingFile] = [
            RecordingFile(
                id: "sample_capture_unfinished", localState: .capturing,
                fileName: "sample_capture_unfinished.aac",
                recordedAt: Timestamp(milliseconds: now.milliseconds - 60 * 60_000),
                updatedAt: now)
        ]

        /// The recording whose audio the sample shell writes, so it plays for real.
        public static var playable: RecordingEntry { recordings[0] }

        /// The recordings as their rows read.
        public static var recordingRows: [RecordingRowContent] {
            recordings.map {
                RecordingRowContent(
                    recording: $0.recording, file: $0.file, tuneTitle: $0.tuneTitle, locale: locale,
                    timeZone: timeZone)
            }
        }

        /// The links as their rows read.
        public static var linkRows: [LinkRowContent] {
            links.map { LinkRowContent(link: $0, embeddable: Embed.for($0) != nil) }
        }

        /// Fixed so previews and snapshots read the same wherever they render.
        public static let locale = Locale(identifier: "en_US")
        public static let timeZone = TimeZone(identifier: "America/New_York")!

        /// Opens a store in a fresh temporary folder and writes the whole sample into it.
        /// `withAudio` also writes a tone as ``playable``'s audio file, so it plays.
        public static func makeStore(
            root: URL = FileManager.default.temporaryDirectory.appending(
                path: "crosstune-sample-\(UUID().uuidString)", directoryHint: .isDirectory),
            withAudio: Bool = false
        ) async throws -> CrosstuneStore {
            let store = try CrosstuneStore.open(userID: userID, root: root)
            try await store.write { writer in
                try writer.put(settings, at: now)
                for entry in entries {
                    try writer.put(entry.tune, at: now)
                    try writer.put(entry.userTune, at: now)
                }
                for list in lists { try writer.put(list, at: now) }
                for item in listItems { try writer.put(item, at: now) }
                for link in links { try writer.put(link, at: now) }
                for entry in recordings {
                    try writer.put(entry.recording, at: now)
                    // Local file state is never synced, so it has no outbox entry to queue.
                    try entry.file?.upsert(writer.db)
                }
                for capture in unfinishedCaptures { try capture.upsert(writer.db) }
                try writer.setMeta(.storage, to: storage)
            }
            if withAudio, let file = playable.file, let name = file.fileName {
                try await SampleAudio.writeTone(
                    to: store.audioFolder.appending(path: name),
                    seconds: Double(playable.recording.durationMs ?? 30_000) / 1000)
            }
            return store
        }

        private static func tunings(violin: String? = nil, banjo: (String, Int64?)? = nil) -> JSONObject {
            var map: JSONObject = [:]
            if let violin { map["violin"] = .object(["tuning": .string(violin)]) }
            if let banjo {
                var entry: JSONObject = ["tuning": .string(banjo.0)]
                if let capo = banjo.1 { entry["capo"] = .integer(capo) }
                map["five_string_banjo"] = .object(entry)
            }
            return map
        }

        /// The fields a sample tune fills only when a screen needs something to show in them.
        private struct Details {
            var alternateTitles: [String] = []
            var timeSignature: String?
            var partStructure: String?
            var lyrics: String?
            var learnedFrom: String?
            var learnedOn: String?
            var notes: String?
        }

        private static func entry(
            _ title: String, key: String?, modes: [String], status: String, genre: String? = nil,
            type: String? = nil, composer: String? = nil, tunings: JSONObject = [:], archived: Bool = false,
            details: Details = Details()
        ) -> Entry {
            let slug = title.lowercased().filter { $0.isLetter || $0.isNumber }
            let tune = Tune(
                id: "sample_tune_\(slug)", createdAt: now, title: title, alternateTitles: details.alternateTitles,
                composer: composer, genre: genre, tuneType: type, key: key, modes: modes,
                timeSignature: details.timeSignature, partStructure: details.partStructure, lyrics: details.lyrics,
                tunings: tunings)
            let userTune = UserTune(
                id: "sample_user_tune_\(slug)", createdAt: now, tuneID: tune.id, status: status,
                learnedFrom: details.learnedFrom, learnedOn: details.learnedOn, notes: details.notes,
                archivedAt: archived ? now : nil)
            return Entry(tune: tune, userTune: userTune)
        }

        private static func recording(
            _ name: String, tune: Int?, label: String? = nil, state: String, seconds: Int64?,
            file: LocalFileState?, fileError: String? = nil, minutesAgo: Int64
        ) -> RecordingEntry {
            let id = "sample_recording_\(name)"
            let recordedAt = Timestamp(milliseconds: now.milliseconds - minutesAgo * 60_000)
            let tuneEntry = tune.map { entries[$0] }
            return RecordingEntry(
                recording: Recording(
                    id: id, createdAt: recordedAt, tuneID: tuneEntry?.tune.id, source: "microphone",
                    recordedAt: recordedAt, label: label, state: state, durationMs: seconds.map { $0 * 1000 }),
                file: file.map {
                    RecordingFile(
                        id: id, localState: $0, fileName: "\(id).m4a", contentType: "audio/mp4",
                        bytes: 1_843_200, error: fileError, updatedAt: recordedAt)
                },
                tuneTitle: tuneEntry?.tune.title)
        }
    }
#endif
