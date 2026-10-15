import CrosstuneStore
import SwiftUI

/// The Account page's Plan group: which plan the account is on, as a row that opens the Plan
/// sheet, and its storage against the plan's quota. Nothing shows while the plan is unknown.
struct PlanSection: View {
    let plan: Plan
    let storage: StorageFigures?

    @Environment(\.premium) private var premium

    /// What VoiceOver adds to the plan row, which opens the plan rather than changing it here.
    nonisolated static let hint = PlanText.seePlan

    /// Opens the Plan sheet, which sells to a free or trial account and confirms a Premium one.
    static func open(_ premium: PremiumPresenter?) {
        premium?.present(.plan, from: .planGroup)
    }

    var body: some View {
        if let name = PlanText.name(plan) {
            Section {
                planRow(name)
                if let storage {
                    StorageMeter(storage: storage)
                }
            } header: {
                SettingsHelp(
                    plan.kind == .free ? PlanText.freeHelp : nil,
                    title: PlanText.group)
            }
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

    private func row(_ name: String, detail: String?) -> some View {
        SettingsFieldRow(title: name, value: detail ?? "", hint: Self.hint) { Self.open(premium) }
    }
}
