#if os(macOS)
    import SwiftUI

    /// The Mac's checkbox, drawn in ``Palette`` colors so it never turns gray in an inactive
    /// window as AppKit's does: a secondary-text outline at rest, the accent fill with a white
    /// check when on. VoiceOver and Full Keyboard Access reach it as the system checkbox.
    package struct MacCheckboxStyle: ToggleStyle {
        package static let side: CGFloat = 14
        package static let radius: CGFloat = 4
        package static let strokeWidth: CGFloat = 1
        /// The outline at rest, which holds 3:1 on every Mac fill a row sits on.
        package static let restStroke = Palette.Token.textSecondary
        /// The outline under the pointer or a press.
        package static let hoverStroke = Palette.Token.textPrimary
        package static let onFill = Palette.Token.accentFill
        package static let check = Palette.Token.onAccentFill

        package init() {}

        package func makeBody(configuration: Configuration) -> some View {
            Button {
                configuration.isOn.toggle()
            } label: {
                EmptyView()
            }
            .buttonStyle(MacCheckboxButtonStyle(isOn: configuration.isOn))
            .focusEffectDisabled()
            .macButtonFocus()
            .accessibilityRepresentation {
                Toggle(isOn: configuration.$isOn) { configuration.label }
                    .toggleStyle(.checkbox)
            }
        }
    }

    extension ToggleStyle where Self == MacCheckboxStyle {
        package static var macCheckbox: Self { MacCheckboxStyle() }
    }

    private struct MacCheckboxButtonStyle: ButtonStyle {
        let isOn: Bool

        func makeBody(configuration: Configuration) -> some View {
            MacCheckboxBody(isOn: isOn, isPressed: configuration.isPressed)
        }
    }

    private struct MacCheckboxBody: View {
        let isOn: Bool
        let isPressed: Bool

        @Environment(\.backgroundProminence) private var prominence
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macButtonFocused) private var isFocused
        @Environment(\.macPreviewFocused) private var previewFocused
        private var pointer = MacPointer()

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: MacCheckboxStyle.radius)
            ZStack {
                shape.fill(isOn ? Palette.color(MacCheckboxStyle.onFill) : .clear)
                shape.fill(state.overlay)
                if !isOn {
                    shape.strokeBorder(
                        Palette.color(state == .rest ? MacCheckboxStyle.restStroke : MacCheckboxStyle.hoverStroke),
                        lineWidth: MacCheckboxStyle.strokeWidth)
                }
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Palette.color(MacCheckboxStyle.check))
                    .opacity(isOn ? 1 : 0)
                    .scaleEffect(isOn ? 1 : 0.4)
            }
            .macAnimation(MacMotion.state, value: isOn)
            // A thin white ring keeps the box apart from a key window's blue selection.
            .overlay {
                if prominence == .increased {
                    shape.strokeBorder(Palette.onAccentFill, lineWidth: MacCheckboxStyle.strokeWidth)
                }
            }
            .frame(width: MacCheckboxStyle.side, height: MacCheckboxStyle.side)
            .macFocusRing(isFocused || previewFocused, cornerRadius: MacCheckboxStyle.radius)
            .padding(4)
            .contentShape(.rect)
            .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
            .macPointer(pointer, state: state)
        }

        private var state: MacPressState {
            pointer.state(isPressed: isPressed)
        }
    }
#endif
