import CrosstuneAnalytics
import Testing

@testable import CrosstuneBilling

/// RevenueCat's identity as the tests set it. Nothing here touches the SDK, so a client that reached
/// the store in a test would crash on the unconfigured `Purchases.shared`.
@MainActor private final class FakeIdentity: PurchasesIdentity {
    enum Call: Equatable {
        case configure(apiKey: String, appUserID: String)
        case logIn(String)
        /// The user a restore attached the device's purchases to.
        case restore(as: String?)
        /// The user a purchase landed on.
        case purchase(as: String?)
    }

    var appUserID: String?
    /// Whether `logIn` switches the user, or fails and leaves it in place.
    var logInSucceeds = true
    private(set) var calls: [Call] = []
    /// Holds a restore or purchase open until `finishStoreCall`.
    private var storeCall: CheckedContinuation<Void, Never>?

    init(appUserID: String? = nil) {
        self.appUserID = appUserID
    }

    var isConfigured: Bool { appUserID != nil }

    func configure(apiKey: String, appUserID: String) {
        calls.append(.configure(apiKey: apiKey, appUserID: appUserID))
        self.appUserID = appUserID
    }

    func logIn(_ appUserID: String) async {
        calls.append(.logIn(appUserID))
        if logInSucceeds { self.appUserID = appUserID }
    }

    var isInStoreCall: Bool { storeCall != nil }

    func restorePurchases() async throws -> Set<String> {
        await withCheckedContinuation { storeCall = $0 }
        calls.append(.restore(as: appUserID))
        return ["premium"]
    }

    func package(for period: PurchasePeriod) async throws -> (any StorePackage)? {
        FakePackage()
    }

    func purchase(_ package: any StorePackage) async throws -> Bool {
        await withCheckedContinuation { storeCall = $0 }
        calls.append(.purchase(as: appUserID))
        return true
    }

    func finishStoreCall() {
        storeCall?.resume()
        storeCall = nil
    }
}

@MainActor @Test func theFirstIdentifyConfiguresWithTheUsersID() async {
    let identity = FakeIdentity()
    await RevenueCatPurchases(apiKey: "key", identity: identity).identify(userID: "user_a")
    #expect(identity.calls == [.configure(apiKey: "key", appUserID: "user_a")])
}

@MainActor @Test func theSameIDAgainDoesNothing() async {
    let identity = FakeIdentity()
    let client = RevenueCatPurchases(apiKey: "key", identity: identity)
    await client.identify(userID: "user_a")
    await client.identify(userID: "user_a")
    #expect(identity.calls == [.configure(apiKey: "key", appUserID: "user_a")])
}

@MainActor @Test func aDifferentIDLogsIn() async {
    let identity = FakeIdentity()
    let client = RevenueCatPurchases(apiKey: "key", identity: identity)
    await client.identify(userID: "user_a")
    await client.identify(userID: "user_b")
    #expect(identity.calls == [.configure(apiKey: "key", appUserID: "user_a"), .logIn("user_b")])
}

@MainActor @Test func anIDIsTrimmedTheWayRevenueCatTrimsIt() async {
    let identity = FakeIdentity()
    await RevenueCatPurchases(apiKey: "key", identity: identity).identify(userID: " user_a\n")
    #expect(identity.calls == [.configure(apiKey: "key", appUserID: "user_a")])
}

@MainActor @Test(arguments: ["", "   ", "\n\t"])
func aBlankIDNeverConfigures(_ userID: String) async {
    let identity = FakeIdentity()
    await RevenueCatPurchases(apiKey: "key", identity: identity).identify(userID: userID)
    #expect(identity.calls.isEmpty)
}

@MainActor @Test(arguments: ["", "   "])
func aBlankIDAfterARealOneLeavesNoAccountToSellTo(_ blank: String) async {
    let identity = FakeIdentity()
    let client = RevenueCatPurchases(apiKey: "key", identity: identity)
    await client.identify(userID: "user_a")
    await client.identify(userID: blank)
    #expect(await client.purchase(.annual) == .failed)
    #expect(await client.restore() == .failed)
    await #expect(throws: (any Error).self) { try await client.offers() }
    #expect(identity.calls == [.configure(apiKey: "key", appUserID: "user_a")])
}

@MainActor @Test func aPurchaseBeforeAnyIdentifyFailsWithoutTheStore() async {
    let identity = FakeIdentity()
    let client = RevenueCatPurchases(apiKey: "key", identity: identity)
    #expect(await client.purchase(.annual) == .failed)
    #expect(await client.restore() == .failed)
    #expect(identity.calls.isEmpty)
}

@MainActor @Test func aPurchaseFailsWithoutTheStoreWhenLogInLeftTheOldAccount() async {
    let identity = FakeIdentity(appUserID: "user_a")
    identity.logInSucceeds = false
    let client = RevenueCatPurchases(apiKey: "key", identity: identity)
    await client.identify(userID: "user_b")
    #expect(await client.purchase(.annual) == .failed)
    #expect(await client.restore() == .failed)
    #expect(identity.appUserID == "user_a")
}

private struct FakePackage: StorePackage {}

@MainActor @Test(arguments: [FakeIdentity.Call.restore(as: "user_a"), .purchase(as: "user_a")])
private func aStoreCallLandsOnTheAccountThatStartedItThroughAnAccountSwitch(_ call: FakeIdentity.Call) async {
    let identity = FakeIdentity()
    let client = RevenueCatPurchases(apiKey: "key", identity: identity)
    await client.identify(userID: "user_a")
    let storeCall = Task {
        if case .restore = call { _ = await client.restore() } else { _ = await client.purchase(.annual) }
    }
    while !identity.isInStoreCall { await Task.yield() }

    let signIn = Task { await client.identify(userID: "user_b") }
    for _ in 0..<20 { await Task.yield() }
    identity.finishStoreCall()

    await storeCall.value
    await signIn.value
    #expect(identity.calls == [.configure(apiKey: "key", appUserID: "user_a"), call, .logIn("user_b")])
}
