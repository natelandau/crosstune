import CrosstuneStore
import SwiftUI

/// The Account page's Plan group: which plan the account is on, and its storage against the
/// plan's quota. Nothing shows while the plan is unknown.
struct PlanSection: View {
    let plan: Plan
    let storage: StorageFigures?

    var body: some View {
        if let name = PlanText.name(plan) {
            Section {
                planRow(name)
                if let storage {
                    StorageMeter(storage: storage)
                }
            } header: {
                SettingsHelp(
                    plan.kind == .free ? "\(PlanText.freeHelp) \(PlanText.freeStorageHelp)" : nil,
                    title: PlanText.group)
            }
        }
    }

    /// A trial's row counts days against the clock; every other row is static.
    @ViewBuilder private func planRow(_ name: String) -> some View {
        if plan.source == "trial" {
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
