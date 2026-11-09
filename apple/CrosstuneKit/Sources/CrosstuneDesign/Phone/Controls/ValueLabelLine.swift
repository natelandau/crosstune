import SwiftUI

/// A value control's label line: the title leading, then an optional quiet action such as Reset
/// and the control trailing. At accessibility sizes the title takes its own line and the action
/// and control go under it, so neither clips. The control carries the name for VoiceOver.
package struct ValueLabelLine<Action: View, Control: View>: View {
    private let title: String
    private let action: Action
    private let control: Control

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    package init(_ title: String, @ViewBuilder action: () -> Action, @ViewBuilder control: () -> Control) {
        self.title = title
        self.action = action()
        self.control = control()
    }

    package var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                titleText
                HStack(spacing: 12) {
                    action
                    Spacer(minLength: 0)
                    control
                }
            }
        } else {
            HStack(spacing: 12) {
                titleText
                Spacer(minLength: 0)
                action
                control
            }
        }
    }

    private var titleText: some View {
        Text(title)
            .font(.body)
            .foregroundStyle(Palette.textPrimary)
            .accessibilityHidden(true)
    }
}

extension ValueLabelLine where Action == EmptyView {
    package init(_ title: String, @ViewBuilder control: () -> Control) {
        self.init(title, action: { EmptyView() }, control: control)
    }
}

#Preview("Label line") {
    @Previewable @State var semitones = 2
    ValueLabelLine("Semitones") {
        ValueStepper("Semitones", value: $semitones, in: -12...12) { "\($0)" }
    }
    .padding()
}
