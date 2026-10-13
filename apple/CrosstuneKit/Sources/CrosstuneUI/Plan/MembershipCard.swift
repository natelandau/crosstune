import CrosstuneBilling
import CrosstuneStore
import SwiftUI

extension PlanSheet {
    /// The App Store storefront, once asked.
    enum StorefrontRead: Equatable {
        case unread
        /// Three letters ("USA"), or nil when the store has none.
        case read(String?)
    }

    /// Where a member manages what they pay for.
    enum Manage: Hashable {
        case appStore
        case onTheWeb(URL)
        /// The plain my.crosstune.app line, with no link.
        case atWebsite
    }

    /// How `plan` is managed, nil for a plan with nothing to manage. A web subscriber is linked to
    /// the portal only on the US storefront, where the App Store allows it, and gets nothing
    /// until the storefront is read, so the action never changes under the musician.
    nonisolated static func manage(_ plan: Plan, storefront: StorefrontRead, portalURL: URL?) -> Manage? {
        switch plan.source {
        case .apple: return .appStore
        case .stripe:
            switch (storefront, portalURL) {
            case (.unread, _): return nil
            case (.read("USA"), let portalURL?): return .onTheWeb(portalURL)
            case (.read, _): return .atWebsite
            }
        case .comp, .trial, nil: return nil
        }
    }

    /// The storefront, read only for a web subscriber, the one plan whose action depends on it.
    static func storefront(for plan: Plan, client: (any PurchaseClient)?) async -> String? {
        guard plan.source == .stripe, let client else { return nil }
        return await client.storefrontCountryCode()
    }

    static func showManage(_ client: (any PurchaseClient)?) async {
        await client?.showManageSubscriptions()
    }

    /// The membership card's row: a comp's grant, or when a grant renews or ends. An empty value
    /// shows the label alone. Nil for a plan the sheet sells to, or a grant with no date.
    nonisolated static func membership(
        _ plan: Plan, calendar: Calendar = .current, locale: Locale = .current
    ) -> (label: String, value: String)? {
        guard mode(plan) == .member else { return nil }
        let day = { PlanText.day($0, calendar: calendar, locale: locale) }
        switch plan.source {
        case .comp:
            return plan.premiumEndsAt.map { (PlanText.ends, day($0)) } ?? (PlanText.compGrant, "")
        case .apple, .stripe:
            return plan.premiumEndsAt.map { (plan.autoRenews ? PlanText.renews : PlanText.ends, day($0)) }
        case .trial, nil:
            return nil
        }
    }

    /// The outcome under Restore: a restore's, never a purchase's.
    static func restoreLine(_ purchase: PurchaseModel) -> String? {
        guard purchase.lineFrom == .restore else { return nil }
        return purchase.line.map(PlanText.line)
    }
}

/// A member's plan: when it renews or ends, or that Crosstune granted it, and where to manage it.
/// No price or period, since the synced entitlement carries neither.
struct MembershipCard: View {
    let membership: (label: String, value: String)?
    let manage: PlanSheet.Manage?

    @Environment(\.purchases) private var purchases
    /// Apple's subscription settings show as a system sheet on iPhone and iPad, which claims the
    /// shell as any dialog-like presentation must.
    @State private var managing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let membership {
                membershipRow(membership)
                    .padding()
            }
            if let manage {
                if membership != nil {
                    Divider().padding(.leading)
                }
                manageRow(manage)
                    .padding()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .planCard()
    }

    private func membershipRow(_ membership: (label: String, value: String)) -> some View {
        HStack {
            Text(membership.label)
            if !membership.value.isEmpty {
                Spacer()
                Text(membership.value)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func manageRow(_ manage: PlanSheet.Manage) -> some View {
        switch manage {
        case .appStore:
            Button(PlanText.manageAppStore) {
                managing = true
                Task {
                    await PlanSheet.showManage(purchases)
                    managing = false
                }
            }
            .disabled(managing)
            .coversShell(managing)
        case .onTheWeb(let url):
            Link(PlanText.manageOnTheWeb, destination: url)
        case .atWebsite:
            Text(PlanText.manageAtWebsite)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
