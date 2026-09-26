import CrosstuneStore
import CrosstuneVocabulary
import SwiftUI

/// Adds one or more tunes to an existing list, or to a new one, over whatever screen asked.
/// Reads the store from the environment.
public struct ListPickerSheet: View {
    /// The tune screen's fixed title.
    public static let tuneTitle = "Add to a list"
    public static let newListItem = SidebarItem.newList
    public static let newListNameLabel = "New list name"
    public static let cancel = TuneFormSheet.cancel

    private let request: ListPickerRequest

    @Environment(\.store) private var store
    @State private var model: ListPickerModel?

    public init(request: ListPickerRequest) {
        self.request = request
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let model {
                    ListPickerContent(model: model, onAdded: request.onAdded)
                } else {
                    Color.clear
                }
            }
            .navigationTitle(request.title ?? ListPickerModel.title(count: Set(request.userTuneIDs).count))
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        #if os(iOS)
            .partHeightSheet()
        #else
            .frame(minWidth: 480, idealWidth: 480, minHeight: 320)
            .shellSheet()
        #endif
        .task {
            guard model == nil, let store else { return }
            model = ListPickerModel(
                store: store, userTuneIDs: request.userTuneIDs, excludeListID: request.excludeListID)
        }
    }
}

private struct ListPickerContent: View {
    @Bindable var model: ListPickerModel
    let onAdded: (@MainActor (ListAddition) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var creating = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        Form {
            if model.isLoaded {
                Section {
                    ForEach(model.rows) { row in
                        Button {
                            finish { await model.add(to: row) }
                        } label: {
                            HStack {
                                Text(row.name)
                                    .rowLineLimit()
                                Spacer()
                                if let note = row.note {
                                    Text(note)
                                        .monospacedDigit()
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .disabled(!row.isOffered || model.isPending)
                    }
                    newList
                } footer: {
                    if let failure = model.failure {
                        Text(failure)
                            .foregroundStyle(.red)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(ListPickerSheet.cancel) { dismiss() }
                    .disabled(model.isPending)
            }
        }
        .interactiveDismissDisabled(model.isPending)
    }

    @ViewBuilder private var newList: some View {
        if creating {
            HStack {
                TextField(
                    ListPickerSheet.newListNameLabel, text: $model.newName, prompt: Text(ListNameSheet.placeholder)
                )
                .characterLimit(Vocabulary.Limits.List.name, text: $model.newName)
                .focused($nameFocused)
                .submitLabel(.done)
                .onSubmit(create)
                Button(ListNameSheet.create, action: create)
                    .disabled(model.newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isPending)
            }
            .onAppear { nameFocused = true }
        } else {
            Button(ListPickerSheet.newListItem) { creating = true }
                .disabled(model.isPending)
        }
    }

    private func create() {
        finish { await model.create() }
    }

    private func finish(_ pick: @escaping @MainActor () async -> ListAddition?) {
        Task {
            guard let addition = await pick() else { return }
            onAdded?(addition)
            dismiss()
        }
    }
}
