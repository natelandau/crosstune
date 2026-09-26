import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import Observation
import os

/// The reading view's state: the tune's title and words, read live so an edit made elsewhere
/// while the view is up reaches the page, and the one write the Edit lyrics sheet makes.
@MainActor
@Observable
final class LyricsReaderModel {
    enum Phase: Equatable {
        /// Nothing read yet, which the view shows as silence.
        case loading
        case shown(title: String, lyrics: String?)
        /// The tune is not in the catalog, or was deleted while this view was up.
        case gone
    }

    let tuneID: String
    private(set) var isSaving = false
    /// The last save's failure, cleared by the next save.
    private(set) var failure: String?

    private let store: CrosstuneStore
    private let query: LiveQuery<Tune??>
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "lyrics-reader")

    init(store: CrosstuneStore, tuneID: String) {
        self.store = store
        self.tuneID = tuneID
        query = LiveQuery(store, initial: nil) { db in
            .some(try Tune.fetchOne(db, key: tuneID))
        }
    }

    var phase: Phase {
        switch query.value {
        case nil: .loading
        case .some(nil): .gone
        case .some(.some(let tune)): .shown(title: tune.title, lyrics: tune.lyrics)
        }
    }

    /// Writes only the lyrics field, the way the web's reading view does. True once the write
    /// lands, with the reason in ``failure`` when it does not.
    @discardableResult
    func save(_ lyrics: String) async -> Bool {
        let body = lyrics.trimmingCharacters(in: .whitespacesAndNewlines)
        failure = nil
        isSaving = true
        defer { isSaving = false }
        do {
            try await Commands(store: store).updateTune(
                tuneID, patch: TunePatch(lyrics: .value(body.isEmpty ? nil : body)))
            return true
        } catch {
            Self.logger.warning("A lyrics save failed: \(error)")
            failure = (error as? LocalizedError)?.errorDescription ?? CatalogModel.actionFailed
            return false
        }
    }
}
