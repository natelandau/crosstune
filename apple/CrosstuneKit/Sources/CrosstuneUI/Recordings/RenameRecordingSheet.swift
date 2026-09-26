import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Observation
import SwiftUI
import os

/// The rename sheet's state: the typed name and the one save it makes. A blank name clears the
/// recording's own name, so it goes back to being named for its tune or when it was made.
@MainActor
@Observable
public final class RenameRecordingModel {
    public let recordingID: String
    public var name: String
    public private(set) var isSaving = false
    /// Set once a save lands, so a second press saves nothing more.
    public private(set) var isSaved = false
    /// The last save's failure, cleared as the name is retyped.
    public private(set) var failure: String?

    private let store: CrosstuneStore
    private let opened: String
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "rename-recording")

    public init(store: CrosstuneStore, recordingID: String, label: String?) {
        self.store = store
        self.recordingID = recordingID
        name = label ?? ""
        opened = label ?? ""
    }

    /// Whether the sheet holds a name a dismissal would lose.
    public var isEdited: Bool { name != opened }

    public func setName(_ name: String) {
        self.name = name
        failure = nil
    }

    /// Saves the trimmed name, or clears it when blank. True once the save lands.
    public func save() async -> Bool {
        guard !isSaving, !isSaved else { return false }
        isSaving = true
        failure = nil
        defer { isSaving = false }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let recordingID = recordingID
        do {
            try await Commands(store: store).updateRecording(
                recordingID, label: .value(trimmed.isEmpty ? nil : trimmed))
            isSaved = true
            return true
        } catch {
            Self.logger.warning("A recording rename failed: \(error)")
            failure = ListModel.message(error)
            return false
        }
    }
}

/// One box for a recording's name, over whatever screen asked. Reads the store from the
/// environment.
public struct RenameRecordingSheet: View {
    public static let title = "Rename recording"
    public static let nameLabel = "Recording name"
    public static let placeholder = "Jam at Tom’s, take 2, …"

    private let view: RecordingView

    @Environment(\.store) private var store
    @State private var model: RenameRecordingModel?

    public init(view: RecordingView) {
        self.view = view
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let model {
                    RenameRecordingForm(model: model)
                } else {
                    Color.clear
                }
            }
            .navigationTitle(Self.title)
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
            model = RenameRecordingModel(store: store, recordingID: view.id, label: view.recording.label)
        }
    }
}

private struct RenameRecordingForm: View {
    let model: RenameRecordingModel

    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        let name = Binding {
            model.name
        } set: {
            model.setName($0)
        }
        Form {
            Section {
                TextField(
                    RenameRecordingSheet.nameLabel, text: name, prompt: Text(RenameRecordingSheet.placeholder)
                )
                .characterLimit(Vocabulary.Limits.Recording.label, text: name)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit(save)
            } footer: {
                // The sheet's title already names the one field, so the section has no header.
                if let failure = model.failure {
                    Text(failure)
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
                Button(ListNameSheet.save, action: save)
                    .fontWeight(.semibold)
                    .disabled(model.isSaving || model.isSaved)
            }
        }
        .interactiveDismissDisabled(model.isEdited || model.isSaving)
        .onAppear { focused = true }
    }

    private func save() {
        Task {
            guard await model.save() else {
                focused = true
                return
            }
            dismiss()
        }
    }
}
