import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import GRDB

/// A recording of the tune with this device's file for it, if any.
public struct TuneRecording: Hashable, Sendable, Identifiable {
    public let recording: Recording
    public let file: RecordingFile?

    public var id: String { recording.id }
}

/// A list the tune is in, with the entry that puts it there.
public struct TuneMembership: Hashable, Sendable, Identifiable {
    public let list: TuneList
    public let itemID: String

    public var id: String { list.id }
}

/// Everything the tune screen shows about one tune, read in one pass so it never shows a tune
/// beside another moment's links or recordings.
public struct TuneDetail: Hashable, Sendable {
    public static let crooked = "Crooked"

    public let tune: Tune
    public let userTune: UserTune
    /// The tune's links, in position order.
    public let links: [RecordingLink]
    /// The tune's recordings, in position order.
    public let recordings: [TuneRecording]
    /// The lists the tune is in, in the musician's order.
    public let lists: [TuneMembership]
    /// The instruments the musician plays.
    public let instruments: Set<String>
    /// The music services the musician searches for recordings, in the order they list.
    public let searchProviders: [String]

    public init(
        tune: Tune, userTune: UserTune, links: [RecordingLink] = [], recordings: [TuneRecording] = [],
        lists: [TuneMembership] = [], instruments: Set<String> = [], searchProviders: [String] = searchableProviders
    ) {
        self.tune = tune
        self.userTune = userTune
        self.links = links
        self.recordings = recordings
        self.lists = lists
        self.instruments = instruments
        self.searchProviders = searchProviders
    }

    public var isArchived: Bool { userTune.archivedAt != nil }

    /// Every tuning the tune holds for an instrument the musician plays or one it holds a value
    /// for, standard included, each naming its instrument: two instruments can share a tuning's
    /// name.
    public var tunings: [String] {
        Vocabulary.instruments.compactMap { instrument in
            let entry = tuningEntry(tune.tunings, instrument: instrument)
            guard instruments.contains(instrument) || entry.tuning != nil || entry.capo != nil else { return nil }
            return tuningDisplay(tune.tunings, instrument: instrument, withInstrument: true)
        }
    }

    /// The tune's other names, joined, or nil when it has none.
    public var alternateTitles: String? {
        tune.alternateTitles.isEmpty ? nil : tune.alternateTitles.joined(separator: ", ")
    }

    /// Whether the lyrics hold words: whitespace alone would open the reading view on a blank page.
    public var hasLyrics: Bool {
        !LyricLines.lines(tune.lyrics).isEmpty
    }

    /// The musician's notes, or nil when they hold only whitespace.
    public var notes: String? {
        Self.present(userTune.notes)
    }

    /// "Learned from Tommy Jarrell on Mar 4, 2024", either half left out when unset or empty, or
    /// nil when both are.
    public func learned(locale: Locale = .current) -> String? {
        let from = Self.present(userTune.learnedFrom)
        let on = Self.present(userTune.learnedOn)
        guard from != nil || on != nil else { return nil }
        var text = "Learned"
        if let from { text += " from \(from)" }
        if let on { text += " on \(Self.learnedOn(on, locale: locale))" }
        return text
    }

    private static func present(_ value: String?) -> String? {
        guard let value, value.contains(where: { !$0.isWhitespace }) else { return nil }
        return value
    }

    /// A stored `YYYY-MM-DD` as a date, read as a local calendar day so no time zone moves it.
    /// Anything else shows as stored.
    static func learnedOn(_ value: String, locale: Locale) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        guard let date = CalendarDay.date(value, calendar: calendar) else { return value }
        return date.formatted(
            Date.FormatStyle(locale: locale, calendar: calendar, timeZone: .gmt).month(.abbreviated).day().year())
    }

    /// The delete confirmation's message.
    public var deleteMessage: String {
        DeleteTuneMessage.one(title: tune.title, files: recordings.map(\.file))
    }

    /// A tune's rows with the musician's own before imported ones, each in the order given.
    nonisolated static func ownFirst(_ recordings: [TuneRecording]) -> [TuneRecording] {
        let isOwn = { (row: TuneRecording) in row.recording.origin == RecordingText.ownOrigin }
        return recordings.filter(isOwn) + recordings.filter { !isOwn($0) }
    }

    /// The tune `tuneID` with everything its screen shows, or nil when it is gone.
    nonisolated static func fetch(_ db: Database, tuneID: String, settingsID: String) throws -> TuneDetail? {
        guard let tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil,
            let userTune = try UserTune.filter(UserTune.CodingKeys.tuneID == tuneID)
                .filter(UserTune.CodingKeys.deletedAt == nil).fetchOne(db)
        else { return nil }
        let links = activeByPosition(
            try RecordingLink.filter(RecordingLink.CodingKeys.tuneID == tuneID).fetchAll(db))
        let recordings = activeByPosition(try Recording.filter(Recording.CodingKeys.tuneID == tuneID).fetchAll(db))
        let files = try RecordingFile.fetchAll(db, keys: recordings.map(\.id))
        let fileByID = Dictionary(files.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let items = try ListItem.filter(ListItem.CodingKeys.userTuneID == userTune.id)
            .filter(ListItem.CodingKeys.deletedAt == nil).fetchAll(db)
        let itemByList = Dictionary(items.map { ($0.listID, $0.id) }, uniquingKeysWith: { first, _ in first })
        let lists = activeByPosition(try TuneList.fetchAll(db, keys: Array(itemByList.keys)))
        let settings = try UserSettings.fetchOne(db, key: settingsID)
        return TuneDetail(
            tune: tune, userTune: userTune, links: links,
            recordings: ownFirst(recordings.map { TuneRecording(recording: $0, file: fileByID[$0.id]) }),
            lists: lists.compactMap { list in
                itemByList[list.id].map { TuneMembership(list: list, itemID: $0) }
            },
            instruments: settings?.deletedAt == nil ? Set(settings?.instruments ?? []) : [],
            searchProviders: chosenSearchProviders(settings))
    }
}

/// The delete confirmation's words, which name what else goes with the tune and warn when a
/// recording that goes has not reached the server.
public enum DeleteTuneMessage {
    public static let title = "Delete tune?"
    public static let delete = "Delete"
    public static let deleting = "Deleting…"
    static let notUploaded = "Some recordings have not uploaded, so they cannot be recovered."

    /// `Delete "Soldier's Joy"? This removes its links and list entries.` `files` holds each
    /// recording's local file, nil where this device has none.
    public static func one(title: String, files: [RecordingFile?]) -> String {
        message(subject: "\"\(title)\"", possessive: "its", files: files)
    }

    /// The same for a selection, whose subject counts it: "Delete 12 tunes? This removes their…"
    public static func many(subject: String, files: [RecordingFile?]) -> String {
        message(subject: subject, possessive: "their", files: files)
    }

    private static func message(subject: String, possessive: String, files: [RecordingFile?]) -> String {
        let count = files.count
        let removed =
            count == 0
            ? "\(possessive) links and list entries"
            : "\(possessive) links, list entries, and \(count) \(count == 1 ? "recording" : "recordings")"
        let text = "Delete \(subject)? This removes \(removed)."
        return files.contains(where: { $0?.localState.isNotUploaded == true }) ? "\(text) \(notUploaded)" : text
    }
}
