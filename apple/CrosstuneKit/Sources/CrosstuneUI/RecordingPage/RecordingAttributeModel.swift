import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import Foundation
import Observation
import os

/// The writes a recording page's rows make, one field at a time. Each reads the recording as
/// stored, writes only a value that differs from it, and reports the change once it lands. A
/// blank name, players, or notes clears the field, so a blank name goes back to naming the
/// recording for its tune or its date.
@MainActor
@Observable
final class RecordingAttributeModel {
    /// A filing under a tune started from the tune picker, which fails after the tune is made.
    nonisolated static let filingFailed = "The recording could not be added to this tune."

    let recordingID: String
    /// Why the last write did not land, cleared by the next.
    private(set) var failure: String?

    @ObservationIgnored private let store: CrosstuneStore
    @ObservationIgnored private let analytics: AnalyticsClient
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private let now: () -> Timestamp
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "recording-attributes")

    /// `timeZone` reads a recording's day; `now` decides which dates are still to come.
    init(
        store: CrosstuneStore, recordingID: String, analytics: AnalyticsClient, timeZone: TimeZone = .current,
        now: @escaping () -> Timestamp = { .now }
    ) {
        self.store = store
        self.recordingID = recordingID
        self.analytics = analytics
        self.timeZone = timeZone
        self.now = now
    }

    func rename(_ name: String) async {
        let label = name.nilIfBlank
        await write(
            when: { $0.label != label },
            { writer, id, time in try writer.updateRecording(id, label: .value(label), at: time) },
            reported: { analytics, before in analytics.recordingRenamed(before) })
    }

    /// Files the recording under `tuneID`, or takes it out of its tune with nil.
    func file(_ tuneID: String?) async {
        await write(
            when: { $0.tuneID != tuneID },
            { writer, id, time in try writer.updateRecording(id, tuneID: .value(tuneID), at: time) },
            reported: { analytics, before in
                if let tuneID {
                    analytics.recordingFiled(before, under: tuneID)
                } else {
                    analytics.recordingUnfiled(before)
                }
            })
    }

    /// Makes a tune by `title` alone and files the recording under it. A filing refused once the
    /// tune is made says so here, and the tune stays.
    func fileUnderNewTune(_ title: String) async {
        failure = nil
        do {
            let created = try await Commands(store: store).createTitleOnly(
                title: title, source: .recordingScreen, recordingID: recordingID, analytics: analytics)
            if created.filingError != nil { failure = Self.filingFailed }
        } catch {
            fail(error)
        }
    }

    func setPlayers(_ players: String) async {
        let value = players.nilIfBlank
        await write(
            when: { $0.players != value },
            { writer, id, time in try writer.updateRecording(id, players: .value(value), at: time) })
    }

    func setNotes(_ notes: String) async {
        let value = notes.nilIfBlank
        await write(
            when: { $0.notes != value },
            { writer, id, time in try writer.updateRecording(id, notes: .value(value), at: time) })
    }

    /// Writes the recorded date at its most specific part: a year, a month, or a day. Parts that
    /// match the stored date write nothing, so a recording's exact time survives them.
    func setRecorded(year: String, month: Int?, day: Int?) async {
        failure = nil
        let id = recordingID
        guard let before = await read() else { return }
        var draft = RecordingDateDraft(recording: before, timeZone: timeZone)
        draft.setYear(year)
        draft.setMonth(month)
        draft.setDay(day)
        guard draft.isChanged else { return }
        let resolved: (at: Timestamp?, precision: RecordingPrecision?)
        do {
            resolved = try draft.resolved(now: now())
        } catch {
            failure = error.message
            return
        }
        let time = now()
        do {
            try await store.write { writer in
                try writer.updateRecordingDate(id, recordedAt: resolved.at, precision: resolved.precision, at: time)
            }
        } catch {
            fail(error)
        }
    }

    /// Shows why a write made elsewhere for this recording, such as the location editor's, failed.
    func report(_ failure: String) {
        self.failure = failure
    }

    /// The recording as stored, nil once it is deleted, so nothing writes to a recording that is
    /// gone.
    private func read() async -> Recording? {
        let id = recordingID
        do {
            return try await store.read { db in
                try Recording.fetchOne(db, key: id).flatMap { $0.deletedAt == nil ? $0 : nil }
            }
        } catch {
            fail(error)
            return nil
        }
    }

    /// One write of the recording, made only when `changed` holds for it as stored, then reported
    /// with the recording as it was before.
    private func write(
        when changed: (Recording) -> Bool,
        _ apply: @escaping @Sendable (StoreWriter, String, Timestamp) throws -> Void,
        reported: ((AnalyticsClient, Recording) -> Void)? = nil
    ) async {
        failure = nil
        guard let before = await read(), changed(before) else { return }
        let id = recordingID
        let time = now()
        do {
            try await store.write { writer in try apply(writer, id, time) }
            reported?(analytics, before)
        } catch {
            fail(error)
        }
    }

    private func fail(_ error: any Error) {
        Self.logger.warning("A recording edit failed: \(error)")
        failure = failureMessage(error)
    }
}
