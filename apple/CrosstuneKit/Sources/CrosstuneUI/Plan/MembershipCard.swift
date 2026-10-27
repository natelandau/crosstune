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

    /// Where each store billing `plan` is managed, empty for a plan with nothing to manage. A web
    /// subscription is linked to the portal only on the US storefront, where the App Store allows
    /// it, and shows nothing until the storefront is read, so the action never changes under the
    /// musician.
    nonisolated static func manage(_ plan: Plan, storefront: StorefrontRead, portalURL: URL?) -> [Manage] {
        plan.paidSources.compactMap { source in
            switch source {
            case .apple: return .appStore
            case .stripe:
                switch (storefront, portalURL) {
                case (.unread, _): return nil
                case (.read("USA"), let portalURL?): return .onTheWeb(portalURL)
                case (.read, _): return .atWebsite
                }
            case .comp, .trial: return nil
            }
        }
    }

    /// The storefront, read only for a web subscriber, the one plan whose action depends on it.
    static func storefront(for plan: Plan, client: (any PurchaseClient)?) async -> String? {
        guard plan.paidSources.contains(.stripe), let client else { return nil }
        return await client.storefrontCountryCode()
    }

    static func showManage(_ client: (any PurchaseClient)?) async {
        await client?.showManageSubscriptions()
    }

    /// The membership card's row: a comp's grant, or when a grant renews or ends. An empty value
    /// shows the label alone. Nil for a plan the sheet sells to, or a grant with no date. A
    /// renewing grant past its reported expiry is in its offline leeway, where the next renewal is
    /// unknown until a sync, so it shows no date.
    nonisolated static func membership(
        _ plan: Plan, now: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> (label: String, value: String)? {
        guard mode(plan) == .member else { return nil }
        let day = { PlanText.day($0, calendar: calendar, locale: locale) }
        switch plan.source {
        case .comp:
            return plan.premiumEndsAt.map { (PlanText.ends, day($0)) } ?? (PlanText.compGrant, "")
        case .apple, .stripe:
            guard let end = plan.premiumEndsAt, !(plan.autoRenews && end <= now) else { return nil }
            return (plan.autoRenews ? PlanText.renews : PlanText.ends, day(end))
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
    let manage: [PlanSheet.Manage]

    @Environment(\.purchases) private var purchases
    /// Apple's subscription settings show as a system sheet on iPhone and iPad, which claims the
    /// shell as any dialog-like presentation must.
    @State private var managing = false

    #if os(macOS)
        /// The renewal row's trailing button, which opens wherever the plan is managed.
        nonisolated static let macManage = "Manage\u{2026}"

        @Environment(\.openURL) private var openURL

        /// Where the renewal row's Manage… leads: the first place a button can open.
        static func macManaged(_ manage: [PlanSheet.Manage]) -> PlanSheet.Manage? {
            manage.first { $0 != .atWebsite }
        }

        var body: some View {
            let trailing = membership == nil ? nil : Self.macManaged(manage)
            let rest = manage.filter { $0 != trailing }
            VStack(alignment: .leading, spacing: 0) {
                if let membership {
                    MacFormRow {
                        HStack(spacing: 12) {
                            if !membership.value.isEmpty {
                                Text(membership.value)
                                    .foregroundStyle(Palette.textSecondary)
                            }
                            if let trailing {
                                macManageButton(trailing, title: Self.macManage)
                            }
                        }
                    } label: {
                        Text(membership.label)
                    }
                    .macPlanRow()
                }
                ForEach(rest.enumerated(), id: \.element) { index, place in
                    if membership != nil || index > 0 {
                        Rectangle().fill(Palette.border).frame(height: 1).padding(.horizontal, MacForm.rowInset)
                    }
                    macManageRow(place).macPlanRow()
                }
            }
            .font(MacStyle.body)
            .frame(maxWidth: .infinity, alignment: .leading)
            .planCard()
        }

        @ViewBuilder
        private func macManageRow(_ place: PlanSheet.Manage) -> some View {
            switch place {
            case .appStore:
                macManageButton(place, title: PlanText.manageAppStore)
            case .onTheWeb:
                macManageButton(place, title: PlanText.manageOnTheWeb)
            case .atWebsite:
                Text(PlanText.manageAtWebsite)
                    .foregroundStyle(Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        private func macManageButton(_ place: PlanSheet.Manage, title: String) -> some View {
            Button(title) {
                switch place {
                case .appStore:
                    managing = true
                    Task {
                        await PlanSheet.showManage(purchases)
                        managing = false
                    }
                case .onTheWeb(let url):
                    openURL(url)
                case .atWebsite:
                    break
                }
            }
            .buttonStyle(.macSecondary)
            .disabled(managing)
            .coversShell(managing)
        }
    #else
        var body: some View {
            VStack(alignment: .leading, spacing: 0) {
                if let membership {
                    membershipRow(membership)
                        .padding()
                }
                ForEach(manage.enumerated(), id: \.element) { index, place in
                    if membership != nil || index > 0 {
                        Divider().padding(.leading)
                    }
                    manageRow(place)
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
                        .foregroundStyle(.textSecondary)
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
                    .foregroundStyle(.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    #endif
}
