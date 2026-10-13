import CrosstuneStore
import Foundation
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

    @Test func theSubscriptionLinesFollowEveryPaidSource() {
        #expect(
            DeleteAccountSheet.subscriptionLines(Plan(kind: .premium, source: .apple))
                == [DeleteAccountSheet.appleSubscriptionLine])
        #expect(
            DeleteAccountSheet.subscriptionLines(Plan(kind: .premium, source: .stripe))
                == [DeleteAccountSheet.stripeSubscriptionLine])
        #expect(
            DeleteAccountSheet.subscriptionLines(Plan(kind: .premium, source: .comp, paidSources: [.apple, .stripe]))
                == [DeleteAccountSheet.appleSubscriptionLine, DeleteAccountSheet.stripeSubscriptionLine])
        for plan in [
            Plan(kind: .free), Plan(kind: .premium, source: .trial), Plan(kind: .premium, source: .comp), .unknown,
        ] {
            #expect(DeleteAccountSheet.subscriptionLines(plan).isEmpty)
        }
    }

    @Test func onlyAnAppStoreSubscriberIsSentToAppStoreSettings() {
        let apple = Plan(kind: .premium, source: .apple)
        #expect(DeleteAccountSheet.appStoreSettings(apple, hasClient: true) == .button)
        // A build with no purchase client still links to Apple's subscription settings.
        #expect(
            DeleteAccountSheet.appStoreSettings(apple, hasClient: false)
                == .link(URL(string: "https://apps.apple.com/account/subscriptions")!))
        #expect(DeleteAccountSheet.appStoreSettings(Plan(kind: .premium, source: .stripe), hasClient: true) == nil)
        #expect(DeleteAccountSheet.appStoreSettings(Plan(kind: .free), hasClient: true) == nil)
        let compOverApple = Plan(kind: .premium, source: .comp, paidSources: [.apple])
        #expect(DeleteAccountSheet.appStoreSettings(compOverApple, hasClient: true) == .button)
    }

    @Test func theCopyMatchesTheWeb() throws {
        let web = try webCopy("web/src/features/settings/deleteAccountCopy.ts")
        let shared: [(String, String)] = [
            ("DELETE_ACCOUNT", DeleteAccountSheet.title),
            ("DELETE_ACCOUNT_TITLE", DeleteAccountSheet.heading),
            ("DELETE_ACCOUNT_LEAD", DeleteAccountSheet.lead),
            ("SETTINGS_LINE", DeleteAccountSheet.settingsLine),
            ("UNSYNCED_LINE", DeleteAccountSheet.unsyncedLine),
            ("CANNOT_UNDO", DeleteAccountSheet.cannotUndo),
            ("NO_RECOVERY", DeleteAccountSheet.noRecovery),
            ("DELETE_CONFIRMATION_TEXT", DeleteAccountSheet.confirmationText),
            ("STRIPE_SUBSCRIPTION_LINE", DeleteAccountSheet.stripeSubscriptionLine),
            ("APPLE_SUBSCRIPTION_LINE", DeleteAccountSheet.appleSubscriptionLine),
        ]
        for (name, value) in shared {
            let expected = try #require(web[name], "deleteAccountCopy.ts has no constant \(name)")
            #expect(value == expected, "\(name)")
        }
    }

    @Test func deleteStaysDisabledWithoutConfirmationOrWhilePending() {
        #expect(!DeleteAccountSheet.deleteEnabled(.unavailable, text: "", pending: false))
        #expect(!DeleteAccountSheet.deleteEnabled(.unavailable, text: "DELETE", pending: true))
    }
}
