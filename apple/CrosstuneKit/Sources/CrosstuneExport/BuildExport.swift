import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// A recording whose audio this device holds in full.
public struct LocalAudio: Sendable, Hashable {
    public var recordingID: String
    public var fileExtension: String

    public init(recordingID: String, fileExtension: String) {
        self.recordingID = recordingID
        self.fileExtension = fileExtension
    }

    /// The audio stored as `fileName`, named in the archive by its extension, lowercased, or
    /// `audio` when it has none.
    public init(recordingID: String, fileName: String?) {
        let ext = fileName.map { URL(filePath: $0).pathExtension.lowercased() } ?? ""
        self.init(recordingID: recordingID, fileExtension: ext.isEmpty ? "audio" : ext)
    }
}

public struct ExportInput: Sendable {
    public var timeZone: TimeZone
    public var instruments: [String]
    public var tunes: [Tune]
    public var userTunes: [UserTune]
    public var lists: [TuneList]
    public var listItems: [ListItem]
    public var links: [RecordingLink]
    public var recordings: [Recording]
    public var localAudio: [LocalAudio]

    public init(
        timeZone: TimeZone, instruments: [String], tunes: [Tune], userTunes: [UserTune], lists: [TuneList],
        listItems: [ListItem], links: [RecordingLink], recordings: [Recording], localAudio: [LocalAudio]
    ) {
        self.timeZone = timeZone
        self.instruments = instruments
        self.tunes = tunes
        self.userTunes = userTunes
        self.lists = lists
        self.listItems = listItems
        self.links = links
        self.recordings = recordings
        self.localAudio = localAudio
    }
}

public struct ExportPlan: Sendable {
    public var tunesCSV: String
    public var listsCSV: String
    /// Every exported recording with its archive path, in archive order.
    public var audio: [(recordingID: String, path: String)]
    /// Recordings not deleted, exported or not.
    public var totalRecordings: Int
}

public let tunesHeader = [
    "title", "alternate_titles", "status", "archived_on", "key", "modes", "tune_type", "genre", "time_signature",
    "part_structure", "crooked", "composer", "tunings", "learned_from", "learned_on", "notes", "lyrics", "links",
    "recordings", "added_on",
]

public let listsHeader = ["list", "position", "tune"]

private let unfiled = "Unfiled"

private let english = Locale(identifier: "en")

/// The display label, or the value as stored when it comes from a newer vocabulary.
private func label(_ labels: [String: String], _ value: String) -> String {
    labels[value].flatMap { $0.isEmpty ? nil : $0 } ?? value
}

/// As JavaScript's `String.fromCharCode(65 + index)`: the code wraps to 16 bits, and a lone
/// surrogate, which UTF-8 cannot hold, becomes U+FFFD as the web client's encoder writes it.
private func partLetter(_ index: Int) -> String {
    let code = UInt32(truncatingIfNeeded: 65 &+ index) & 0xFFFF
    return String(UnicodeScalar(code) ?? "\u{FFFD}")
}

/// `YYYY-MM-DD` for each instant, as a clock in the time zone shows it.
struct DateText {
    private let formatter: DateFormatter

    init(timeZone: TimeZone) {
        formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
    }

    func callAsFunction(_ timestamp: Timestamp) -> String {
        callAsFunction(timestamp.date)
    }

    func callAsFunction(_ date: Date) -> String {
        formatter.string(from: date)
    }
}

/// Plain UTF-16 code-unit order, as JavaScript compares strings, so every client breaks a tie
/// the same way whatever its locale. Swift's `<` compares Unicode scalars, which can differ.
private func codeUnitsAscending(_ a: String, _ b: String) -> Bool {
    a.utf16.lexicographicallyPrecedes(b.utf16)
}

extension Array {
    /// Sorted by `areInIncreasingOrder`, with ties kept in their original order as JavaScript's
    /// stable sort keeps them.
    fileprivate func stablySorted(by areInIncreasingOrder: (Element, Element) -> Bool) -> [Element] {
        enumerated().sorted { a, b in
            if areInIncreasingOrder(a.element, b.element) { return true }
            if areInIncreasingOrder(b.element, a.element) { return false }
            return a.offset < b.offset
        }.map(\.element)
    }
}

/// Ascending by `position`, then by id code units, since each client reads rows back in its own
/// storage order.
private func byPosition<Row: Identifiable>(_ a: Row, _ b: Row, position: (Row) -> Int) -> Bool
where Row.ID == String {
    position(a) != position(b) ? position(a) < position(b) : codeUnitsAscending(a.id, b.id)
}

/// Groups in first-seen order, each keeping its rows' order.
private func grouped<Row, Key: Hashable>(_ rows: some Sequence<Row>, by key: (Row) -> Key) -> [Key: [Row]] {
    var groups: [Key: [Row]] = [:]
    for row in rows { groups[key(row), default: []].append(row) }
    return groups
}

private struct ExportedTune {
    let tune: Tune
    let userTune: UserTune
}

/// Every user-tune not deleted whose tune is present, in the CSV's order.
private func exportedTunes(_ input: ExportInput) -> [ExportedTune] {
    let tunesByID = Dictionary(input.tunes.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    return input.userTunes
        .compactMap { userTune -> ExportedTune? in
            guard userTune.deletedAt == nil, let tune = tunesByID[userTune.tuneID], tune.deletedAt == nil else {
                return nil
            }
            return ExportedTune(tune: tune, userTune: userTune)
        }
        .stablySorted { a, b in
            switch a.tune.title.compare(
                b.tune.title, options: [.caseInsensitive, .diacriticInsensitive, .numeric], locale: english)
            {
            case .orderedAscending: return true
            case .orderedDescending: return false
            case .orderedSame: break
            }
            if a.userTune.createdAt != b.userTune.createdAt { return a.userTune.createdAt < b.userTune.createdAt }
            return codeUnitsAscending(a.userTune.id, b.userTune.id)
        }
}

/// Archive paths for every exported recording: tune folders in tune order, then `Unfiled`.
/// Folder and file names are allocated in that same order, so a collision suffix follows the
/// order the app shows.
private func planAudio(_ input: ExportInput, tunes: [ExportedTune], dateText: DateText) -> (
    audio: [(recordingID: String, path: String)], pathsByTune: [String: [String]]
) {
    let audioByID = Dictionary(input.localAudio.map { ($0.recordingID, $0) }, uniquingKeysWith: { _, last in last })
    let filedTuneIDs = Set(tunes.map(\.tune.id))
    let groups = grouped(input.recordings.filter { $0.deletedAt == nil && audioByID[$0.id] != nil }) {
        recording -> String? in
        recording.tuneID.flatMap { filedTuneIDs.contains($0) ? $0 : nil }
    }

    var audio: [(recordingID: String, path: String)] = []
    var pathsByTune: [String: [String]] = [:]

    func addFolder(_ folder: String, _ recordings: [Recording]) -> [String] {
        var files = NameAllocator()
        let ordered = recordings.stablySorted { a, b in
            if a.position != b.position { return a.position < b.position }
            if a.recordedAt != b.recordedAt { return a.recordedAt < b.recordedAt }
            return codeUnitsAscending(a.id, b.id)
        }
        return ordered.map { recording in
            let date = dateText(recording.recordedAt)
            let stem = recording.label.flatMap { $0.isEmpty ? nil : "\(date) \($0)" } ?? date
            let ext = audioByID[recording.id].flatMap { $0.fileExtension.isEmpty ? nil : $0.fileExtension } ?? "audio"
            let path = "recordings/\(folder)/\(files.take(stem, ext: ext))"
            audio.append((recordingID: recording.id, path: path))
            return path
        }
    }

    var folders = NameAllocator(reserving: [unfiled])
    for exported in tunes {
        let id = exported.tune.id
        if let recordings = groups[id], pathsByTune[id] == nil {
            pathsByTune[id] = addFolder(folders.take(exported.tune.title), recordings)
        }
    }
    if let recordings = groups[nil] { _ = addFolder(unfiled, recordings) }
    return (audio, pathsByTune)
}

private func tuningsText(_ tune: Tune, instruments: [String]) -> String {
    let chosen = Set(instruments.filter(Vocabulary.instruments.contains))
    return Vocabulary.instruments
        .filter { chosen.isEmpty || chosen.contains($0) }
        .compactMap { tuningDisplay(tune.tunings, instrument: $0, withInstrument: true) }
        .joined(separator: "; ")
}

private func listRows(_ input: ExportInput, tunes: [ExportedTune]) -> [[String]] {
    let titles = Dictionary(tunes.map { ($0.userTune.id, $0.tune.title) }, uniquingKeysWith: { _, last in last })
    let itemsByList = grouped(input.listItems.filter { $0.deletedAt == nil && titles[$0.userTuneID] != nil }) {
        $0.listID
    }
    return input.lists
        .filter { $0.deletedAt == nil }
        .stablySorted { byPosition($0, $1, position: \.position) }
        .flatMap { list -> [[String]] in
            let items = (itemsByList[list.id] ?? []).stablySorted { byPosition($0, $1, position: \.position) }
            if items.isEmpty { return [[list.name, "", ""]] }
            return items.enumerated().map { index, item in
                [list.name, String(index + 1), titles[item.userTuneID] ?? ""]
            }
        }
}

/// Both CSV documents and the archive path of every exported recording.
public func buildExport(_ input: ExportInput) -> ExportPlan {
    let dateText = DateText(timeZone: input.timeZone)
    let tunes = exportedTunes(input)
    let (audio, pathsByTune) = planAudio(input, tunes: tunes, dateText: dateText)
    let linksByTune = grouped(input.links.filter { $0.deletedAt == nil }) { $0.tuneID }

    let tuneRows = tunes.map { exported -> [String] in
        let (tune, userTune) = (exported.tune, exported.userTune)
        return [
            tune.title,
            tune.alternateTitles.joined(separator: "; "),
            label(Vocabulary.statusLabels, userTune.status),
            userTune.archivedAt.map { dateText($0) } ?? "",
            tune.key ?? "",
            tune.modes.enumerated().map { "\(partLetter($0)): \(label(Vocabulary.modeLabels, $1))" }
                .joined(separator: "; "),
            tune.tuneType ?? "",
            tune.genre ?? "",
            tune.timeSignature ?? "",
            tune.partStructure ?? "",
            tune.isCrooked ? "yes" : "",
            tune.composer ?? "",
            tuningsText(tune, instruments: input.instruments),
            userTune.learnedFrom ?? "",
            userTune.learnedOn ?? "",
            userTune.notes ?? "",
            tune.lyrics ?? "",
            (linksByTune[tune.id] ?? []).stablySorted { byPosition($0, $1, position: \.position) }.map(\.url)
                .joined(separator: "\n"),
            (pathsByTune[tune.id] ?? []).joined(separator: "\n"),
            dateText(userTune.createdAt),
        ]
    }

    return ExportPlan(
        tunesCSV: csvDocument([tunesHeader] + tuneRows),
        listsCSV: csvDocument([listsHeader] + listRows(input, tunes: tunes)),
        audio: audio,
        totalRecordings: input.recordings.count { $0.deletedAt == nil })
}
