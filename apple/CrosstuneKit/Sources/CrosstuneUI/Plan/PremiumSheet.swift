import CrosstuneAnalytics
import CrosstuneStore
import SwiftUI

/// What a free account tapped that Premium holds, and the way to the Plan group.
struct PremiumSheet: View {
    nonisolated static let close = "Close"

    let reason: PremiumReason
    let onSeePlan: @MainActor () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.plan) private var plan
    @Environment(\.store) private var store
    @State private var scanTuneTitle: String?

    nonisolated static func title(_ reason: PremiumReason) -> String {
        switch reason {
        case .recordings: PlanText.premiumRecordingsTitle
        case .scans: PlanText.premiumScansTitle
        }
    }

    /// The body for `reason`, nil for scans until the scan tune's title is read.
    nonisolated static func message(_ reason: PremiumReason, scanTuneTitle: String?) -> String? {
        switch reason {
        case .recordings: PlanText.premiumRecordingsBody
        case .scans: scanTuneTitle.map { PlanText.premiumScansBody(tuneTitle: $0) }
        }
    }

    /// Room to grow, so the sheet's words never clip at the largest text sizes.
    nonisolated static let detents: Set<PresentationDetent> = [.medium, .large]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(Self.title(reason))
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                        .fixedSize(horizontal: false, vertical: true)
                    if let message = Self.message(reason, scanTuneTitle: scanTuneTitle) {
                        // The scans body names a tune.
                        Text(message)
                            .contentMask()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Button(PlanText.seePlan, action: onSeePlan)
                        .buttonStyle(.slateProminent)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Self.close) { dismiss() }
                }
            }
        }
        .task(id: plan?.scanTune) { await readScanTuneTitle() }
        .macSheetFrame(.form(minHeight: 220))
        .presentationDetents(Self.detents)
        .shellSheet()
    }

    private func readScanTuneTitle() async {
        guard reason == .scans, let store, let tuneID = plan?.scanTune else { return }
        scanTuneTitle = try? await store.read { db in
            try Tune.fetchOne(db, key: tuneID).flatMap { $0.deletedAt == nil ? $0.title : nil }
        }
    }
}

/// Presents the Premium sheet whenever the presenter asks for it.
struct PremiumSheets: ViewModifier {
    let presenter: PremiumPresenter?
    let onSeePlan: @MainActor () -> Void

    /// One showing of the sheet, for `sheet(item:)`.
    private struct Showing: Identifiable {
        let reason: PremiumReason
        var id: PremiumReason { reason }
    }

    func body(content: Content) -> some View {
        content
            .sheet(item: shown) { showing in
                PremiumSheet(reason: showing.reason, onSeePlan: onSeePlan)
            }
    }

    private var shown: Binding<Showing?> {
        Binding {
            presenter?.presented.map(Showing.init)
        } set: {
            presenter?.presented = $0?.reason
        }
    }
}
