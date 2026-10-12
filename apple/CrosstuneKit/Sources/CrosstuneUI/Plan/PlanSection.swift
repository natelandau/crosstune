import CrosstuneBilling
import CrosstuneStore
import SwiftUI

/// The Account page's Plan group: which plan the account is on, its storage against the plan's
/// quota, and, in a build that sells, the way to subscribe, manage, or restore. Nothing shows
/// while the plan is unknown.
struct PlanSection: View {
    let plan: Plan
    let storage: StorageFigures?

    @Environment(\.purchase) private var purchase
    @Environment(\.premium) private var premium
    @Environment(\.purchases) private var purchases
    @Environment(\.stripePortalURL) private var portalURL
    @State private var storefront: StorefrontRead = .unread
    /// Apple's subscription settings show as a system sheet over the shell on iPhone and iPad.
    @State private var managing = false

    /// A row the group adds after the plan and storage.
    enum Action: Hashable {
        case subscribe
        case manageAppStore
        case manageOnTheWeb(URL)
        case manageAtWebsite
        case restore
    }

    /// The App Store storefront, once asked.
    enum StorefrontRead: Equatable {
        case unread
        /// Three letters ("USA"), or nil when the store has none.
        case read(String?)
    }

    /// The rows for `plan` in a build that `sells`. A comp, and any grant the app cannot manage,
    /// gets Restore alone. A web subscriber is linked to the portal only on the US storefront,
    /// where the App Store allows it, and gets no manage row until the storefront is read, so
    /// the row never changes under the musician.
    nonisolated static func actions(_ plan: Plan, sells: Bool, storefront: StorefrontRead, portalURL: URL?)
        -> [Action]
    {
        guard sells else { return [] }
        var actions: [Action] = []
        if plan.canSubscribe { actions.append(.subscribe) }
        switch plan.source {
        case .apple: actions.append(.manageAppStore)
        case .stripe:
            switch (storefront, portalURL) {
            case (.unread, _): break
            case (.read("USA"), let portalURL?): actions.append(.manageOnTheWeb(portalURL))
            case (.read, _): actions.append(.manageAtWebsite)
            }
        default: break
        }
        actions.append(.restore)
        return actions
    }

    /// The storefront, read only for a web subscriber, the one plan whose rows depend on it.
    static func storefront(for plan: Plan, client: (any PurchaseClient)?) async -> String? {
        guard plan.source == .stripe, let client else { return nil }
        return await client.storefrontCountryCode()
    }

    static func subscribe(_ premium: PremiumPresenter?) {
        premium?.present(.plan, from: .planGroup)
    }

    static func manage(_ client: (any PurchaseClient)?) async {
        await client?.showManageSubscriptions()
    }

    /// The outcome under Restore: a restore's, never a purchase's.
    static func restoreLine(_ purchase: PurchaseModel) -> String? {
        guard purchase.lineFrom == .restore else { return nil }
        return purchase.line.map(PlanText.line)
    }

    var body: some View {
        if let name = PlanText.name(plan) {
            Section {
                planRow(name)
                    .task(id: plan.source) {
                        storefront = .unread
                        storefront = .read(await Self.storefront(for: plan, client: purchases))
                    }
                if let storage {
                    StorageMeter(storage: storage)
                }
                ForEach(
                    Self.actions(plan, sells: purchase != nil, storefront: storefront, portalURL: portalURL), id: \.self
                ) { action in
                    row(action)
                }
            } header: {
                SettingsHelp(
                    plan.kind == .free ? "\(PlanText.freeHelp) \(PlanText.freeStorageHelp)" : nil,
                    title: PlanText.group)
            } footer: {
                if let purchase, let line = Self.restoreLine(purchase) {
                    Text(line)
                }
            }
        }
    }

    @ViewBuilder private func row(_ action: Action) -> some View {
        let working = purchase?.isWorking ?? true
        switch action {
        case .subscribe:
            Button(PlanText.subscribe) { Self.subscribe(premium) }
                .disabled(working)
        case .manageAppStore:
            Button(PlanText.manageAppStore) {
                managing = true
                Task {
                    await Self.manage(purchases)
                    managing = false
                }
            }
            .disabled(managing)
            .coversShell(managing)
        case .manageOnTheWeb(let url):
            Link(PlanText.manageOnTheWeb, destination: url)
        case .manageAtWebsite:
            Text(PlanText.manageAtWebsite)
        case .restore:
            Button(PlanText.restorePurchases) {
                Task { await purchase?.restore() }
            }
            .disabled(working)
        }
    }

    /// A trial's row counts days against the clock; every other row is static.
    @ViewBuilder private func planRow(_ name: String) -> some View {
        if plan.isTrial {
            TimelineView(.everyMinute) { context in
                row(name, detail: PlanText.detail(plan, now: context.date))
            }
        } else {
            row(name, detail: PlanText.detail(plan, now: .now))
        }
    }

    @ViewBuilder private func row(_ name: String, detail: String?) -> some View {
        if let detail {
            LabeledContent(name, value: detail)
        } else {
            Text(name)
        }
    }
}
