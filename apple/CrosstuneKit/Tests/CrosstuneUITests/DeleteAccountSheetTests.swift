import CrosstuneStore
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct DeleteAccountSheetTests {
    @Test func confirmationMatchesIgnoringCaseAndSpaces() {
        #expect(DeleteAccountSheet.confirmationMatches(" delete "))
        #expect(DeleteAccountSheet.confirmationMatches("DELETE"))
        #expect(DeleteAccountSheet.confirmationMatches("Delete"))
        #expect(!DeleteAccountSheet.confirmationMatches(String(DeleteAccountSheet.confirmationText.dropLast())))
        #expect(!DeleteAccountSheet.confirmationMatches("\(DeleteAccountSheet.confirmationText) IT"))
        #expect(!DeleteAccountSheet.confirmationMatches(""))
    }

    @Test func countLinesOmitZerosAndPluralize() {
        let lines = DeleteAccountSheet.countLines(AccountCounts(tunes: 1, lists: 0, recordings: 3))
        #expect(lines == ["1 tune", "3 recordings and their audio"])
    }

    @Test func countLinesPinSingularWording() {
        let lines = DeleteAccountSheet.countLines(AccountCounts(tunes: 0, lists: 1, recordings: 1))
        #expect(lines == ["1 list", "1 recording and its audio"])
    }

    @Test func theListIsOmittedWhileLoadingOrUnavailable() {
        #expect(DeleteAccountSheet.listLines(.loading) == [])
        #expect(DeleteAccountSheet.listLines(.unavailable) == [])
    }

    @Test func theListEndsWithSettingsOnceCountsAreAvailable() {
        let state = DeleteAccountSheet.CountsState.available(AccountCounts(tunes: 2, lists: 0, recordings: 0))
        #expect(DeleteAccountSheet.listLines(state) == ["2 tunes", DeleteAccountSheet.settingsLine])
    }

    @Test func theUnsyncedLineHidesOnlyWhileLoading() {
        #expect(!DeleteAccountSheet.showsUnsyncedLine(.loading))
        #expect(DeleteAccountSheet.showsUnsyncedLine(.unavailable))
        let state = DeleteAccountSheet.CountsState.available(AccountCounts(tunes: 0, lists: 0, recordings: 0))
        #expect(DeleteAccountSheet.showsUnsyncedLine(state))
    }

    @Test func deleteIsDisabledWhileCountsAreLoading() {
        #expect(!DeleteAccountSheet.deleteEnabled(.loading, text: "DELETE", pending: false))
    }

    @Test func deleteIsEnabledOnceConfirmedEvenWithUnavailableCounts() {
        #expect(DeleteAccountSheet.deleteEnabled(.unavailable, text: "DELETE", pending: false))
    }

    @Test func deleteIsEnabledOnceConfirmedWithAvailableCounts() {
        let state = DeleteAccountSheet.CountsState.available(AccountCounts(tunes: 0, lists: 0, recordings: 0))
        #expect(DeleteAccountSheet.deleteEnabled(state, text: "DELETE", pending: false))
    }

    @Test func deleteStaysDisabledWithoutConfirmationOrWhilePending() {
        #expect(!DeleteAccountSheet.deleteEnabled(.unavailable, text: "", pending: false))
        #expect(!DeleteAccountSheet.deleteEnabled(.unavailable, text: "DELETE", pending: true))
    }
}
