import CrosstuneAnalytics
import CrosstuneDesign
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
    @Environment(\.analytics) private var analytics
    @State private var model: ListPickerModel?

    public init(request: ListPickerRequest) {
        self.request = request
    }

    private var title: String {
        request.title ?? ListPickerModel.title(count: Set(request.userTuneIDs).count)
    }

    public var body: some View {
        #if os(macOS)
            Group {
                if let model {
                    ListPickerContent(model: model, title: title, onAdded: request.onAdded)
                } else {
                    Color.clear.macSheetFrame(ListPickerContent.size)
                }
            }
            .shellSheet()
            .task { makeModel() }
        #else
            NavigationStack {
                Group {
                    if let model {
                        ListPickerContent(model: model, title: title, onAdded: request.onAdded)
                    } else {
                        Color.clear
                    }
                }
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
            }
            .partHeightSheet()
            .task { makeModel() }
        #endif
    }

    private func makeModel() {
        guard model == nil, let store else { return }
        model = ListPickerModel(
            store: store, userTuneIDs: request.userTuneIDs, excludeListID: request.excludeListID,
            analytics: analytics)
    }
}

private struct ListPickerContent: View {
    @Bindable var model: ListPickerModel
    let title: String
    let onAdded: (@MainActor (ListAddition) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var creating = false
    @FocusState private var nameFocused: Bool

    #if os(macOS)
        static let size = MacSheetSize.fitted(max: 520)

        var body: some View {
            MacSheet(
                title: title, size: Self.size,
                cancel: .cancel(ListPickerSheet.cancel, isEnabled: !model.isPending) { dismiss() }, primary: nil
            ) {
                VStack(alignment: .leading, spacing: 2) {
                    if model.isLoaded {
                        ForEach(model.rows) { row in
                            Button {
                                finish { await model.add(to: row) }
                            } label: {
                                HStack(spacing: 8) {
                                    MacPickGlyph(kind: glyph(row))
                                    Text(row.name)
                                        .contentMask()
                                        .rowLineLimit()
                                    Spacer(minLength: 8)
                                    if let note = row.note {
                                        Text(note)
                                            .font(MacStyle.secondary)
                                            .monospacedDigit()
                                            .foregroundStyle(Palette.textSecondary)
                                    }
                                }
                            }
                            .buttonStyle(.macPickRow)
                            .disabled(!row.isOffered || model.isPending)
                        }
                        macNewList
                        if let failure = model.failure {
                            FailureText(failure)
                                .padding(.top, 4)
                        }
                    }
                }
            }
            .interactiveDismissDisabled(model.isPending)
        }

        /// + for a list the pick adds to, a check for one that already holds every tune.
        private func glyph(_ row: ListPickerModel.Row) -> MacPickGlyph.Kind {
            if row.isOffered { return .add }
            return row.note == nil ? .none : .done
        }

        @ViewBuilder private var macNewList: some View {
            if creating {
                HStack(spacing: 8) {
                    MacPickGlyph(kind: .add)
                    newListField
                    Button(ListNameSheet.create, action: create)
                        .buttonStyle(.macSecondary)
                        .disabled(
                            model.newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isPending)
                }
                .padding(.horizontal, 8)
                .padding(.top, 4)
                .onAppear { nameFocused = true }
            } else {
                Button {
                    creating = true
                } label: {
                    HStack(spacing: 8) {
                        MacPickGlyph(kind: .add)
                        Text(ListPickerSheet.newListItem)
                    }
                }
                .buttonStyle(.macPickRow)
                .disabled(model.isPending)
            }
        }
    #endif

    private var newListField: some View {
        TextField(ListPickerSheet.newListNameLabel, text: $model.newName, prompt: Text(ListNameSheet.placeholder))
            .contentMask()
            #if os(macOS)
                .labelsHidden()
                .textFieldStyle(.macField)
            #endif
            .characterLimit(Vocabulary.Limits.List.name, text: $model.newName)
            .focused($nameFocused)
            .submitLabel(.done)
            .onSubmit(create)
    }

    #if os(iOS)
        var body: some View {
            GroupedForm {
                if model.isLoaded {
                    Section {
                        ForEach(model.rows) { row in
                            Button {
                                finish { await model.add(to: row) }
                            } label: {
                                HStack {
                                    Text(row.name)
                                        .foregroundStyle(nameStyle(row))
                                        .contentMask()
                                        .rowLineLimit()
                                    Spacer()
                                    if let note = row.note {
                                        Text(note)
                                            .monospacedDigit()
                                            .foregroundStyle(.textSecondary)
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
                                .foregroundStyle(Palette.danger)
                        }
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(ListPickerSheet.cancel) { dismiss() }
                        .disabled(model.isPending)
                }
            }
            .interactiveDismissDisabled(model.isPending)
        }

        /// A row that cannot add reads as inert, whether it is full or still loading.
        private func nameStyle(_ row: ListPickerModel.Row) -> AnyShapeStyle {
            row.isOffered ? AnyShapeStyle(.textPrimary) : AnyShapeStyle(.textSecondary)
        }

        @ViewBuilder private var newList: some View {
            if creating {
                HStack {
                    newListField
                    Button(ListNameSheet.create, action: create)
                        .disabled(
                            model.newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isPending)
                }
                .onAppear { nameFocused = true }
            } else {
                Button(ListPickerSheet.newListItem) { creating = true }
                    .disabled(model.isPending)
            }
        }
    #endif

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
