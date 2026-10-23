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
        #if os(macOS)
            // Every choice applies at once, so Escape closes it as Done does.
            MacSheet(
                title: CatalogFilterSheet.title, size: .fitted(.short), cancel: nil,
                primary: .init(CatalogFilterSheet.done) { dismiss() }, escape: { dismiss() }
            ) {
                Button(CatalogFilterSheet.reset) { Task { await model.resetSource() } }
                    .buttonStyle(.macPlain)
                    .disabled(model.filterCount == 0)
            } content: {
                MacFormSection {
                    sourcePicker
                }
            }
            .partHeightSheet()
        #else
            NavigationStack {
                PaperForm {
                    Section {
                        sourcePicker
                    }
                }
                .navigationTitle(CatalogFilterSheet.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: Self.resetPlacement) {
                        Button(CatalogFilterSheet.reset) {
                            Task { await model.resetSource() }
                        }
                        .disabled(model.filterCount == 0)
                    }
                    ConfirmToolbarItem {
                        Button(CatalogFilterSheet.done) { dismiss() }
                    }
                }
            }
            .partHeightSheet()
        #endif
    }

    @ViewBuilder private var sourcePicker: some View {
        let source = Binding {
            model.choice
        } set: { next in
            Task { await model.setChoice(next) }
        }
        #if os(macOS)
            MacPopUp(
                RecordingsListText.source, selection: source, options: model.sourceOptions,
                label: Self.label(for:), isSet: model.choice != RecordingsModel.allChoice)
        #else
            Picker(RecordingsListText.source, selection: source) {
                ForEach(model.sourceOptions, id: \.self) { option in
                    Text(Self.label(for: option)).tag(option)
                }
            }
        #endif
    }

    #if os(iOS)
        private static var resetPlacement: ToolbarItemPlacement { .topBarLeading }
    #endif
}

/// The set source as a removable capsule, the recordings list's first row while one is set.
struct RecordingsFilterBar: View {
    let choice: String
    let onReset: () -> Void

    var body: some View {
        RemoveFilterCapsule(label: RecordingsFilterSheet.label(for: choice), action: onReset)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The iPhone recordings list's first row while there is a source to choose: the Filters
/// capsule, then the set source as a removable token that wraps under it when the row is full.
struct RecordingsFilterRow: View {
    let choice: String
    /// How many filters are set, the model's `filterCount`.
    let count: Int
    let onFilters: () -> Void
    let onReset: () -> Void

    var body: some View {
        FlowLayout(spacing: 6, lineSpacing: 6) {
            FiltersButton(setCount: count, action: onFilters)
                .buttonStyle(FilterControlStyle(isSet: count > 0))
            if count > 0 {
                RemoveFilterCapsule(label: RecordingsFilterSheet.label(for: choice), action: onReset)
                    .phoneTransition(RemoveFilterCapsule.insertion)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .phoneAnimation(value: count)
    }
}
