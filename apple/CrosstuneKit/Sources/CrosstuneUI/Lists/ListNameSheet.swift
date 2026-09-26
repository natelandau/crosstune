import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import Observation
import SwiftUI
import os

/// What the list name sheet opens on: a new list, or a list to rename.
public enum ListNameTarget: Hashable, Identifiable, Sendable {
    case new
    case rename(listID: String, name: String)

    public var id: Self { self }
}

/// The list name sheet's state: the typed name and the one save it makes.
@MainActor
@Observable
public final class ListNameModel {
    public let target: ListNameTarget
    public var name: String
    public private(set) var isSaving = false
    /// Set once a save lands; the sheet never saves twice, so a second press makes no second list.
    public private(set) var isSaved = false
    /// Shown under the field after a save with no name.
    public private(set) var validation: String?
    /// The last save's failure, cleared as the name is retyped.
    public private(set) var failure: String?

    private let store: CrosstuneStore
    private let opened: String
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "list-name")

    public init(store: CrosstuneStore, target: ListNameTarget) {
        self.store = store
        self.target = target
        var opening = ""
        if case .rename(_, let name) = target { opening = name }
        name = opening
        opened = opening
    }

    public var isNew: Bool { target == .new }

    /// Whether the sheet holds a name a dismissal would lose.
    public var isEdited: Bool { name != opened }

    public func setName(_ name: String) {
        self.name = name
        validation = nil
        failure = nil
    }

    /// Creates or renames the list with the trimmed name. The list's id once the save lands; nil
    /// when it could not run or failed, with the reason in ``validation`` or ``failure``.
    public func save() async -> String? {
        guard !isSaving, !isSaved else { return nil }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            failure = nil
            validation = CommandError.listNameRequiredMessage
            return nil
        }
        isSaving = true
        validation = nil
        failure = nil
        defer { isSaving = false }
        let commands = Commands(store: store)
        do {
            let listID: String
            switch target {
            case .new:
                listID = try await commands.createList(trimmed)
            case .rename(let id, _):
                try await commands.renameList(id, name: trimmed)
                listID = id
            }
            isSaved = true
            return listID
        } catch {
            Self.logger.warning("A list name save failed: \(error)")
            failure = ListModel.message(error)
            return nil
        }
    }
}

/// Names a new list or renames one, over whatever screen asked. Reads the store from the
/// environment.
public struct ListNameSheet: View {
    public static let newTitle = "New list"
    public static let renameTitle = "Rename list"
    public static let nameLabel = "List name"
    public static let placeholder = "Tuesday jam, square dance set, …"
    public static let create = "Create"
    public static let save = "Save"

    private let target: ListNameTarget
    private let onSaved: (_ listID: String) -> Void

    @Environment(\.store) private var store
    @State private var model: ListNameModel?

    /// - Parameter onSaved: Runs once a save lands, with the list's id.
    public init(target: ListNameTarget, onSaved: @escaping (_ listID: String) -> Void = { _ in }) {
        self.target = target
        self.onSaved = onSaved
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let model {
                    ListNameForm(model: model, onSaved: onSaved)
                } else {
                    Color.clear
                }
            }
            .navigationTitle(target == .new ? Self.newTitle : Self.renameTitle)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        #if os(iOS)
            .partHeightSheet()
        #else
            .frame(minWidth: 480, idealWidth: 480, minHeight: 200)
            .shellSheet()
        #endif
        .task {
            guard model == nil, let store else { return }
            model = ListNameModel(store: store, target: target)
        }
    }
}

private struct ListNameForm: View {
    let model: ListNameModel
    let onSaved: (_ listID: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                TextField(
                    ListNameSheet.nameLabel,
                    text: Binding {
                        model.name
                    } set: {
                        model.setName($0)
                    },
                    prompt: Text(ListNameSheet.placeholder)
                )
                .characterLimit(
                    Vocabulary.Limits.List.name,
                    text: Binding {
                        model.name
                    } set: {
                        model.setName($0)
                    }
                )
                .focused($focused)
                .submitLabel(.done)
                .onSubmit(save)
            } footer: {
                // The sheet's title already names the one field, so the section has no header.
                if let message = model.validation ?? model.failure {
                    Text(message)
                        .foregroundStyle(.red)
                }
            }
        }
        .formStyle(.grouped)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(TuneFormSheet.cancel) { dismiss() }
                    .disabled(model.isSaving)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(model.isNew ? ListNameSheet.create : ListNameSheet.save, action: save)
                    .fontWeight(.semibold)
                    .disabled(model.isSaving || model.isSaved)
            }
        }
        .interactiveDismissDisabled(model.isEdited || model.isSaving)
        .onAppear { focused = true }
    }

    private func save() {
        Task {
            guard let listID = await model.save() else {
                focused = true
                return
            }
            onSaved(listID)
            dismiss()
        }
    }
}
