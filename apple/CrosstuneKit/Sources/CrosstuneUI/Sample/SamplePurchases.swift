#if DEBUG
    import CrosstuneAnalytics
    import CrosstuneBilling
    import Foundation

    /// A store that sells both periods at fixed prices and never charges, so a capture shows the
    /// Plan sheet's Subscribe, renewal terms, and links. A purchase ends cancelled and a restore
    /// finds nothing. Opened by `-SampleOffers`. Debug builds only.
    @MainActor final class SamplePurchases: PurchaseClient {
        static func fromArguments(_ arguments: [String] = CommandLine.arguments) -> SamplePurchases? {
            arguments.contains("-SampleOffers") ? SamplePurchases() : nil
        }

        func identify(userID: String) async {}

        func offers() async throws -> [PurchaseOffer] {
            [
                PurchaseOffer(period: .annual, price: "$29.99", amount: 29.99),
                PurchaseOffer(period: .monthly, price: "$2.99", amount: 2.99),
            ]
        }

        func purchase(_ period: PurchasePeriod) async -> PurchaseResult { .cancelled }
        func restore() async -> RestoreResult { .nothing }
        func showManageSubscriptions() async {}
        func storefrontCountryCode() async -> String? { "USA" }
    }
#endif
