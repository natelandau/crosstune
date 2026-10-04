import CrosstuneStore
import Foundation
import Testing

@testable import CrosstuneUI

private let pageURL = "https://slippery-hill.com/r/42"

private func link(provider: String = "slippery_hill", ref: String? = "42") -> RecordingLink {
    RecordingLink(tuneID: "t1", url: pageURL, provider: provider, providerRef: ref, position: 0)
}

private func saved(url: String?, deleted: Bool = false) -> Recording {
    Recording(
        deletedAt: deleted ? Timestamp.now : nil, tuneID: "t1", source: "import", origin: "slippery_hill",
        originURL: url, recordedAt: Timestamp.now)
}

@Suite struct AddToRecordingsTests {
    @Test func offersAnImportableLinkWithARef() {
        #expect(canAddToRecordings(link: link(), recordings: []))
        #expect(FindRecordingsModel.importable == ["slippery_hill"])
    }

    @Test func skipsAProviderThatIsNotImportable() {
        #expect(!canAddToRecordings(link: link(provider: "youtube"), recordings: []))
    }

    @Test func skipsALinkWithoutARef() {
        #expect(!canAddToRecordings(link: link(ref: nil), recordings: []))
    }

    @Test func skipsALinkAlreadySaved() {
        #expect(!canAddToRecordings(link: link(), recordings: [saved(url: pageURL)]))
    }

    @Test func offersALinkWhoseSavedRecordingIsGoneOrDifferent() {
        #expect(canAddToRecordings(link: link(), recordings: [saved(url: pageURL, deleted: true)]))
        let others = [saved(url: "https://slippery-hill.com/r/7"), saved(url: nil)]
        #expect(canAddToRecordings(link: link(), recordings: others))
    }

    @Test func labelsTheAction() {
        #expect(TuneScreen.addToRecordings == "Add to recordings")
    }
}
