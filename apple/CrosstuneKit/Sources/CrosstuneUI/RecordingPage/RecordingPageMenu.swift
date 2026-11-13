import SwiftUI

/// The page's More actions menu: trim, split, the pin, Go to tune, the recording's origin, Share,
/// Export… on the Mac, and Delete, each disabled with its reason when it cannot be used now.
struct RecordingPageMenu: View {
    let rows: ScreenRows
    let goesToTune: Bool
    let trimDisabledReason: String?
    let splitDisabledReason: String?
    /// Why the recording cannot be shared or exported now. The plan never stops it.
    let exportDisabledReason: String?
    let recordingsPlay: Bool
    let onChoose: (RecordingMenuItem) -> Void

    /// Read here rather than on the page: on the Mac the action changes on every update while an
    /// editor is pushed over the page, so a page that read it would redraw without end.
    @Environment(\.openURL) private var openURL

    var body: some View {
        Menu {
            ForEach(
                RecordingMenuItem.items(
                    pinned: rows.userTuneID == nil ? nil : rows.playsFirst, goesToTune: goesToTune,
                    trimDisabledReason: trimDisabledReason,
                    splitDisabledReason: splitDisabledReason,
                    deleteDisabledReason: RecordingScreenText.deleteDisabledReason(rows.view),
                    exportDisabledReason: exportDisabledReason,
                    openOrigin: RecordingMenuItem.openOrigin(for: rows.recording), trims: recordingsPlay),
                id: \.self
            ) { item in
                if case .delete = item { Divider() }
                Button(role: item.isDelete ? .destructive : nil) {
                    choose(item)
                } label: {
                    Label {
                        Text(item.label)
                        if let reason = item.disabledReason { Text(reason) }
                    } icon: {
                        Image(systemName: item.systemImage)
                    }
                }
                .disabled(item.disabledReason != nil)
            }
        } label: {
            Label(TuneScreen.moreActions, systemImage: "ellipsis")
                .labelStyle(.iconOnly)
        }
        .help(TuneScreen.moreActions)
    }

    private func choose(_ item: RecordingMenuItem) {
        onChoose(item)
        if case .openOrigin(_, let page) = item { openURL(page) }
    }
}
