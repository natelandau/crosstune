import CrosstuneDiagnostics
@_spi(Testing) import CrosstuneTestSupport
import Foundation
import RevenueCat
import Testing

@testable import CrosstuneBilling

@Test func aCancelledPurchaseIsCancelled() {
    #expect(purchaseResult(for: .purchaseCancelledError) == .cancelled)
}

@Test func aPendingPaymentIsPending() {
    #expect(purchaseResult(for: .paymentPendingError) == .pending)
}

@Test func aReceiptInUseBelongsToAnotherAccount() {
    #expect(purchaseResult(for: .receiptAlreadyInUseError) == .otherAccount)
    #expect(restoreResult(for: .receiptAlreadyInUseError) == .otherAccount)
}

@Test(arguments: [
    ErrorCode.networkError, .offlineConnectionError, .storeProblemError, .productAlreadyPurchasedError,
])
func everyOtherErrorFails(_ code: ErrorCode) {
    #expect(purchaseResult(for: code) == .failed)
    #expect(restoreResult(for: code) == .failed)
}

@Test func readsTheCodeFromTheBridgedErrorTheSDKThrows() {
    let thrown = NSError(domain: ErrorCode.errorDomain, code: ErrorCode.paymentPendingError.rawValue)
    #expect(errorCode(of: thrown) == .paymentPendingError)
    #expect(errorCode(of: ErrorCode.receiptAlreadyInUseError) == .receiptAlreadyInUseError)
    #expect(errorCode(of: URLError(.notConnectedToInternet)) == nil)
}

@MainActor
@Suite struct PurchaseDiagnosticsTests {
    private let sink = RecordingDiagnosticsSink()

    @Test(arguments: [ErrorCode.purchaseCancelledError, .paymentPendingError, .receiptAlreadyInUseError])
    func aBuyersOutcomeReportsNothing(_ code: ErrorCode) {
        _ = failedPurchase(code, diagnostics: sink.client)
        #expect(sink.reports.isEmpty)
    }

    @Test(arguments: [ErrorCode.purchaseCancelledError, .paymentPendingError, .receiptAlreadyInUseError])
    func aRestoreOutcomeReportsNothing(_ code: ErrorCode) {
        _ = failedRestore(code, diagnostics: sink.client)
        #expect(sink.reports.isEmpty)
    }

    @Test(arguments: [ErrorCode.networkError, .offlineConnectionError])
    func anOfflineStoreReportsNothing(_ code: ErrorCode) {
        #expect(failedPurchase(code, diagnostics: sink.client) == .failed)
        #expect(failedRestore(code, diagnostics: sink.client) == .failed)
        #expect(sink.reports.isEmpty)
    }

    @Test func anUnknownPurchaseErrorReportsOnce() {
        let result = failedPurchase(URLError(.timedOut), diagnostics: sink.client)
        #expect(result == .failed)
        #expect(sink.reports.map(\.area) == [.purchase])
    }

    @Test func aStoreProblemReportsOnceUnderRestore() {
        let result = failedRestore(ErrorCode.storeProblemError, diagnostics: sink.client)
        #expect(result == .failed)
        #expect(sink.reports.map(\.area) == [.restore])
    }
}
