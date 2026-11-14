import CrosstuneDesign
import SwiftUI

/// Practice | Details. While the plan holds recordings back, the page shows Details.
struct RecordingPageTabPicker: View {
    @Binding var tab: RecordingPageTab
    let recordingsPlay: Bool

    var body: some View {
        let selection = Binding {
            recordingsPlay ? tab : .details
        } set: {
            tab = $0
        }
        return tabs(selection)
            .controlsColumn()
            #if os(macOS)
                .padding(.horizontal, MacStyle.pageMargin)
                .padding(.top, MacStyle.headingGap)
            #else
                .padding(.horizontal, 16)
                .padding(.top, 8)
            #endif
    }

    private func tabs(_ selection: Binding<RecordingPageTab>) -> some View {
        PaneTabs(
            selection: selection,
            tabs: RecordingPageTab.allCases.map { PaneTab($0, title: $0.label, systemImage: $0.systemImage) },
            title: RecordingPageCopy.tabs)
    }
}
