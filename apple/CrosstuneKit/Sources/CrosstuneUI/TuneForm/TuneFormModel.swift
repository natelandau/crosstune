import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import GRDB
import Observation
import os

/// The tune form's state: the values being edited, what they were when the form opened, and the
/// save that creates or edits the tune.
///
/// Everything the form decides at open, such as which tuning rows show and the genre a new tune
/// starts in, is read once, so no field appears or disappears while the musician types.
@MainActor
@Observable
public final class TuneFormModel {
    public static let titleRequired = "A title is required"

    /// Where the form stands with its tune.
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
        var instruments: Set<String>
        var editing: (tune: Tune, userTune: UserTune)?
    }

    public let target: TuneFormTarget
    public var values = TuneFormValues()
    public private(set) var phase = Phase.loading
    /// The instruments to show a tuning row for, in the vocabulary's order.
    public private(set) var tuningInstruments: [String] = []
    public private(set) var isSaving = false
    /// Set once a save lands; the form never saves twice, so a second press creates no second tune.
    public private(set) var isSaved = false
    /// The last save's failure, cleared by the next save.
    public private(set) var failure: String?
    /// Shown under the title after a save with none.
    public private(set) var validation: String?

    private let store: CrosstuneStore
    private var opened = TuneFormValues()
    private var storedTunings: JSONObject = [:]
    private var catalog: [Tune] = []
    /// Whether the player has chosen a time signature, which a type then never replaces.
    private var timeSignatureTouched = false
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "tune-form")

    public init(store: CrosstuneStore, target: TuneFormTarget) {
        self.store = store
        self.target = target
    }

    public var isNew: Bool {
        if case .new = target { return true }
        return false
    }

    /// Whether the form holds work a dismissal would lose. A title carried in from a search
    /// counts, since the search that held it is already cleared.
    /// Compared as a save would write it, so a choice that saves nothing, such as Not set on an
    /// empty field, is no edit.
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
    public var typeOptions: [String] { TuneSuggestions.types(genre: values.genre, tunes: catalog) }

    public var composerOptions: [String] { TuneSuggestions.composers(catalog) }

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
        let settings = try UserSettings.fetchOne(db, key: settingsID)
        let instruments = settings.flatMap { $0.deletedAt == nil ? Set($0.instruments) : nil } ?? []
        var editing: (Tune, UserTune)?
        if case .edit(let tuneID, let userTuneID) = target,
            let tune = tunes.first(where: { $0.id == tuneID }),
            let userTune = try UserTune.fetchOne(db, key: userTuneID), userTune.deletedAt == nil
        {
            editing = (tune, userTune)
        }
        return Opening(tunes: tunes, instruments: instruments, editing: editing)
    }

    func open(_ opening: Opening) {
        catalog = opening.tunes
        switch target {
        case .new(let title, _):
            var start = TuneFormValues()
            start.genre = TuneSuggestions.mostUsedGenre(opening.tunes) ?? ""
            opened = start
            // A search has no limit of its own, so a carried title is capped here.
            start.title = String((title ?? "").prefix(Vocabulary.Limits.Tune.title))
            values = start
            tuningInstruments = Self.tuningInstruments(opening.instruments, tunings: [:])
        case .edit:
            guard let (tune, userTune) = opening.editing else {
                phase = .gone
                return
            }
            opened = TuneFormValues(tune: tune, userTune: userTune)
            values = opened
            storedTunings = tune.tunings
            tuningInstruments = Self.tuningInstruments(opening.instruments, tunings: tune.tunings)
        }
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

    /// Sets the type, filling a time signature the player has not chosen.
    public func setType(_ type: String) {
        values.setType(type, isNew: isNew, timeSignatureTouched: timeSignatureTouched)
    }

    public func setTimeSignature(_ timeSignature: String) {
        timeSignatureTouched = true
        values.timeSignature = TuneFormValues.timeSignature(timeSignature)
    }

    /// Creates or edits the tune. The saved tune's id once the save lands; nil when it could not
    /// run or failed, with the reason in ``validation`` or ``failure``.
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
            switch target {
            case .new(_, let listID):
                let created =
                    if let listID {
                        try await commands.createTune(values.tuneInput, userTune: values.userTuneInput, inList: listID)
                    } else {
                        try await commands.createTune(values.tuneInput, userTune: values.userTuneInput)
                    }
                isSaved = true
                return created.tuneID
            case .edit(let tuneID, let userTuneID):
                let patches = values.patches(from: opened, storedTunings: storedTunings)
                try await commands.updateTuneEntry(
                    tuneID: tuneID, userTuneID: userTuneID, tune: patches.tune, userTune: patches.userTune)
                isSaved = true
                return tuneID
            }
        } catch {
            Self.logger.warning("A tune form save failed: \(error)")
            failure = (error as? LocalizedError)?.errorDescription ?? CatalogModel.actionFailed
            return nil
        }
    }
}
