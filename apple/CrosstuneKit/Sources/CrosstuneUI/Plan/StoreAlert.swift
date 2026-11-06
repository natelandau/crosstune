import SwiftUI

/// A store failure, said in an alert over the sheet whose action failed rather than in its text.
struct StoreAlert: Equatable {
    let title: String
    let message: String

    static let unavailable = StoreAlert(
        title: PlanText.subscribeUnavailableTitle, message: PlanText.subscribeUnavailableMessage)
    static let subscribeFailed = StoreAlert(
        title: PlanText.subscribeFailedTitle, message: PlanText.subscribeFailedMessage)
    static let restoreFailed = StoreAlert(title: PlanText.restoreFailedTitle, message: PlanText.restoreFailedMessage)

    /// The alert a purchase or restore outcome raises, or nil for an outcome said in a line.
    nonisolated static func failure(_ line: PurchaseModel.Line?) -> StoreAlert? {
        switch line {
        case .failed: .subscribeFailed
        case .restoreFailed: .restoreFailed
        case .subscribed, .pending, .restored, .nothingToRestore, .otherAccount, nil: nil
        }
    }
}

extension View {
    /// Shows `alert` with the system's OK, and calls `onDismiss` once it is gone.
    func storeAlert(_ alert: StoreAlert?, onDismiss: @escaping () -> Void) -> some View {
        self
            .coversShell(alert != nil)
            .alert(
                alert?.title ?? "",
                isPresented: Binding {
                    alert != nil
                } set: { shown in
                    if !shown { onDismiss() }
                },
                presenting: alert
            ) { _ in
            } message: { alert in
                Text(alert.message)
            }
    }
}
