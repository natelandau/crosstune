#if os(macOS)
    import SwiftUI

    /// Mac tabs: each tab's glyph beside its label at natural width from the leading edge, with
    /// no track. The current tab draws in the accent, its label semibold, on a tint pill that
    /// slides to a new choice. One keyboard stop whose Left and Right arrows switch tabs;
    /// VoiceOver reads a tab bar, each tab with its value.
    package struct MacTabBar<Value: Hashable>: View {
        package struct Tab {
            package let value: Value
            package let title: String
            package let systemImage: String
            package let valueText: String?

            package init(value: Value, title: String, systemImage: String, valueText: String?) {
                self.value = value
                self.title = title
                self.systemImage = systemImage
                self.valueText = valueText
            }

            /// The tab's spoken name: its title, then its value when it has one.
            var spokenName: String { MacSegmentTrack<Value>.spokenName(title, badge: valueText) }
        }

        @Binding private var selection: Value
        private let tabs: [Tab]
        private let title: String

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macPreviewFocused) private var previewFocused
        @FocusState private var focused: Bool
        @Namespace private var pill

        /// - Parameter title: What VoiceOver names the tab bar.
        package init(selection: Binding<Value>, tabs: [Tab], title: String) {
            _selection = selection
            self.tabs = tabs
            self.title = title
        }

        package var body: some View {
            HStack(spacing: 2) {
                ForEach(tabs, id: \.value) { tab in
                    MacTab(
                        tab: tab, isCurrent: tab.value == selection, pill: pill,
                        showsRing: (focused || previewFocused) && tab.value == selection
                    ) {
                        selection = tab.value
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .macAnimation(MacMotion.spring, value: selection)
            .macFocusable()
            .focused($focused)
            .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
            .macStepCommands(isAdjustable: false) { step in
                if let next = MacSegmentTrack.moved(tabs.map(\.value), from: selection, by: step), next != selection {
                    selection = next
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isTabBar)
            .accessibilityLabel(title)
        }
    }

    private struct MacTab<Value: Hashable>: View {
        let tab: MacTabBar<Value>.Tab
        let isCurrent: Bool
        let pill: Namespace.ID
        let showsRing: Bool
        let action: () -> Void

        var body: some View {
            Button(action: action) {
                HStack(spacing: 5) {
                    Image(systemName: tab.systemImage)
                        .font(MacStyle.body)
                        .accessibilityHidden(true)
                    MacSteadyWidthLabel(isSemibold: isCurrent) { weight in
                        label.fontWeight(weight)
                    }
                }
                .foregroundStyle(isCurrent ? Palette.accent : Palette.textSecondary)
            }
            .buttonStyle(MacTabStyle(isCurrent: isCurrent, pill: pill))
            // The bar is the one focus stop; a tab never takes focus on its own.
            .focusable(false)
            .macFocusRing(showsRing, cornerRadius: MacControl.radius)
            .accessibilityLabel(tab.spokenName)
            .accessibilityAddTraits(isCurrent ? .isSelected : [])
        }

        /// The title, then the value in tabular digits when the tab has one.
        private var label: some View {
            var line = AttributedString(tab.title)
            if let valueText = tab.valueText {
                var value = AttributedString(" " + valueText)
                value.font = MacStyle.body.monospacedDigit()
                line += value
            }
            return Text(line).font(MacStyle.body).contentMask()
        }
    }

    private struct MacTabStyle: ButtonStyle {
        let isCurrent: Bool
        let pill: Namespace.ID

        func makeBody(configuration: Configuration) -> some View {
            MacTabBody(configuration: configuration, isCurrent: isCurrent, pill: pill)
        }
    }

    private struct MacTabBody: View {
        let configuration: ButtonStyle.Configuration
        let isCurrent: Bool
        let pill: Namespace.ID

        @Environment(\.colorScheme) private var scheme
        @Environment(\.macContainer) private var container
        private var pointer = MacPointer()

        var body: some View {
            configuration.label
                .lineLimit(1)
                .padding(.horizontal, MacButtonStyle.horizontalPadding(.regular))
                .frame(height: MacControl.regularHeight)
                .background {
                    let shape = RoundedRectangle(cornerRadius: MacControl.radius)
                    if isCurrent {
                        shape
                            .fill(MacControl.tintFill(state, scheme: scheme))
                            .matchedGeometryEffect(id: "pill", in: pill)
                    } else if state != .rest {
                        shape
                            .fill(container.controlColor)
                            .overlay(state.overlay, in: shape)
                    }
                }
                .contentShape(.rect(cornerRadius: MacControl.radius))
                .macPointer(pointer, state: state)
        }

        private var state: MacPressState {
            pointer.state(isPressed: configuration.isPressed)
        }
    }
#endif
