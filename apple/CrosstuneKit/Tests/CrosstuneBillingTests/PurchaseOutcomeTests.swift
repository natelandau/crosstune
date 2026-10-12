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
