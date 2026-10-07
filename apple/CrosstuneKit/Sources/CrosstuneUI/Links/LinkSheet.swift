import CrosstuneAnalytics
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
    public static let linkPlaceholder = "Paste a YouTube, Spotify, or other link"

    private let tuneID: String

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
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
            .macSheetFrame(.form(minHeight: 240))
            .shellSheet()
        #endif
        .task {
            guard model == nil, let store else { return }
            model = LinkSheetModel(store: store, tuneID: tuneID, resolve: resolver, analytics: analytics)
        }
    }
}

private struct LinkForm: View {
    let model: LinkSheetModel

    @Environment(\.dismiss) private var dismiss
    @FocusState private var linkFocused: Bool

    var body: some View {
        Form {
            Section {
                TextField(LinkSheet.linkHeader, text: urlBinding, prompt: Text(LinkSheet.linkPlaceholder))
                    .contentMask()
                    .characterLimit(Vocabulary.Limits.Link.url, text: urlBinding)
                    #if os(iOS)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                    .focused($linkFocused)
                    .submitLabel(.done)
                    .onSubmit(save)
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
        .onAppear { linkFocused = true }
        .onDisappear { model.cancel() }
    }

    private var urlBinding: Binding<String> {
        Binding {
            model.url
        } set: {
            model.setURL($0)
        }
    }

    private func save() {
        Task {
            guard await model.save() else {
                if model.validation != nil { linkFocused = true }
                return
            }
            dismiss()
        }
    }
}

/// A tune a sheet opens for, as the sheet's identity.
private struct TuneSheetRequest: Identifiable {
    let tuneID: String
    /// The one service the sheet opens straight on, if any.
    var service: String?

    var id: String { "\(tuneID) \(service ?? "")" }
}

/// The paste link and Find recordings sheets the tune screen asks for, each presented once,
/// over the whole shell.
struct LinkSheets: ViewModifier {
    @State private var pasting: TuneSheetRequest?
    @State private var finding: TuneSheetRequest?
    @Environment(\.tuneScreenActions) private var tuneScreenActions

    func body(content: Content) -> some View {
        content
            .environment(\.tuneScreenActions, withLinkSheets)
            .sheet(item: $pasting) { request in
                LinkSheet(tuneID: request.tuneID)
            }
            .sheet(item: $finding) { request in
                FindRecordingsSheet(tuneID: request.tuneID, service: request.service)
            }
    }

    /// The tune screen's actions as set further out, with Add link and Find recordings opening
    /// their sheets.
    private var withLinkSheets: TuneScreenActions {
        var actions = tuneScreenActions
        actions.addLink = { tuneID in pasting = TuneSheetRequest(tuneID: tuneID) }
        actions.findRecordings = { tuneID, service in finding = TuneSheetRequest(tuneID: tuneID, service: service) }
        return actions
    }
}
