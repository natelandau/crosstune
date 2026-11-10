#if os(macOS)
    import SwiftUI

    /// A button that names a tool and shows its current value, and opens the tool's controls in a
    /// popover under it. A value off its default takes the accent. Return or Space opens the
    /// popover and moves focus into it; Escape closes it and focus goes back to the button.
    package struct MacToolButton<Popover: View>: View {
        private let title: String
        private let systemImage: String
        private let value: String?
        private let isChanged: Bool
        @Binding private var isPresented: Bool
        private let onEscape: () -> Void
        private let onPopoverShown: (Bool) -> Void
        private let popover: Popover

        /// - Parameter value: The tool's current value, shown after its name and read as part of
        ///   the button's name. Nil shows the name alone.
        /// - Parameter onEscape: Runs once Escape has closed the popover, so the caller, which holds
        ///   the button's focus binding, can return focus to it.
        /// - Parameter onPopoverShown: The popover came on screen, or went off it once closed.
        package init(
            _ title: String, systemImage: String, value: String?, isChanged: Bool, isPresented: Binding<Bool>,
            onEscape: @escaping () -> Void = {}, onPopoverShown: @escaping (Bool) -> Void = { _ in },
            @ViewBuilder popover: () -> Popover
        ) {
            self.title = title
            self.systemImage = systemImage
            self.value = value
            self.isChanged = isChanged
            _isPresented = isPresented
            self.onEscape = onEscape
            self.onPopoverShown = onPopoverShown
            self.popover = popover()
        }

        /// The button's spoken name: the tool's name, then its value when it has one.
        package nonisolated static func accessibilityName(title: String, value: String?) -> String {
            value.map { "\(title), \($0)" } ?? title
        }

        /// The glyph and value color.
        package nonisolated static func valueToken(isChanged: Bool) -> Palette.Token {
            isChanged ? .accent : .textSecondary
        }

        package var body: some View {
            let accent = Palette.color(Self.valueToken(isChanged: isChanged))
            Button {
                isPresented.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: systemImage)
                        .foregroundStyle(accent)
                    Text(title)
                        .fontWeight(.medium)
                        .foregroundStyle(Palette.textPrimary)
                    if let value {
                        Text(value)
                            .fontWeight(.semibold)
                            .monospacedDigit()
                            .foregroundStyle(accent)
                    }
                }
            }
            .buttonStyle(MacFocusEffectOff(MacToolButtonBody(isOpen: isPresented)))
            .onKeyPress(.return) {
                isPresented = true
                return .handled
            }
            .accessibilityLabel(Self.accessibilityName(title: title, value: value))
            .popover(isPresented: $isPresented, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(title)
                        .font(MacStyle.secondary.weight(.semibold))
                        .foregroundStyle(Palette.textSecondary)
                        .accessibilityAddTraits(.isHeader)
                    popover
                }
                .padding(14)
                .frame(width: 360)
                .macOpensUnfocused()
                // Unhandled key presses in the popover reach the views around the button, so the
                // popover takes Escape before a page's own Escape can close the page under it.
                .onKeyPress(.escape, phases: .down) { _ in
                    closeOnEscape()
                    return .handled
                }
                // Escape can reach the window as its cancel command rather than as a key press.
                .onExitCommand(perform: closeOnEscape)
                .onAppear { onPopoverShown(true) }
                .onDisappear { onPopoverShown(false) }
            }
        }

        private func closeOnEscape() {
            isPresented = false
            onEscape()
        }
    }

    private struct MacToolButtonBody: ButtonStyle {
        let isOpen: Bool

        func makeBody(configuration: Configuration) -> some View {
            MacToolButtonLabel(configuration: configuration, isOpen: isOpen)
        }
    }

    private struct MacToolButtonLabel: View {
        let configuration: ButtonStyle.Configuration
        let isOpen: Bool

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macButtonFocused) private var isFocused
        @Environment(\.colorScheme) private var scheme
        @Environment(\.macContainer) private var container
        @Environment(\.macPreviewFocused) private var previewFocused
        private var pointer = MacPointer()

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: MacControl.radius)
            configuration.label
                .font(MacStyle.body)
                .lineLimit(1)
                .padding(.horizontal, MacButtonStyle.horizontalPadding(.regular))
                .frame(height: MacControl.regularHeight)
                .background {
                    if isOpen {
                        // The tint presses to tintStrong rather than taking an overlay, which
                        // would leave the label short of 4.5:1.
                        shape.fill(MacControl.tintFill(state, scheme: scheme))
                        shape.strokeBorder(Palette.tintStrong(scheme), lineWidth: 1)
                    } else {
                        shape.fill(container.controlColor)
                        shape.fill(state.overlay)
                    }
                }
                .macControlEdge(container, scheme: scheme, cornerRadius: MacControl.radius, isShown: !isOpen)
                .contentShape(shape)
                .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
                .macFocusRing(isFocused || previewFocused, cornerRadius: MacControl.radius)
                .macPointer(pointer, state: state)
        }

        private var state: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }
    }
#endif
