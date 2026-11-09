import CrosstuneDesign
import SwiftUI

/// Every cut as a choice chip; a tap selects it, and a tap on the selected one lets it go. The
/// Mac draws each as a button toggle.
struct SplitCutList: View {
    @Bindable var model: SplitModel

    var body: some View {
        if !model.state.cuts.isEmpty {
            FlowLayout(spacing: 8) {
                ForEach(model.state.identifiedCuts.enumerated(), id: \.element.id) { index, cut in
                    let time = RecordingScreenText.preciseTime(milliseconds: cut.ms - model.bounds.lowerBound)
                    #if os(macOS)
                        Toggle(time, isOn: $model[cutSelected: index])
                            .toggleStyle(.button)
                            .monospacedDigit()
                    #else
                        Chip(.choice(isChosen: model.state.selected == index)) {
                            model.select(index)
                        } label: {
                            Text(time).monospacedDigit()
                        }
                    #endif
                }
            }
        }
    }
}

/// Previous cut and Next cut, each half the row. The Mac draws the system's bordered buttons.
struct SplitCutSteps: View {
    let model: SplitModel

    var body: some View {
        HStack(spacing: 12) {
            Button(action: model.previous) {
                Text(RecordingScreenText.previousCut).frame(maxWidth: .infinity)
            }
            .disabled(!model.canStepPrevious)
            Button(action: model.next) {
                Text(RecordingScreenText.nextCut).frame(maxWidth: .infinity)
            }
            .disabled(!model.canStepNext)
        }
        .buttonStyle(.tinted(macLook: .bordered))
        .controlSize(.large)
    }
}
