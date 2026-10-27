import CrosstuneAuth
import CrosstuneSync
import SwiftUI

/// An empty Recordings section's start card, the one way to add while there is nothing in it:
/// record, paste a link, or find one. Find goes where the add menu's Find goes, and refuses on
/// tap while it needs a connection.
struct FirstRecordingCard: View {
    static let title = "Add the first recording"
    static let hint = "Record it, paste a link, or find a version to learn from."
    static let record = RecordControl.shortLabel
    static let pasteLink = LinkSheet.pasteTitle
    /// Generic, whatever services the musician searches.
    static let findARecording = "Find a recording"

    let model: TuneModel
    let detail: TuneDetail

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.openURL) private var openURL
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @State private var find = FindPress()

    enum Action: Hashable {
        case record, pasteLink, find
    }

    /// The card's buttons: each only where it can act.
    nonisolated static func actions(record: Bool, pasteLink: Bool, find: Bool) -> [Action] {
        (record ? [.record] : []) + (pasteLink ? [.pasteLink] : []) + (find ? [.find] : [])
    }

    /// Whether Find has been pressed since the connection last changed, so its reason shows only
    /// for a press the connection refused, and goes once the connection comes or goes.
    @MainActor struct FindPress {
        private var pressed = false

        mutating func press() { pressed = true }

        mutating func connectionChanged() { pressed = false }

        func refusal(offline: Bool) -> String? {
            pressed && offline ? FindRecordingsModel.searchNeedsConnection : nil
        }
    }

    var body: some View {
        let offline = session?.isOffline ?? false
        let entry = FindRecordingsEntry(providers: detail.searchProviders)
        let shown = Self.actions(
            record: actions.record != nil, pasteLink: actions.addLink != nil,
            find: !entry.isDisabled(sheetAvailable: actions.findRecordings != nil))
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(Self.title)
                    .font(PageStyle.body.weight(.semibold))
                Text(Self.hint)
                    .font(PageStyle.secondary)
                    .foregroundStyle(.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !shown.isEmpty {
                FlowLayout(spacing: 8, lineSpacing: 8) {
                    ForEach(shown, id: \.self) { action in
                        button(action, entry: entry, offline: offline)
                    }
                }
            }
            if let refusal = find.refusal(offline: offline) {
                FailureText(refusal)
            }
        }
        .padding(PageStyle.startCardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay {
            RoundedRectangle(cornerRadius: PageStyle.surfaceRadius)
                .strokeBorder(Color.primary.opacity(0.22), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
        }
        .onChange(of: offline) { find.connectionChanged() }
    }

    @ViewBuilder private func button(_ action: Action, entry: FindRecordingsEntry, offline: Bool) -> some View {
        switch action {
        case .record:
            Button {
                actions.record?(detail.tune.id)
            } label: {
                Label {
                    Text(Self.record)
                } icon: {
                    Circle()
                        .fill(Palette.record)
                        .frame(width: 10, height: 10)
                }
            }
            .modifier(StartCardButton())
        case .pasteLink:
            Button(Self.pasteLink) { actions.addLink?(detail.tune.id) }
                .modifier(StartCardButton())
        case .find:
            Button(Self.findARecording) {
                find.press()
                model.findRecordings(
                    entry, for: detail, offline: offline, engine: engine, openSheet: actions.findRecordings,
                    open: { openURL($0) })
            }
            .modifier(StartCardButton())
        }
    }
}

/// The start card's buttons, in the platform's existing secondary style.
private struct StartCardButton: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
            content.buttonStyle(.macSecondary)
        #else
            content.buttonStyle(.bordered)
        #endif
    }
}
