import CrosstuneVocabulary
import Foundation
import Observation
import os

/// The share extension's sheet: a link waiting for its tune, or audio files checked and saved.
@MainActor @Observable
public final class ShareSheetModel {
    public enum State: Equatable {
        case signedOut
        /// What was shared is still being read.
        case loading
        case nothingToShare
        case link(url: String, title: String?)
        /// Audio files are being checked and saved.
        case audio
        case saved(String)
        /// Each refused file's reason. When a file failed to save, how many did save first, and
        /// ``ShareText/saveFailed`` last.
        case refused([String])
    }

    /// The most audio files one share takes, the same limit as the extension's activation rule.
    nonisolated public static let maxAudioFiles = 20

    public var state: State
    public var query = "" {
        didSet { updateResults() }
    }
    /// The tune the link saves to, nil until one is chosen.
    public var choice: ShareChoice?
    /// The tunes whose titles match the search, including tunes made by shares the app has not
    /// added yet.
    public private(set) var results: [ShareTuneEntry]
    /// Set when the link failed to save, so the sheet stays open to try again.
    public private(set) var failure: String?

    private let container: ShareContainer
    /// The user signed in when the sheet opened, whose inbox every save goes to.
    public let userID: String?
    private let now: () -> Date
    private var search = TuneSearch([])
    nonisolated private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "share-sheet")

    public init(container: ShareContainer, now: @escaping () -> Date = Date.init) {
        self.container = container
        self.now = now
        let userID = container.currentUserID()
        self.userID = userID
        state = userID == nil ? .signedOut : .loading
        results = []
    }

    /// Reads the tunes to search, which only a link needs. Empty until this finishes.
    public func loadTunes() async {
        guard let userID else { return }
        search = await Self.readTunes(userID: userID, in: container)
        updateResults()
    }

    private func updateResults() {
        results = search.results(query)
        // A choice the search no longer shows would save to a tune out of view.
        switch choice {
        case .newTune where !offersCreate: choice = nil
        case .tune(let tune) where !results.contains(tune): choice = nil
        default: break
        }
    }

    /// Off the main actor, since a large library takes a while to read and fold.
    @concurrent
    private static func readTunes(userID: String, in container: ShareContainer) async -> TuneSearch {
        let listed = ShareTuneList.read(userID: userID, in: container)
        let listedIDs = Set(listed.map(\.id))
        let pending = ShareInbox.pendingNewTunes(userID: userID, in: container).filter { !listedIDs.contains($0.id) }
        return TuneSearch(listed + pending)
    }

    public var offersCreate: Bool { TuneSearch.offersCreate(query) }

    /// Takes a shared link, unless it is not one the app stores, such as a link to another
    /// app or one over the API's length limit. Returns whether it was taken.
    @discardableResult
    public func received(url: String, title: String?) -> Bool {
        guard userID != nil else { return false }
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard WebLink.isStorable(trimmed) else { return false }
        state = .link(url: trimmed, title: title)
        return true
    }

    /// Starts an audio share of `count` files, or refuses all of them when there are more than
    /// ``maxAudioFiles``. Returns whether to read the files.
    public func receivingAudio(count: Int) -> Bool {
        guard userID != nil else { return false }
        guard count <= Self.maxAudioFiles else {
            state = .refused([ShareText.tooManyFiles])
            return false
        }
        state = .audio
        return true
    }

    /// Checks each file against the account's limits and saves each one accepted. Every file is
    /// consumed: moved into the inbox, or removed. `unread` counts the shared files that could not
    /// be read, which failed to save. Once cancelled, it saves no further file; the files already
    /// saved stay, since each is complete.
    public func received(audioFiles: [IncomingFile], unread: Int = 0) async {
        guard let userID else {
            for file in audioFiles { try? FileManager.default.removeItem(at: file.url) }
            return
        }
        state = .audio
        let result = await Self.save(audioFiles, userID: userID, in: container, sharedAt: sharedAt())
        if result.saved > 0 { InboxSignal.post() }
        if Task.isCancelled { return }
        if result.failed + unread > 0 {
            // A retry shares every file again, so the sheet says how many already saved.
            let saved = result.saved > 0 ? [ShareText.savedRecordings(result.saved)] : []
            state = .refused(saved + result.refusals + [ShareText.saveFailed])
        } else if !result.refusals.isEmpty {
            state = .refused(result.refusals)
        } else {
            state = .saved(ShareText.savedRecordings(result.saved))
        }
    }

    /// Saves the link to the chosen tune. Does nothing when no tune is chosen.
    public func saveChoice() throws {
        switch choice {
        case .tune(let tune):
            try saveLink(to: .existing(id: tune.id, title: tune.title), at: sharedAt())
        case .newTune:
            let title = trimmedText(query)
            guard !title.isEmpty else { return }
            let time = sharedAt()
            try saveLink(to: .new(id: uuidV7(milliseconds: time), title: title), at: time)
        case nil:
            return
        }
    }

    private func saveLink(to tune: ShareItem.LinkTune, at time: Int64) throws {
        guard let userID, case .link(let url, let title) = state else { return }
        failure = nil
        do {
            let item = ShareItem.link(url: url, title: title, tune: tune, sharedAt: time)
            try ShareInbox.add(item, audioFrom: nil, userID: userID, in: container)
        } catch {
            failure = ShareText.saveFailed
            throw error
        }
        InboxSignal.post()
        state = .saved(ShareText.savedLink)
    }

    private func sharedAt() -> Int64 {
        ShareTime.milliseconds(now())
    }

    /// Off the main actor, since a move can cross volumes and copy a long recording.
    @concurrent
    private static func save(
        _ files: [IncomingFile], userID: String, in container: ShareContainer,
        sharedAt: Int64
    ) async -> (saved: Int, refusals: [String], failed: Int) {
        let maxFileBytes = ShareAccount.read(userID: userID, in: container)?.maxFileBytes
        var saved = 0
        var failed = 0
        var refusals: [String] = []
        for (index, file) in files.enumerated() {
            if Task.isCancelled {
                for unsaved in files[index...] { try? FileManager.default.removeItem(at: unsaved.url) }
                break
            }
            if let reason = AudioFileCheck.reason(type: file.type, bytes: file.bytes, maxFileBytes: maxFileBytes) {
                refusals.append(AudioFileCheck.refused(file.sharedName, reason.message))
                try? FileManager.default.removeItem(at: file.url)
                continue
            }
            do {
                try ShareInbox.add(
                    .audio(
                        fileName: file.url.lastPathComponent, sharedName: file.sharedName, label: file.label,
                        sharedAt: sharedAt),
                    audioFrom: file.url, order: index,
                    userID: userID, in: container)
                saved += 1
            } catch {
                failed += 1
                logger.error("A shared audio file was not saved: \(error)")
            }
        }
        return (saved, refusals, failed)
    }
}
