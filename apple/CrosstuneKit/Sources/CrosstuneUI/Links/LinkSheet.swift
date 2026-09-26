import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import SwiftUI

/// Pastes a link to a recording elsewhere onto a tune, over whatever screen asked. Reads the
/// store and, when there is one, the sync engine from the environment.
public struct LinkSheet: View {
    public static let pasteTitle = "Paste link"
    public static let add = "Add link"
    public static let linkHeader = "Link"
    public static let labelHeader = "Label"
    public static let linkPlaceholder = "Paste a YouTube, Spotify, or other link"
    public static let labelPlaceholder = "slow version, jam recording, …"

    private let tuneID: String

    @Environment(\.store) private var store
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @State private var model: LinkSheetModel?

    public init(tuneID: String) {
        self.tuneID = tuneID
    }

    private var resolver: LinkSheetModel.Resolve? {
        guard let engine else { return nil }
        return { url in await engine.resolveLink(url) }
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let model {
                    LinkForm(model: model)
                } else {
                    Color.clear
                }
            }
            .navigationTitle(Self.pasteTitle)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        #if os(iOS)
            .partHeightSheet()
        #else
            .frame(minWidth: 480, idealWidth: 480, minHeight: 240)
            .shellSheet()
        #endif
        .task {
            guard model == nil, let store else { return }
            model = LinkSheetModel(store: store, tuneID: tuneID, resolve: resolver)
        }
    }
}

private struct LinkForm: View {
    private enum Field {
        case link, label
    }

    let model: LinkSheetModel

    @Environment(\.dismiss) private var dismiss
    @FocusState private var focus: Field?

    var body: some View {
        Form {
            Section {
                TextField(LinkSheet.linkHeader, text: urlBinding, prompt: Text(LinkSheet.linkPlaceholder))
                    .characterLimit(Vocabulary.Limits.Link.url, text: urlBinding)
                    #if os(iOS)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                    .focused($focus, equals: .link)
                    .submitLabel(.next)
                    .onSubmit { focus = .label }
            } header: {
                Text(LinkSheet.linkHeader)
            } footer: {
                if let message = model.validation ?? model.failure {
                    Text(message)
                        .foregroundStyle(.red)
                } else if let preview = model.preview {
                    Text(preview)
                        .lineLimit(2)
                }
            }
            Section {
                TextField(LinkSheet.labelHeader, text: labelBinding, prompt: Text(LinkSheet.labelPlaceholder))
                    .characterLimit(Vocabulary.Limits.Link.label, text: labelBinding)
                    .focused($focus, equals: .label)
                    .submitLabel(.done)
                    .onSubmit(save)
            } header: {
                Text(LinkSheet.labelHeader)
            }
        }
        .formStyle(.grouped)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(TuneFormSheet.cancel) { dismiss() }
                    .disabled(model.isSaving)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(LinkSheet.add, action: save)
                    .fontWeight(.semibold)
                    .disabled(model.isSaving || model.isSaved)
            }
        }
        .interactiveDismissDisabled(model.isEdited || model.isSaving)
        .onAppear { focus = .link }
        .onDisappear { model.cancel() }
    }

    private var urlBinding: Binding<String> {
        Binding {
            model.url
        } set: {
            model.setURL($0)
        }
    }

    private var labelBinding: Binding<String> {
        Binding {
            model.label
        } set: {
            model.setLabel($0)
        }
    }

    private func save() {
        Task {
            guard await model.save() else {
                if model.validation != nil { focus = .link }
                return
            }
            dismiss()
        }
    }
}

/// A tune to paste a link onto, as the sheet's identity.
private struct PasteLinkRequest: Identifiable {
    let tuneID: String

    var id: String { tuneID }
}

/// The paste link sheet the tune screen asks for, presented once, over the whole shell.
struct LinkSheets: ViewModifier {
    @State private var request: PasteLinkRequest?
    @Environment(\.tuneScreenActions) private var tuneScreenActions

    func body(content: Content) -> some View {
        content
            .environment(\.tuneScreenActions, withPasteLink)
            .sheet(item: $request) { request in
                LinkSheet(tuneID: request.tuneID)
            }
    }

    /// The tune screen's actions as set further out, with Add link opening the sheet.
    private var withPasteLink: TuneScreenActions {
        var actions = tuneScreenActions
        actions.addLink = { tuneID in request = PasteLinkRequest(tuneID: tuneID) }
        return actions
    }
}
