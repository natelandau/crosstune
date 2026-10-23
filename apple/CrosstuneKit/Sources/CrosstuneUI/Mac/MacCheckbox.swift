#if os(macOS)
    import SwiftUI

    /// The Mac's checkbox, drawn in ``Palette`` colors so it never turns gray in an inactive
    /// window as AppKit's does: a secondary-ink outline at rest, the accent fill with a white
    /// check when on. VoiceOver and Full Keyboard Access reach it as the system checkbox.
    struct MacCheckboxStyle: ToggleStyle {
        static let side: CGFloat = 14
        static let radius: CGFloat = 4
        static let strokeWidth: CGFloat = 1
        /// The outline at rest, which holds 3:1 on every Mac fill a row sits on.
        static let restStroke = Palette.Token.inkSecondary
        static let onFill = Palette.Token.accentFill
        static let check = Palette.Token.onAccentFill

        func makeBody(configuration: Configuration) -> some View {
            MacCheckboxBody(configuration: configuration)
        }
    }

    extension ToggleStyle where Self == MacCheckboxStyle {
        static var macCheckbox: Self { MacCheckboxStyle() }
    }

    private struct MacCheckboxBody: View {
        let configuration: ToggleStyle.Configuration

        @Environment(\.backgroundProminence) private var prominence
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: MacCheckboxStyle.radius)
            Button {
                configuration.isOn.toggle()
            } label: {
                ZStack {
                    if configuration.isOn {
                        shape.fill(Palette.accentFill)
                        Image(systemName: "checkmark")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Palette.onAccentFill)
                    } else {
                        shape.strokeBorder(Palette.inkSecondary, lineWidth: MacCheckboxStyle.strokeWidth)
                    }
                }
                // A thin white ring keeps the box apart from a key window's blue selection.
                .overlay {
                    if prominence == .increased {
                        shape.strokeBorder(Palette.onAccentFill, lineWidth: MacCheckboxStyle.strokeWidth)
                    }
                }
                .frame(width: MacCheckboxStyle.side, height: MacCheckboxStyle.side)
                .padding(4)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity)
            .accessibilityRepresentation {
                Toggle(isOn: configuration.$isOn) { configuration.label }
                    .toggleStyle(.checkbox)
            }
        }
    }
#endif
