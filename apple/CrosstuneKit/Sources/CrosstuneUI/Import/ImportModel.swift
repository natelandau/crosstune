import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import GRDB
import Observation
import os

/// One import, from the pasted or opened text through the review to the write. Add writes every
/// checked row with a title in one transaction.
@MainActor
@Observable
public final class ImportModel {
    public enum Step: Equatable, Sendable {
        case paste
        case review
    }

    /// The list picker's choices. The new list's name is held apart, so switching away and back
    /// keeps what was typed.
    public enum ListKey: Hashable, Sendable {
        case none
        case new
        case existing(String)
    }

    public struct ListOption: Hashable, Sendable, Identifiable {
        public let id: String
        public let name: String
    }

    /// What the sheet reads from the store as it opens.
    struct Opening: Sendable {
        var status: String
        var genre: String
        var lists: [ListOption]
    }

    public var step = Step.paste
    public var text = ""
    public private(set) var review: ImportReview?
    public var status = UserSettings.defaultNewTuneStatus
    public var genre = ""
    public var listKey = ListKey.none
    public var listName: String
    public private(set) var lists: [ListOption] = []
    /// True once the settings and lists are read, which Continue waits for.
    public private(set) var isLoaded = false
    public private(set) var isReadingFile = false
    /// True while Continue reads the catalog, so a second press cannot build a second review.
    public private(set) var isReviewing = false
    public private(set) var isAdding = false
    /// Whether Add takes presses. The review arms it a moment after it shows, since Add takes
    /// Continue's place and the second tap of a double tap on Continue would land on it.
    public private(set) var isAddArmed = false
    /// The last file read's or add's failure, cleared by the next try.
    public var failure: String?

    private let store: CrosstuneStore
    private let analytics: AnalyticsClient
    private let entry: ImportEntry
    /// Reads a picked file's bytes, off the main actor. A test can hold a read open.
    var readFile: @Sendable (URL) async throws -> Data = { try Data(contentsOf: $0) }
    /// Every live tune's titles, folded, which an edited title is checked against. Read at Continue.
    private var catalogTitles: Set<FoldedText> = []
    /// The text the review was read from, so Continue on the same text keeps the musician's edits.
    private var reviewedText: String?
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "import")

    public init(store: CrosstuneStore, analytics: AnalyticsClient, entry: ImportEntry) {
        self.store = store
        self.analytics = analytics
        self.entry = entry
        listName = ImportCopy.listName(on: .now)
    }

    /// Where the checked rows go, as Add writes it.
    public var list: ImportListChoice {
        get {
            switch listKey {
            case .none: .none
            case .new: .new(name: listName.trimmingCharacters(in: .whitespacesAndNewlines))
            case .existing(let id): .existing(listID: id)
            }
        }
        set {
            switch newValue {
            case .none: listKey = .none
            case .new(let name):
                listKey = .new
                listName = name
            case .existing(let id): listKey = .existing(id)
            }
        }
    }

    private var typed: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Whether the sheet holds work a dismissal would lose.
    public var isEdited: Bool { typed }

    /// A file still being read would replace the text behind the review.
    public var canContinue: Bool { step == .paste && isLoaded && typed && !isReadingFile && !isReviewing }

    /// A file opened while Continue reads would replace the text behind the review.
    public var canOpenFile: Bool { !isReadingFile && !isReviewing }

    /// The rows Add would create: checked, with a title.
    public var count: Int { review?.rows.count(where: Self.adds) ?? 0 }

    public var addLabel: String { ImportCopy.addTunes(count) }

    public var canAdd: Bool {
        guard step == .review, isAddArmed, count > 0, !isAdding else { return false }
        if case .new(let name) = list { return !name.isEmpty }
        return true
    }

    /// Whether the review shows the help: nothing was read, or the paste likely held more than
    /// the reader could use.
    public var showsHelp: Bool {
        guard let review else { return false }
        return review.rows.isEmpty || review.suggestsHelp
    }

    private static func adds(_ row: ImportRow) -> Bool {
        row.included && !row.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Reads the settings and lists the review starts from, and reports the opening. Runs once.
    public func load() async {
        guard !isLoaded else { return }
        analytics.send(.importStarted(entry: entry))
        let settingsRow = settingsID(clerkUserID: store.userID)
        do {
            let opening = try await store.read { db in try Self.read(db, settingsID: settingsRow) }
            status = opening.status
            genre = opening.genre
            lists = opening.lists
        } catch {
            Self.logger.warning("The import could not read its settings: \(error)")
        }
        isLoaded = true
    }

    nonisolated static func read(_ db: Database, settingsID: String) throws -> Opening {
        let settings = try UserSettings.fetchOne(db, key: settingsID)
        let lists = activeByPosition(try TuneList.fetchAll(db)).map { ListOption(id: $0.id, name: $0.name) }
        return Opening(
            status: storedNewTuneStatus(settings),
            genre: storedNewTuneGenre(settings)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            lists: lists)
    }

    /// Replaces the text with a picked file's, and refuses a file that is not `.txt`.
    public func load(file url: URL) async {
        guard canOpenFile else { return }
        guard Self.isTextFile(url) else {
            failure = ImportCopy.textFilesOnly
            return
        }
        isReadingFile = true
        failure = nil
        defer { isReadingFile = false }
        do {
            let readFile = readFile
            text = try await Task.detached {
                // A file from the picker is outside the app's sandbox until access is asked for.
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                return ImportText.decode(try await readFile(url))
            }.value
        } catch {
            Self.logger.warning("The import could not read a file: \(error)")
            failure = failureMessage(error)
        }
    }

    /// Replaces the text with the first dropped `.txt` file's, and refuses any other file.
    public func load(dropped urls: [URL]) async {
        guard canOpenFile else { return }
        guard let url = urls.first(where: Self.isTextFile) else {
            failure = ImportCopy.textFilesOnly
            return
        }
        await load(file: url)
    }

    /// A `.txt` file, as the help and the refusal name. Other plain text, such as a spreadsheet's
    /// `.csv`, is a format a reader of its own will take.
    nonisolated static func isTextFile(_ url: URL) -> Bool {
        url.pathExtension.lowercased() == "txt"
    }

    /// Reads the text into review rows, checked against the catalog as it is now. The same text
    /// as the last review keeps that review's rows, with their edits and checks, and checks only
    /// their duplicate notes again.
    public func continueToReview() async {
        guard canContinue else { return }
        isReviewing = true
        defer { isReviewing = false }
        let catalog: [Tune]
        do {
            catalog = try await store.read { db in try Self.catalog(db) }
        } catch {
            Self.logger.warning("The import could not read the catalog: \(error)")
            failure = failureMessage(error)
            return
        }
        catalogTitles = foldedTitles(catalog)
        if text == reviewedText, let rows = review?.rows {
            review?.rows = ImportReviewBuilder.markDuplicates(rows, catalog: catalog)
            failure = nil
            showReview()
            return
        }
        let built = ImportReviewBuilder.build(PlainListReader.read(text), catalog: catalog)
        review = built
        reviewedText = text
        failure = nil
        showReview()
        analytics.send(
            .importReviewed(
                reader: .plain, count: built.rows.count, duplicates: built.rows.count(where: \.duplicate),
                hasWarnings: built.rows.contains { !$0.warnings.isEmpty }))
    }

    /// Every tune the musician holds, archived included: live, with a live user tune.
    nonisolated static func catalog(_ db: Database) throws -> [Tune] {
        let held = Set(try UserTune.filter(UserTune.CodingKeys.deletedAt == nil).fetchAll(db).map(\.tuneID))
        return try Tune.filter(Tune.CodingKeys.deletedAt == nil).fetchAll(db).filter { held.contains($0.id) }
    }

    private func showReview() {
        isAddArmed = false
        step = .review
    }

    /// Lets Add take presses, once the review has shown long enough that a press is meant for it.
    public func armAdd() {
        guard step == .review else { return }
        isAddArmed = true
    }

    /// Back to the text. Continue reads it again only if it changed.
    public func back() {
        guard !isAdding else { return }
        step = .paste
        isAddArmed = false
        failure = nil
    }

    /// Edits a row's title. The duplicate note follows the catalog, but the check stays as the
    /// musician left it, and the shortened note goes, since the title is no longer the one cut.
    public func setTitle(_ title: String, row id: Int) {
        guard let index = review?.rows.firstIndex(where: { $0.id == id }) else { return }
        review?.rows[index].title = title
        review?.rows[index].duplicate = ImportReviewBuilder.isDuplicate(title, titles: catalogTitles)
        review?.rows[index].warnings = []
    }

    public func setIncluded(_ included: Bool, row id: Int) {
        guard let index = review?.rows.firstIndex(where: { $0.id == id }) else { return }
        review?.rows[index].included = included
    }

    /// Adds every checked row with a title, and returns how many tunes it added.
    public func add() async throws -> Int {
        guard canAdd, let rows = review?.rows else { return 0 }
        let titles = rows.filter(Self.adds).map { $0.title.trimmingCharacters(in: .whitespacesAndNewlines) }
        let list = list
        let trimmedGenre = genre.trimmingCharacters(in: .whitespacesAndNewlines)
        let plan = ImportPlan(
            titles: titles, status: status, genre: trimmedGenre.isEmpty ? nil : trimmedGenre, list: list)
        isAdding = true
        failure = nil
        defer { isAdding = false }
        let result: ImportResult
        do {
            result = try await Commands(store: store).importTunes(plan)
        } catch {
            Self.logger.warning("An import failed: \(error)")
            failure = failureMessage(error)
            throw error
        }
        let added = result.userTuneIDs.count
        if let listID = result.listID {
            analytics.send(
                result.listCreated
                    ? .listCreated(listID: listID, count: added) : .tunesAddedToList(listID: listID, count: added))
        }
        analytics.send(
            .importCompleted(reader: .plain, added: added, skipped: rows.count - titles.count, list: Self.kind(list)))
        return added
    }

    private static func kind(_ list: ImportListChoice) -> ImportList {
        switch list {
        case .none: .none
        case .new: .new
        case .existing: .existing
        }
    }
}
