import SwiftUI

/// The recordings' filters: one Source section of All, Mine, then each import site. A choice
/// applies at once; Reset returns to All; Done closes the sheet.
struct RecordingsFilterSheet: View {
    let model: RecordingsModel

    @Environment(\.dismiss) private var dismiss

    /// A Source choice as the sheet and the screen's capsule name it.
    nonisolated static func label(for choice: String) -> String {
        choice == RecordingsModel.allChoice
            ? RecordingsListText.all : RecordingText.originLabel(choice) ?? RecordingsListText.mine
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(
                        RecordingsListText.source,
                        selection: Binding {
                            model.choice
                        } set: { next in
                            Task { await model.setChoice(next) }
                        }
                    ) {
                        ForEach(model.sourceOptions, id: \.self) { option in
                            Text(Self.label(for: option)).tag(option)
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(CatalogFilterSheet.title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: Self.resetPlacement) {
                    Button(CatalogFilterSheet.reset) {
                        Task { await model.resetSource() }
                    }
                    .disabled(model.filterCount == 0)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(CatalogFilterSheet.done) { dismiss() }
                }
            }
        }
        .partHeightSheet()
    }

    /// Reset leads the bar. On the Mac it stays off Escape, which a cancellation action takes.
    private static var resetPlacement: ToolbarItemPlacement {
        #if os(iOS)
            .topBarLeading
        #else
            .destructiveAction
        #endif
    }
}

/// The set source as a removable capsule, the recordings list's first row while one is set.
struct RecordingsFilterBar: View {
    let choice: String
    let onReset: () -> Void

    var body: some View {
        RemoveFilterCapsule(label: RecordingsFilterSheet.label(for: choice), action: onReset)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .chipRowInsets()
    }
}
