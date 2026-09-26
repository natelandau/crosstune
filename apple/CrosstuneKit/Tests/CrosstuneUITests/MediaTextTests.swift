import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private let locale = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC")!
// Foundation puts a narrow no-break space before the day period.
private let recordedAtText = "Mar 14, 2026 at 8:05\u{202F}PM"

private func recording(
    label: String? = nil, state: String = "ready", durationMs: Int64? = 42_000
) -> Recording {
    Recording(
        id: "r1", tuneID: "t1", source: "microphone", recordedAt: Timestamp(iso: "2026-03-14T20:05:00.000Z")!,
        label: label, state: state, durationMs: durationMs)
}

private func file(_ state: LocalFileState, fileName: String? = "r1.m4a", error: String? = nil) -> RecordingFile {
    RecordingFile(id: "r1", localState: state, fileName: fileName, error: error)
}

@Suite struct DurationAndSizeTests {
    @Test(arguments: [(0, "0:00"), (42_000, "0:42"), (61_499, "1:01"), (61_500, "1:02"), (3_600_000, "60:00")])
    func readsMinutesAndPaddedSeconds(milliseconds: Int64, text: String) {
        #expect(RecordingText.duration(milliseconds: milliseconds) == text)
    }

    @Test func saysNothingForAnUnknownLength() {
        #expect(RecordingText.duration(milliseconds: nil) == nil)
    }

    @Test(arguments: [
        (999, "999 B"), (1_499, "1 KB"), (999_000, "999 KB"), (1_000_000, "1 MB"), (1_999_999, "1.9 MB"),
        (12_340_000, "12.3 MB"), (999_999_999, "999.9 MB"), (2_000_000_000, "2 GB"), (5_380_000_000, "5.3 GB"),
    ])
    func truncatesLargeSizesRatherThanRounding(bytes: Int64, text: String) {
        #expect(RecordingText.bytes(bytes) == text)
    }
}

@Suite struct RecordingTitleTests {
    @Test func prefersTheLabelThenTheTuneThenTheDate() {
        #expect(RecordingText.title(recording(label: "Jam"), tuneTitle: "Cluck Old Hen") == "Jam")
        #expect(RecordingText.title(recording(), tuneTitle: "Cluck Old Hen") == "Cluck Old Hen")
        #expect(
            RecordingText.title(recording(), tuneTitle: nil, locale: locale, timeZone: utc)
                == "Recording, \(recordedAtText)")
    }

    @Test func dropsTheTuneAHeadingAboveAlreadyNames() {
        #expect(
            RecordingText.title(
                recording(), tuneTitle: "Cluck Old Hen", tuneNamedAbove: true, locale: locale, timeZone: utc)
                == "Recording, \(recordedAtText)")
        #expect(RecordingText.title(recording(label: "Jam"), tuneTitle: "Cluck Old Hen", tuneNamedAbove: true) == "Jam")
    }
}

@Suite struct RecordingMetaTests {
    @Test func showsTheDateWhenNothingNeedsAttention() {
        let meta = RecordingText.meta(recording(), file: file(.downloaded), locale: locale, timeZone: utc)
        #expect(meta == ["0:42", recordedAtText])
    }

    @Test func showsAStatusInPlaceOfTheDate() {
        #expect(
            RecordingText.meta(recording(state: "pending_upload"), file: file(.captured)) == [
                "0:42", "Waiting to upload",
            ])
        #expect(RecordingText.meta(recording(state: "processing"), file: nil) == ["0:42", "Processing"])
        #expect(RecordingText.meta(recording(state: "failed", durationMs: nil), file: nil) == ["Couldn't process"])
    }

    @Test func addsStorageFiguresWhenBlockedByTheQuota() {
        let storage = StorageFigures(usedBytes: 1_950_000_000, quotaBytes: 2_000_000_000, maxFileBytes: 100_000_000)
        let meta = RecordingText.meta(recording(state: "pending_upload"), file: file(.blockedQuota), storage: storage)
        #expect(meta == ["0:42", "Storage full", "1.9 GB of 2 GB used"])
    }

    @Test func saysOfflineForADownloadThatCannotStart() {
        #expect(RecordingText.meta(recording(), file: nil, offline: true) == ["0:42", SyncStatus.offlineLabel])
    }

    @Test(arguments: [
        (LocalFileState.capturing, "Recording"), (.captured, "Waiting to upload"), (.uploading, "Uploading"),
        (.blockedQuota, "Storage full"), (.failedUpload, "Upload failed"), (.downloading, "Downloading"),
    ])
    func namesEachLocalState(state: LocalFileState, label: String) {
        #expect(RecordingText.fileState(recording(), file: file(state)) == label)
    }

    @Test func saysNothingForAPlayableRecording() {
        #expect(RecordingText.fileState(recording(), file: file(.downloaded)) == nil)
        #expect(RecordingText.fileState(recording(), file: file(.uploaded)) == nil)
        #expect(RecordingText.fileState(recording(), file: nil) == nil)
    }

    @Test func countsFailedTriesOnAnUploadStillWaiting() {
        var waiting = file(.captured)
        waiting.uploadAttempts = 1
        #expect(
            RecordingText.meta(recording(state: "pending_upload"), file: waiting) == [
                "0:42", RecordingText.waitingToUpload, "1 failed try",
            ])
        waiting.localState = .uploading
        waiting.uploadAttempts = 3
        #expect(
            RecordingText.meta(recording(state: "pending_upload"), file: waiting) == [
                "0:42", RecordingText.uploading, "3 failed tries",
            ])
        var refused = file(.failedUpload)
        refused.uploadAttempts = 2
        #expect(
            RecordingText.meta(recording(state: "pending_upload"), file: refused) == [
                "0:42", RecordingText.uploadFailed,
            ])
    }

    @Test func showsTheFilesOwnLengthUntilTheServerReportsOne() {
        var captured = file(.captured)
        captured.localDurationMs = 65_000
        #expect(RecordingText.meta(recording(state: "pending_upload", durationMs: nil), file: captured).first == "1:05")
        #expect(RecordingText.meta(recording(durationMs: 42_000), file: captured).first == "0:42")
    }
}

@Suite struct RecordingControlTests {
    @Test func closeBeatsPlayForALoadedItem() {
        #expect(RecordingText.control(recording(), file: nil, loaded: true, downloading: false) == .close)
    }

    @Test func playsAudioThisDeviceHolds() {
        #expect(RecordingText.control(recording(), file: file(.downloaded), loaded: false, downloading: false) == .play)
        #expect(
            RecordingText.control(
                recording(state: "pending_upload"), file: file(.captured), loaded: false, downloading: false) == .play)
    }

    @Test func downloadsOnlyAReadyServerCopy() {
        #expect(RecordingText.control(recording(), file: nil, loaded: false, downloading: false) == .download)
        #expect(RecordingText.control(recording(), file: nil, loaded: false, downloading: true) == .downloading)
        #expect(
            RecordingText.control(
                recording(), file: file(.downloading, fileName: nil), loaded: false, downloading: false)
                == .downloading)
        #expect(
            RecordingText.control(recording(state: "processing"), file: nil, loaded: false, downloading: false) == .none
        )
    }

    @Test func aCaptureStillBeingWrittenIsNotPlayable() {
        #expect(
            RecordingText.control(
                recording(state: "pending_upload"), file: file(.capturing), loaded: false, downloading: false) == .none)
    }

    @Test func retriesAStuckUploadOrAFailedTranscode() {
        #expect(RecordingText.retry(recording(state: "pending_upload"), file: file(.failedUpload)) == .upload)
        #expect(RecordingText.retry(recording(state: "failed"), file: nil) == .transcode)
        #expect(RecordingText.retry(recording(), file: file(.downloaded)) == nil)
    }

    @Test func retriesAnUploadTheLoopKeepsFailingToSend() {
        var waiting = file(.captured)
        #expect(RecordingText.retry(recording(state: "pending_upload"), file: waiting) == nil)
        waiting.uploadAttempts = 1
        #expect(RecordingText.retry(recording(state: "pending_upload"), file: waiting) == .upload)
    }
}

@Suite struct RecordingRowContentTests {
    @Test func namesTheRowByItsVerbAndShowsTheMatchingGlyph() {
        let row = RecordingRowContent(recording: recording(label: "Jam"), file: file(.downloaded), tuneTitle: nil)
        #expect(row.glyph == .play)
        #expect(row.verb == MediaText.play)
        #expect(row.tap == .play)
        let loaded = RecordingRowContent(recording: recording(), file: nil, tuneTitle: "Jam", loaded: true)
        #expect(loaded.glyph == .stop)
        #expect(loaded.verb == MediaText.closePlayer)
        #expect(loaded.tap == .close)
    }

    @Test func carriesAStuckUploadsErrorAndRetry() {
        let row = RecordingRowContent(
            recording: recording(label: "Jam", state: "pending_upload"),
            file: file(.failedUpload, error: "Refused"), tuneTitle: nil)
        #expect(row.error == "Refused")
        #expect(row.retryName == "Retry uploading Jam")
        #expect(row.meta == "0:42 · Upload failed")
    }

    @Test func dimsADownloadOffline() {
        let row = RecordingRowContent(recording: recording(label: "Jam"), file: nil, tuneTitle: nil, offline: true)
        #expect(row.glyph == .download)
        #expect(row.isDimmed)
        #expect(row.meta == "0:42 · Offline")
    }

    @Test func aStuckRowWithNothingToPlayRetriesOnATap() {
        let row = RecordingRowContent(recording: recording(label: "Jam", state: "failed"), file: nil, tuneTitle: nil)
        #expect(row.retryName == "Retry Jam")
        #expect(row.error == nil)
        #expect(row.glyph == .attention)
        #expect(row.verb == "Retry")
        #expect(row.tap == .retry(.transcode))
    }

    @Test func aStuckUploadStillPlaysWhatThisDeviceHolds() {
        let row = RecordingRowContent(
            recording: recording(label: "Jam", state: "pending_upload"), file: file(.failedUpload), tuneTitle: nil)
        #expect(row.tap == .play)
        #expect(row.retry == .upload)
    }

    @Test func aProcessingRowWaitsAndIsInert() {
        let row = RecordingRowContent(
            recording: recording(label: "Jam", state: "processing"), file: nil, tuneTitle: nil)
        #expect(row.glyph == .waiting)
        #expect(row.tap == nil)
        #expect(row.verb == nil)
    }

    @Test func aDownloadSaysSoToAScreenReader() {
        let row = RecordingRowContent(recording: recording(label: "Jam"), file: nil, tuneTitle: nil, downloading: true)
        #expect(row.glyph == .downloading)
        #expect(row.verb == RecordingText.downloading)
        #expect(row.tap == nil)
    }
}

@Suite struct LinkRowContentTests {
    private let youtube = RecordingLink(
        tuneID: "t1", url: "https://www.youtube.com/watch?v=x", provider: "youtube", title: "Tommy Jarrell")

    @Test func anEmbeddableLinkPlaysAndClosesInTheApp() {
        let row = LinkRowContent(link: youtube, embeddable: true)
        #expect(row.glyph == .play)
        #expect(row.verb == MediaText.play)
        #expect(row.tap == .play)
        let loaded = LinkRowContent(link: youtube, embeddable: true, loaded: true)
        #expect(loaded.glyph == .stop)
        #expect(loaded.tap == .close)
    }

    @Test func anyOtherLinkOpensItsSite() throws {
        let row = LinkRowContent(link: youtube, embeddable: false)
        let url = try #require(row.outboundURL)
        #expect(row.glyph == MediaGlyph.none)
        #expect(row.verb == LinkText.open)
        #expect(row.tap == .open(url))
        #expect(row.outboundLabel == "YouTube")
        #expect(row.outboundName == "Open Tommy Jarrell on YouTube")
    }

    @Test func aLinkThatMustNotOpenIsInert() {
        let link = RecordingLink(tuneID: "t1", url: "javascript:alert(1)", provider: "other")
        let row = LinkRowContent(link: link, embeddable: false)
        #expect(row.tap == nil)
        #expect(row.verb == nil)
        #expect(row.outboundURL == nil)
    }
}

@Suite struct LinkTextTests {
    private func link(
        url: String = "https://www.youtube.com/watch?v=x", provider: String = "youtube", title: String? = nil,
        label: String? = nil
    ) -> RecordingLink {
        RecordingLink(tuneID: "t1", url: url, provider: provider, title: title, label: label)
    }

    @Test func titlesByProviderTitleThenLabelThenHost() {
        #expect(LinkText.title(link(title: "Tommy Jarrell", label: "Mine")) == "Tommy Jarrell")
        #expect(LinkText.title(link(label: "Mine")) == "Mine")
        #expect(LinkText.title(link()) == "www.youtube.com")
    }

    @Test func namesTheProviderOnceAndAPlainLinkAsOpen() {
        #expect(LinkText.outboundLabel(link()) == "YouTube")
        #expect(LinkText.outboundLabel(link(provider: "other")) == "Open")
        #expect(LinkText.outboundLabel(link(provider: "a_provider_from_the_future")) == "Open")
        #expect(LinkText.outboundName(link(title: "Tommy Jarrell")) == "Open Tommy Jarrell on YouTube")
    }

    @Test(arguments: [
        ("https://example.com/a", "https://example.com/a"),
        ("  http://example.com  ", "http://example.com"),
        ("example.com/tune", "https://example.com/tune"),
        ("www.youtube.com/watch?v=x", "https://www.youtube.com/watch?v=x"),
    ])
    func opensWebLinks(raw: String, expected: String) {
        #expect(LinkText.outboundURL(raw)?.absoluteString == expected)
    }

    @Test func trimsOnlyControlsAndSpacesAndDropsLineBreaks() {
        #expect(
            LinkText.outboundURL("\u{01}\t https://exa\nmple.com/a\r\n ")?.absoluteString == "https://example.com/a")
    }

    @Test(arguments: [
        "javascript:alert(1)", "file:///etc/passwd", "mailto:a@example.com", "tel:5551234", "",
        "https://exa mple.com", "exa mple.com/tune", "\u{00A0}https://example.com",
    ])
    func refusesEveryOtherScheme(raw: String) {
        #expect(LinkText.outboundURL(raw) == nil)
    }
}
