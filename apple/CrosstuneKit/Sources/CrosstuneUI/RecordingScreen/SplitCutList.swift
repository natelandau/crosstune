import CrosstuneDesign
import SwiftUI

/// Every cut, each selectable; a tap on the selected one lets it go.
struct SplitCutList: View {
    @Bindable var model: SplitModel

    var body: some View {
        if !model.state.cuts.isEmpty {
            FlowLayout(spacing: 8) {
                ForEach(model.state.cuts.enumerated(), id: \.offset) { index, cut in
                    Toggle(
                        RecordingScreenText.preciseTime(milliseconds: cut - model.bounds.lowerBound),
                        isOn: $model[cutSelected: index]
                    )
                    .toggleStyle(.button)
                    .monospacedDigit()
                }
            }
        }
    }
}
