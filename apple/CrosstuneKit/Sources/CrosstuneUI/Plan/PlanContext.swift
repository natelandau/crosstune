import CrosstuneAnalytics
import CrosstuneStore
import Foundation
import GRDB
import SwiftUI

/// The recording a Plan sheet was opened from, whose export it offers.
struct PremiumSubject: Equatable, Sendable {
    let recordingID: String
}

enum PlanContextAction: Equatable {
    case exportRecording(id: String)
    case exportAll
}

/// The title, line, and export action at the top of the Plan sheet.
struct PlanContext: Equatable {
    let title: String
    let body: String
    let action: PlanContextAction?

    /// A lapsed account's title follows the lapse. The recordings context offers export whenever
    /// the account holds recordings, and its body asks to subscribe or export only then.
    nonisolated static func make(reason: PremiumReason, lapse: PlanLapse?, inputs: PlanContextInputs) -> PlanContext {
        switch reason {
        case .plan:
            return PlanContext(title: PlanText.premiumPlanTitle, body: PlanText.premiumPitch, action: nil)
        case .scans:
            return PlanContext(
                title: lapse.map(PlanText.lapsedTitle) ?? PlanText.premiumScansTitle, body: PlanText.premiumScansBody,
                action: nil)
        case .recordings:
            let subject = inputs.subject
            let action: PlanContextAction? =
                inputs.recordingCount > 0 ? subject.map { .exportRecording(id: $0.recordingID) } ?? .exportAll : nil
            let body =
                action == nil ? PlanText.recordingsCost : "\(PlanText.recordingsCost) \(PlanText.subscribeOrExport)"
            return PlanContext(
                title: lapse.map(PlanText.lapsedTitle) ?? PlanText.premiumRecordingsTitle, body: body, action: action)
        }
    }

    /// Whether the context for `reason` reads the store: only the recordings context counts
    /// and names them.
    nonisolated static func readsStore(reason: PremiumReason) -> Bool {
        reason == .recordings
    }
}

/// What the context reads from the store: how many recordings the account holds, and the
/// subject's live row.
struct PlanContextInputs: Equatable, Sendable {
    var recordingCount: Int
    /// The subject under its current name, nil once its recording is deleted.
    var subject: PremiumSubject?

    /// Takes `subject` as live without a read, so the account holds at least it, as when it was
    /// just tapped or is the page's own recording.
    init(presuming subject: PremiumSubject?) {
        self.init(recordingCount: subject == nil ? 0 : 1, subject: subject)
    }

    init(recordingCount: Int, subject: PremiumSubject?) {
        self.recordingCount = recordingCount
        self.subject = subject
    }

    static func fetch(_ db: Database, subject: PremiumSubject?) throws -> PlanContextInputs {
        let count = try Recording.liveCount(db)
        guard let subject, let recording = try Recording.fetchOne(db, key: subject.recordingID),
            recording.deletedAt == nil
        else { return PlanContextInputs(recordingCount: count, subject: nil) }
        return PlanContextInputs(recordingCount: count, subject: PremiumSubject(recordingID: recording.id))
    }

    /// Follows the account's recordings and `subject` in `store`: nil until the first read, and a
    /// deleted subject as nil.
    @MainActor
    static func live(_ store: CrosstuneStore, subject: PremiumSubject?) -> LiveQuery<PlanContextInputs?> {
        LiveQuery(store, initial: nil) { db in try fetch(db, subject: subject) }
    }
}

/// Hands `content` the Plan context for `reason` and `subject`, kept current from the
/// environment's store while shown and while the context reads the store. Before the first
/// read, the subject counts as live, since it was just tapped.
struct PlanContextReader<Content: View>: View {
    let reason: PremiumReason
    let subject: PremiumSubject?
    @ViewBuilder let content: (PlanContext) -> Content

    @Environment(\.store) private var store
    @Environment(\.plan) private var plan
    /// Nil while the context reads nothing from the store, or without a store.
    @State private var query: LiveQuery<PlanContextInputs?>?

    /// What restarts the read when it changes.
    private struct ReadKey: Equatable {
        let reads: Bool
        let subjectID: String?
        let store: ObjectIdentifier?
    }

    /// Whether the sheet shows nothing yet. With no subject, the count decides the text and the
    /// export, so a running read is waited for rather than open on the text for an account with no
    /// recordings. A failed read, or no read at all, shows the presumed context.
    nonisolated static func waitsForCount(
        reading: Bool, subject: PremiumSubject?, read: PlanContextInputs?, failed: Bool
    ) -> Bool {
        reading && subject == nil && read == nil && !failed
    }

    var body: some View {
        let lapse = plan?.plan.lapse
        let reads = PlanContext.readsStore(reason: reason)
        let read = query.flatMap(\.value)
        let inputs = read ?? PlanContextInputs(presuming: subject)
        Group {
            if Self.waitsForCount(reading: query != nil, subject: subject, read: read, failed: query?.error != nil) {
                Color.clear
            } else {
                content(PlanContext.make(reason: reason, lapse: lapse, inputs: inputs))
            }
        }
        .onChange(
            of: ReadKey(reads: reads, subjectID: subject?.recordingID, store: store.map(ObjectIdentifier.init)),
            initial: true
        ) {
            query = reads ? store.map { PlanContextInputs.live($0, subject: subject) } : nil
        }
    }
}
