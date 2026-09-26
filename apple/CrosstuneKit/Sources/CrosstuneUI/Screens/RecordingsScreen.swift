import CrosstuneStore
import CrosstuneSync
import SwiftUI
import UniformTypeIdentifiers

/// Every recording the musician has made or uploaded: the unfiled ones first, then one group per
/// tune in order of its newest recording, under the account's storage. iPhone's Recordings tab
/// and the sidebar's Recordings.
public struct RecordingsScreen: View {
    public static let emptyTitle = "No recordings yet"
    public static let emptyHint = "Use the record button to make one, or upload an audio file."
    /// The heading over captures that were never saved as recordings.
    public static let unfinishedHeader = "Not saved"

    @Environment(\.store) private var store
    @State private var model: RecordingsModel?

    public init() {}

    public var body: some View {
        Group {
            if let model {
                RecordingsContent(model: model)
            } else {
                // Loading is silence.
                Color.clear
            }
        }
        .navigationTitle(Destination.recordings.title)
        .task(id: store.map(ObjectIdentifier.init)) {
            guard let store else { return }
            model = RecordingsModel(store: store)
        }
    }
}

/// How much of the account's audio quota is spent.
struct StorageSummary: View {
    let storage: StorageFigures

    var body: some View {
        let text = SettingsModel.storageText(storage)
        VStack(alignment: .leading, spacing: 6) {
            Text(text)
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
            ProgressView(value: SettingsModel.storageFraction(storage))
                .accessibilityLabel(SettingsModel.storageUsed)
                .accessibilityValue(text)
        }
        .accessibilityElement(children: .contain)
    }
}

private struct RecordingsContent: View {
    let model: RecordingsModel

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.detailTune) private var detailTune
    @State private var pushed: String?
    @State private var importing = false
    @State private var renaming: RecordingView?
    @State private var filing: RecordingView?
    /// A tune the add to tune sheet asked to start, with the recording to file under it, opened
    /// once that sheet has gone.
    @State private var creating: (recordingID: String, target: TuneFormTarget)?
    @State private var form: CreatingTune?
    @State private var deleting: RecordingView?
    @State private var discarding: RecordingFile?
    @Namespace private var zoom

    /// The tune form opened from the add to tune sheet, and the recording it files once saved.
    private struct CreatingTune: Identifiable {
        let recordingID: String
        let target: TuneFormTarget

        var id: TuneFormTarget { target }
    }

    var body: some View {
        let groups = model.groups
        List {
            if let storage = model.storage {
                Section {
                    StorageSummary(storage: storage)
                }
            }
            if !model.unfinished.isEmpty {
                Section(RecordingsScreen.unfinishedHeader) {
                    ForEach(model.unfinished, id: \.id) { capture in
                        unfinishedRow(capture)
                    }
                }
            }
            ForEach(groups ?? []) { group in
                Section {
                    ForEach(group.views) { view in
                        row(view, tuneNamedAbove: group.tuneID != nil)
                    }
                } header: {
                    header(group)
                }
            }
        }
        .overlay {
            if groups?.isEmpty == true && model.unfinished.isEmpty {
                ContentUnavailableView {
                    Label(RecordingsScreen.emptyTitle, systemImage: Destination.recordings.systemImage)
                } description: {
                    Text(RecordingsScreen.emptyHint)
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let failure = model.failure {
                Text(failure)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(RecordingImport.upload, systemImage: "square.and.arrow.down") { importing = true }
                    .help(RecordingImport.uploadAudio)
                    .accessibilityLabel(RecordingImport.uploadAudio)
            }
        }
        .coversShell(importing)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
            switch result {
            case .success(let url): Task { await model.importAudio(from: url) }
            case .failure(let error): model.report(error)
            }
        }
        .modifier(RefreshesBySync(engine: engine))
        .modifier(PushesTune(tuneID: $pushed, isPushing: detailTune == nil, zoom: zoom))
        .sheet(item: $renaming) { view in
            RenameRecordingSheet(view: view)
        }
        .sheet(item: $filing, onDismiss: openCreated) { view in
            AddToTuneSheet(recordingID: view.id) { title in
                creating = (view.id, .new(title: title))
            }
        }
        .sheet(item: $form) { creating in
            TuneFormSheet(target: creating.target) { tuneID in
                Task { await file(creating.recordingID, under: tuneID) }
            }
        }
        .coversShell(deleting != nil)
        .confirmationDialog(
            RecordingsModel.deleteTitle,
            isPresented: Binding {
                deleting != nil
            } set: {
                if !$0 { deleting = nil }
            },
            titleVisibility: .visible, presenting: deleting
        ) { view in
            Button(RecordingRowActions.delete, role: .destructive) { delete(view) }
        } message: { view in
            Text(RecordingsModel.deleteMessage(view))
        }
        .coversShell(discarding != nil)
        .confirmationDialog(
            RecordingsModel.deleteTitle,
            isPresented: Binding {
                discarding != nil
            } set: {
                if !$0 { discarding = nil }
            },
            titleVisibility: .visible, presenting: discarding
        ) { capture in
            Button(RecordingRowActions.delete, role: .destructive) {
                Task { await model.discard(capture) }
            }
        } message: { _ in
            Text(RecordingsModel.deleteUnsyncedNote)
        }
    }

    private func row(_ view: RecordingView, tuneNamedAbove: Bool) -> some View {
        RecordingItem(view: view, tuneNamedAbove: tuneNamedAbove, storage: model.storage) { kind in
            retry(view.id, kind)
        }
        .recordingRowActions(
            filed: view.tuneID != nil,
            onRename: { renaming = view },
            onAddToTune: { filing = view },
            onRemoveFromTune: { Task { await model.removeFromTune(view.id) } },
            onDelete: { deleting = view })
    }

    /// A tune's heading opens the tune: pushed on iPhone, in the detail column on iPad and Mac.
    @ViewBuilder private func header(_ group: RecordingGroup) -> some View {
        if let tuneID = group.tuneID {
            Button {
                if let detailTune {
                    detailTune.wrappedValue = tuneID
                } else {
                    pushed = tuneID
                }
            } label: {
                HStack(spacing: 4) {
                    Text(group.title)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .matchedTransitionSource(id: tuneID, in: zoom)
            .accessibilityAddTraits(.isHeader)
        } else {
            Text(group.title)
        }
    }

    private func unfinishedRow(_ capture: RecordingFile) -> some View {
        let row = UnfinishedCaptureRowContent(capture: capture)
        let discard = Button(RecordingRowActions.delete, systemImage: "trash", role: .destructive) {
            discarding = capture
        }
        return MediaRow(
            glyph: .attention, title: row.title, secondLine: .text(UnfinishedCaptureRowContent.note),
            verb: row.verb, action: { discarding = capture }
        )
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { discard }
        .contextMenu { discard }
    }

    private func retry(_ recordingID: String, _ kind: RecordingText.Retry) {
        guard let transfers else { return }
        Task {
            do {
                try await transfers.retry(recordingID, kind)
            } catch {
                model.report(error)
            }
        }
    }

    private func delete(_ view: RecordingView) {
        // The player lets go of the audio before its file goes.
        if player?.holds(.recording, id: view.id) == true { player?.close() }
        Task { await model.delete(view.id) }
    }

    private func openCreated() {
        guard let creating else { return }
        form = CreatingTune(recordingID: creating.recordingID, target: creating.target)
        self.creating = nil
    }

    private func file(_ recordingID: String, under tuneID: String) async {
        await model.run { commands in
            do {
                try await commands.updateRecording(recordingID, tuneID: .value(tuneID))
            } catch {
                throw FilingFailed()
            }
        }
    }

    /// A filing under a tune started from the add to tune sheet, reported once the sheet has
    /// gone.
    private struct FilingFailed: LocalizedError {
        var errorDescription: String? { AddToTuneModel.failed }
    }
}
