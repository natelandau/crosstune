import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import GRDB
import Observation
import os

/// The tune form's state: the values being edited, what they were when the form opened, and the
/// save that edits the tune.
///
/// Everything the form decides at open, such as which tuning rows show, is read once, so no field
/// appears or disappears while the musician types.
@MainActor
@Observable
public final class TuneFormModel {
    nonisolated public static let titleRequired = "A title is required"

    /// The form's progress with its tune.
    public enum Phase: Equatable {
        /// Nothing read yet, which the sheet shows as silence.
        case loading
        case ready
        /// The tune to edit is not in the catalog.
        case gone
        /// The store could not be read.
        case failed
    }

    /// What the form reads from the store as it opens.
    struct Opening: Sendable {
        var tunes: [Tune]
        var userTunes: [UserTune]
        var instruments: Set<String>
        var editing: (tune: Tune, userTune: UserTune)?
    }

    public let target: TuneFormTarget
    public var values = TuneFormValues()
    public private(set) var phase = Phase.loading
    /// The instruments to show a tuning row for, in the vocabulary's order.
    public private(set) var tuningInstruments: [String] = []
    public private(set) var isSaving = false
    /// Set once a save lands; the form never saves twice.
    public private(set) var isSaved = false
    /// The last save's failure, cleared by the next save.
    public private(set) var failure: String?
    /// Shown under the title after a save with none.
    public private(set) var validation: String?

    private let store: CrosstuneStore
    private let analytics: AnalyticsClient
    private var opened = TuneFormValues()
    private var storedTunings: JSONObject = [:]
    /// The catalog's types by use, counted once when the form opens.
    private var catalogTypes: [String] = []
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "tune-form")

    public init(store: CrosstuneStore, target: TuneFormTarget, analytics: AnalyticsClient = .noop) {
        self.store = store
        self.target = target
        self.analytics = analytics
    }

    /// Whether the form holds work a dismissal would lose. Compared as a save would write it, so a
    /// choice that saves nothing, such as Not set on an empty field, is no edit.
    public var isEdited: Bool {
        let (tune, userTune) = values.patches(from: opened, storedTunings: storedTunings)
        return !tune.isEmpty || !userTune.isEmpty
    }

    /// Whether the primary action can run: nothing pending, and a title to save.
    public var canSave: Bool {
        phase == .ready && !isSaving && !isSaved
            && !values.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Type suggestions for the genre the form holds.
    public var typeOptions: [String] { TuneSuggestions.types(genre: values.genre, catalogTypes: catalogTypes) }

    /// Counted when the form opens rather than on each read, since every keystroke redraws the
    /// form and the count walks the whole catalog.
    public private(set) var composerOptions: [String] = []

    public private(set) var learnedFromOptions: [String] = []

    /// Reads what the form opens on. Runs once.
    public func load() async {
        guard phase == .loading else { return }
        let target = target
        let settingsRow = settingsID(clerkUserID: store.userID)
        do {
            let opening = try await store.read { db in try Self.read(db, target: target, settingsID: settingsRow) }
            open(opening)
        } catch {
            Self.logger.warning("The tune form could not read its tune: \(error)")
            phase = .failed
        }
    }

    nonisolated static func read(_ db: Database, target: TuneFormTarget, settingsID: String) throws -> Opening {
        let tunes = try Tune.filter(Tune.CodingKeys.deletedAt == nil).fetchAll(db)
        let userTunes = try UserTune.filter(UserTune.CodingKeys.deletedAt == nil).fetchAll(db)
        let settings = try UserSettings.fetchOne(db, key: settingsID)
        let instruments = settings.flatMap { $0.deletedAt == nil ? Set($0.instruments) : nil } ?? []
        var editing: (Tune, UserTune)?
        if let tune = tunes.first(where: { $0.id == target.tuneID }),
            let userTune = try UserTune.fetchOne(db, key: target.userTuneID), userTune.deletedAt == nil
        {
            editing = (tune, userTune)
        }
        return Opening(tunes: tunes, userTunes: userTunes, instruments: instruments, editing: editing)
    }

    func open(_ opening: Opening) {
        // Live user tunes joined to live tunes, as the web reads the suggestions.
        let catalog = CatalogSearch.entries(tunes: opening.tunes, userTunes: opening.userTunes)
        catalogTypes = TuneSuggestions.catalogTypes(catalog.map(\.tune))
        composerOptions = TuneSuggestions.composers(catalog.map(\.tune))
        learnedFromOptions = TuneSuggestions.learnedFrom(catalog.map(\.userTune))
        guard let (tune, userTune) = opening.editing else {
            phase = .gone
            return
        }
        opened = TuneFormValues(tune: tune, userTune: userTune)
        values = opened
        storedTunings = tune.tunings
        tuningInstruments = Self.tuningInstruments(opening.instruments, tunings: tune.tunings)
        phase = .ready
    }

    /// Every played instrument, plus any the tune already holds a tuning or capo for, so a value
    /// never becomes unreachable.
    nonisolated static func tuningInstruments(_ instruments: Set<String>, tunings: JSONObject) -> [String] {
        Vocabulary.instruments.filter { instrument in
            if instruments.contains(instrument) { return true }
            let entry = tuningEntry(tunings, instrument: instrument)
            return entry.tuning != nil || entry.capo != nil
        }
    }

    public func setTitle(_ title: String) {
        values.title = title
        validation = nil
    }

    /// Sets the type, filling a time signature the tune lacks.
    public func setType(_ type: String) {
        values.setType(type)
    }

    public func setTimeSignature(_ timeSignature: String) {
        values.timeSignature = TuneFormValues.timeSignature(timeSignature)
    }

    /// Saves the edit. The tune's id once the save lands; nil when it could not run or failed,
    /// with the reason in ``validation`` or ``failure``.
    public func save() async -> String? {
        guard phase == .ready, !isSaving, !isSaved else { return nil }
        guard canSave else {
            failure = nil
            validation = Self.titleRequired
            return nil
        }
        isSaving = true
        failure = nil
        validation = nil
        defer { isSaving = false }
        let commands = Commands(store: store)
        do {
            let patches = values.patches(from: opened, storedTunings: storedTunings)
            try await commands.updateTuneEntry(
                tuneID: target.tuneID, userTuneID: target.userTuneID, tune: patches.tune, userTune: patches.userTune)
            isSaved = true
            reportEdit(
                analytics: analytics, before: opened, after: values, storedTunings: storedTunings,
                tuneID: target.tuneID)
            return target.tuneID
        } catch {
            Self.logger.warning("A tune form save failed: \(error)")
            failure = failureMessage(error)
            return nil
        }
    }
}
