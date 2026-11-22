import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneDiagnostics
import CrosstuneShare
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import GRDB
import os

/// A shared file the app refused for good, with the reason to show beside its name.
public struct SharedFileRefusal: Equatable, Sendable {
    public var fileName: String
    public var message: String

    public init(fileName: String, message: String) {
        self.fileName = fileName
        self.message = message
    }
}

/// What one pass over the share inbox added.
public struct ShareIntakeReport: Equatable, Sendable {
    /// The shared files refused for good, oldest first.
    public var refusedFiles: [SharedFileRefusal]
    /// Recordings were added on an account whose plan does not play them.
    public var needsPremium: Bool

    public init(refusedFiles: [SharedFileRefusal] = [], needsPremium: Bool = false) {
        self.refusedFiles = refusedFiles
        self.needsPremium = needsPremium
    }
}

/// Why the intake reported an item to diagnostics. Carries no URL, title, or file name.
enum ShareIntakeProblem: Error, Equatable {
    /// A link the API would not store reached the app, which the share extension refuses first.
    case linkNotStorable
    /// An item failed on this many passes in a row, and stays in the inbox.
    case keepsFailing(passes: Int, domain: String, code: Int)
}

/// Adds the items the share extension saved: each link to its tune, and each audio file as an
/// unfiled recording. An item leaves the inbox once added, or once refused for good; one that
/// failed for any other reason stays for the next pass.
@MainActor
public final class ShareIntake {
    /// The failed passes in a row after which an item is reported to diagnostics.
    static let reportAfterFailures = 3

    private let container: ShareContainer
    private let resolve: LinkSheetModel.Resolve?
    private let analytics: AnalyticsClient
    private let diagnostics: DiagnosticsClient
    /// The pass in progress. Two passes over one inbox would add each item twice.
    private var inFlight: Task<ShareIntakeReport, Never>?
    /// How many passes in a row each item has failed on, by folder.
    private var failures: [String: Int] = [:]
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "share-intake")

    /// An item that picked a tune another item in the inbox has yet to make.
    private struct Waiting: Error {}

    private enum Outcome {
        case addedLink
        case addedRecording(AudioFormat)
        /// Added by an earlier pass that stopped before removing the item.
        case alreadyAdded
        case refused(SharedFileRefusal?)
    }

    public init(
        container: ShareContainer, resolve: LinkSheetModel.Resolve?, analytics: AnalyticsClient,
        diagnostics: DiagnosticsClient = .noop
    ) {
        self.container = container
        self.resolve = resolve
        self.analytics = analytics
        self.diagnostics = diagnostics
    }

    /// Adds every pending item, oldest first. A call while a pass runs waits for it, then reads
    /// the inbox again.
    public func addPending(to store: CrosstuneStore, now: Date = .now) async -> ShareIntakeReport {
        while let running = inFlight { _ = await running.value }
        let task = Task {
            let report = await self.run(store, now: now)
            self.inFlight = nil
            return report
        }
        inFlight = task
        return await task.value
    }

    private func run(_ store: CrosstuneStore, now: Date) async -> ShareIntakeReport {
        var report = ShareIntakeReport()
        var importedFormats: [AudioFormat: Int] = [:]
        let time = Timestamp(now)
        let items = await Self.readInbox(userID: store.userID, in: container, now: now)
        // An item that left the inbox another way, such as a sign-out, has no count to keep.
        let present = Set(items.map { $0.folder.lastPathComponent })
        failures = failures.filter { present.contains($0.key) }
        guard !items.isEmpty else { return report }
        // New tunes whose items are still in the inbox, so an item that picked one waits for it.
        var newTunesWaiting = Set<String>()
        for case .link(_, _, .new(let id, _), _) in items.map(\.item) { newTunesWaiting.insert(id) }
        for pending in items {
            let key = pending.folder.lastPathComponent
            let outcome: Outcome
            do {
                outcome = try await add(pending, to: store, at: time, newTunesWaiting: newTunesWaiting)
            } catch is Waiting {
                continue
            } catch {
                Self.logger.warning("A shared item was not added: \(error)")
                noteFailure(key, error)
                continue
            }
            failures[key] = nil
            if case .link(_, _, .new(let id, _), _) = pending.item { newTunesWaiting.remove(id) }
            switch outcome {
            case .addedRecording(let format): importedFormats[format, default: 0] += 1
            case .addedLink, .alreadyAdded: break
            case .refused(let file?): report.refusedFiles.append(file)
            case .refused(nil): break
            }
            do {
                try ShareInbox.remove(pending)
            } catch {
                // The row's ID comes from the item, so a later pass finds it added and only removes it.
                Self.logger.warning("A shared item was not removed: \(error)")
            }
        }
        for format in AudioFormat.allCases {
            if let count = importedFormats[format] {
                analytics.send(.audioImported(fileCount: count, format: format, via: .share))
            }
        }
        if !importedFormats.isEmpty {
            do {
                let row = try await store.read { db in try Entitlement.current(db) }
                report.needsPremium = !Plan.from(row, now: now).recordingsPlay
            } catch {
                Self.logger.warning("The plan could not be read: \(error)")
            }
        }
        return report
    }

    /// Off the main actor, since it lists the inbox and decodes every item.
    @concurrent
    private static func readInbox(userID: String, in container: ShareContainer, now: Date) async -> [PendingItem] {
        ShareInbox.removeAbandoned(userID: userID, in: container, now: now)
        return ShareInbox.pending(userID: userID, in: container)
    }

    private func add(
        _ pending: PendingItem, to store: CrosstuneStore, at time: Timestamp, newTunesWaiting: Set<String>
    ) async throws -> Outcome {
        let rowID = sharedItemRowID(for: pending.folder.lastPathComponent)
        switch pending.item {
        case .link(let url, _, let tune, _):
            let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
            guard WebLink.isStorable(trimmed) else {
                Self.logger.warning("A shared link is not one the API stores")
                diagnostics.report(ShareIntakeProblem.linkNotStorable, area: .share)
                return .refused(nil)
            }
            let added = try await store.read { db in try RecordingLink.fetchOne(db, key: rowID) != nil }
            if added { return .alreadyAdded }
            try await addLink(trimmed, id: rowID, to: tune, in: store, at: time, newTunesWaiting: newTunesWaiting)
            return .addedLink
        case .audio(_, let sharedName, let label, _):
            guard let file = pending.audioFile else {
                Self.logger.warning("A shared audio item has no file")
                return .refused(nil)
            }
            let added = try await store.read { db in try Recording.fetchOne(db, key: rowID) != nil }
            if added { return .alreadyAdded }
            do {
                try await RecordingImport.add(file, to: store, tuneID: nil, label: label, at: time, recordingID: rowID)
                return .addedRecording(AudioFormat(pathExtension: file.pathExtension))
            } catch let reason as AudioFileCheck.Reason {
                Self.logger.warning("A shared audio file was refused: \(reason.message)")
                return .refused(SharedFileRefusal(fileName: sharedName, message: reason.message))
            }
        }
    }

    /// Counts a failed pass for the item in `key`, and reports it once it keeps failing, so an item
    /// that no retry adds is seen rather than left in the inbox unnoticed.
    private func noteFailure(_ key: String, _ error: any Error) {
        let passes = failures[key, default: 0] + 1
        failures[key] = passes
        guard passes == Self.reportAfterFailures else { return }
        let failure = error as NSError
        diagnostics.report(
            ShareIntakeProblem.keepsFailing(passes: passes, domain: failure.domain, code: failure.code), area: .share)
    }

    private func addLink(
        _ url: String, id: String, to tune: ShareItem.LinkTune, in store: CrosstuneStore, at time: Timestamp,
        newTunesWaiting: Set<String>
    ) async throws {
        let tuneID = try await tuneID(for: tune, in: store, at: time, newTunesWaiting: newTunesWaiting)
        let input = LinkSheetModel.input(url, resolved: await resolve?(url))
        let linkID = try await Commands(store: store).addLink(tuneID: tuneID, link: input, at: time, id: id)
        analytics.send(
            .linkAdded(service: LinkService(provider: input.provider), via: .share, linkID: linkID, tuneID: tuneID))
    }

    /// The live tune the link goes to, created from its title when it is not in the catalog.
    /// A tune that is not live is made at its replacement ID, never its own: a sync would read a
    /// new row at a deleted tune's ID as the deleted one. A new tune whose ID is not a UUID is
    /// made at its replacement ID too. A picked tune that another item in the inbox still has to
    /// create throws ``Waiting``, so the two never make two tunes.
    private func tuneID(
        for tune: ShareItem.LinkTune, in store: CrosstuneStore, at time: Timestamp, newTunesWaiting: Set<String>
    ) async throws -> String {
        let (start, title, picked): (String, String, String?) =
            switch tune {
            case .existing(let id, let title): (id, title, id)
            case .new(let id, let title): (UUID(uuidString: id) == nil ? replacementTuneID(for: id) : id, title, nil)
            }
        let target = try await store.read { db in
            if let picked, newTunesWaiting.contains(picked), try Tune.fetchOne(db, key: picked) == nil,
                try Tune.fetchOne(db, key: replacementTuneID(for: picked)) == nil
            {
                throw Waiting()
            }
            // Each tune that is not live leads to its own replacement, so the walk ends at a live
            // tune or at an ID no row holds.
            var candidate = start
            while true {
                let stored = try Tune.fetchOne(db, key: candidate)
                if let stored, stored.deletedAt == nil { return (id: candidate, isLive: true) }
                if stored == nil, candidate != picked { return (id: candidate, isLive: false) }
                candidate = replacementTuneID(for: candidate)
            }
        }
        if target.isLive { return target.id }
        let created = try await Commands(store: store).createTitleOnly(title: title, tuneID: target.id, at: time)
        analytics.send(.tuneCreated(source: .share, fieldsSet: created.fieldsSet, tuneID: created.tuneID))
        return created.tuneID
    }
}
