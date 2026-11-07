import CrosstuneDesign
import SwiftUI

/// Practice | Details. Practice, while the plan holds recordings back, offers the plan instead.
struct RecordingPageTabPicker: View {
    /// The tab shown, which the picker sets only to a tab that can be used now.
    @Binding var tab: RecordingPageTab
    let recordingsPlay: Bool
    let onBlocked: () -> Void

    private var shown: RecordingPageTab {
        RecordingPageArrangement.isEnabled(tab, recordingsPlay: recordingsPlay) ? tab : .details
    }

    var body: some View {
        let selection = Binding {
            shown
        } set: { chosen in
            if let accepted = RecordingPageArrangement.pick(chosen, recordingsPlay: recordingsPlay) {
                tab = accepted
            } else {
                onBlocked()
            }
        }
        return Picker(RecordingPageCopy.tabs, selection: selection) {
            ForEach(RecordingPageTab.allCases) { tab in
                Text(tab.label).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .controlsColumn()
        #if os(macOS)
            .padding(.horizontal, MacStyle.pageMargin)
            .padding(.top, MacStyle.headingGap)
        #else
            .padding(.horizontal, 16)
            .padding(.top, 8)
        #endif
    }
}
