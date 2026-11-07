import SwiftUI

/// Pushes the tab's recording page, kept by the shell in `path`, over the screen this modifies
/// while `isActive`, and the tune Go to tune pushed over the page. The path is handed in rather
/// than read here, since a pushed screen takes the stack's environment, not its declaring
/// screen's. Only the topmost screen of a tab is active, so the page is pushed over a pushed tune
/// rather than under it; an inactive screen reads no page and pushes nothing.
struct PushesRecordingPage: ViewModifier {
    let path: ShellValue<PagePath>?
    let isActive: Bool

    func body(content: Content) -> some View {
        content.navigationDestination(item: shown) { id in
            RecordingPage(
                recordingID: id, parent: RecordingPageParent(showsClose: false) { path?.value.recording = nil }
            )
            .navigationDestination(item: shownTune) { tuneID in
                TuneScreen(tuneID: tuneID)
                    // What the pushed tune opens is pushed over it, and the shell does not keep it.
                    .environment(\.stackPath, nil)
            }
        }
    }

    private var shownTune: Binding<String?> {
        Binding {
            path?.value.pageTune
        } set: { id in
            if let path, path.value.pageTune != id { path.value.pageTune = id }
        }
    }

    private var shown: Binding<String?> {
        Binding {
            isActive ? path?.value.recording : nil
        } set: { id in
            if isActive, let path, path.value.recording != id { path.value.recording = id }
        }
    }
}
