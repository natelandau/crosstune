import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import CrosstuneSync
import Foundation

extension FailureReason {
    /// The reason an error stands for. Never carries the error's own text.
    init(_ error: any Error) {
        switch error {
        case is URLError: self = .network
        case let error as CocoaError where error.code == .fileWriteOutOfSpace: self = .storageFull
        case let error as POSIXError where error.code == .ENOSPC: self = .storageFull
        default: self = .other
        }
    }
}

extension AnalyticsClient {
    /// A recording put under `tuneID`, after the write lands. `recording` is how it stood before.
    func recordingFiled(_ recording: Recording, under tuneID: String) {
        send(
            .recordingFiled(
                from: recording.tuneID == nil ? .unfiled : .otherTune, origin: RecordingOrigin(recording),
                recordingID: recording.id, tuneID: tuneID))
    }

    func recordingUnfiled(_ recording: Recording) {
        send(.recordingUnfiled(origin: RecordingOrigin(recording), recordingID: recording.id))
    }

    func recordingRenamed(_ recording: Recording) {
        send(.recordingRenamed(origin: RecordingOrigin(recording), recordingID: recording.id))
    }

    func recordingDeleted(_ recording: Recording) {
        send(.recordingDeleted(origin: RecordingOrigin(recording), recordingID: recording.id))
    }

    /// A link followed out to its provider's own site.
    func linkOpened(_ link: RecordingLink) {
        linkOpened(provider: link.provider, linkID: link.id)
    }

    /// A link stored with `provider` followed out to its provider's own site.
    func linkOpened(provider: String, linkID: String) {
        send(.linkOpenedExternally(service: LinkService(provider: provider), linkID: linkID))
    }

    /// The answer to Apple Music's access prompt. A prompt still unanswered reports nothing.
    func appleMusicAnswered(_ state: AppleMusicAccessState) {
        guard state != .notAsked else { return }
        send(.appleMusicAuthorized(granted: state != .declined))
    }
}
