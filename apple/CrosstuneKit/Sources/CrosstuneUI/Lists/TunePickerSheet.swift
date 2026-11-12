import CrosstuneAnalytics
import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// Searches the catalog and adds tunes to one list, several in one visit. Reads the store from
/// the environment.
public struct TunePickerSheet: View {
    public static let title = "Add tunes"

    private let listID: String
    private let onLateFailure: @MainActor (String) -> Void

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @State private var model: TunePickerModel?

    /// - Parameter onLateFailure: A pick or create failed after the sheet closed.
    public init(listID: String, onLateFailure: @escaping @MainActor (String) -> Void) {
        self.listID = listID
        self.onLateFailure = onLateFailure
    }

    public var body: some View {
        TunePicker(title: Self.title, selection: .many, model: model)
            .task {
                guard model == nil, let store else { return }
                model = TunePickerModel(
                    store: store, listID: listID, analytics: analytics, onLateFailure: onLateFailure)
            }
            .onDisappear { model?.close() }
            .shellSheet()
    }
}
