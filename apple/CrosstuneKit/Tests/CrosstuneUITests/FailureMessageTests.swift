import Foundation
import Testing

@testable import CrosstuneUI

struct WrittenFailure: LocalizedError {
    var errorDescription: String? { "The list could not be saved." }
}

@MainActor @Test func aFailureShowsItsOwnDescription() {
    #expect(failureMessage(WrittenFailure()) == "The list could not be saved.")
}

@MainActor @Test func aNetworkFailureShowsTheSystemsSentence() {
    let error = URLError(.notConnectedToInternet)
    #expect(failureMessage(error) == error.localizedDescription)
}

@MainActor @Test func aFileFailureShowsTheSystemsSentence() {
    let error = CocoaError(.fileWriteOutOfSpace)
    #expect(failureMessage(error) == error.localizedDescription)
}

@MainActor @Test func anyOtherFailureShowsTheGenericLine() {
    #expect(failureMessage(NSError(domain: "SQLite", code: 5)) == CatalogModel.actionFailed)
}
