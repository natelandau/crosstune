import SwiftUI

/// One tab: its value, an icon over a caption, and an optional live value shown after the title.
package struct PaneTab<Value: Hashable>: Identifiable {
    package let value: Value
    package let title: String
    package let systemImage: String
    package let valueText: String?

    package var id: Value { value }

    package init(_ value: Value, title: String, systemImage: String, valueText: String? = nil) {
        self.value = value
        self.title = title
        self.systemImage = systemImage
        self.valueText = valueText
    }

    /// The tab's spoken name: its title, then its value when it has one.
    package static func label(title: String, valueText: String?) -> String {
        valueText.map { "\(title) \($0)" } ?? title
    }

    fileprivate var label: String { Self.label(title: title, valueText: valueText) }
}

/// Which side a panel enters from when the chosen tab changes.
package enum PaneSlide {
    /// `.trailing` when the new tab lies after the old one in `order`, `.leading` when before,
    /// and nil when the tab is unchanged or either is missing from `order`.
    package static func edge<Value: Hashable>(from: Value, to: Value, order: [Value]) -> Edge? {
        guard let old = order.firstIndex(of: from), let new = order.firstIndex(of: to), old != new else {
            return nil
        }
        return new > old ? .trailing : .leading
    }
}

/// Equal-width tabs, an icon over a caption, with the current one on an accent-tinted pill that
/// slides to the choice. Arrow keys move the choice while the row holds focus. On the Mac it
/// draws the Mac tab bar.
package struct PaneTabs<Value: Hashable>: View {
    @Binding private var selection: Value
    private let tabs: [PaneTab<Value>]
    private let title: String

    /// - Parameter title: What VoiceOver names the row of tabs.
    package init(selection: Binding<Value>, tabs: [PaneTab<Value>], title: String = "") {
        _selection = selection
        self.tabs = tabs
        self.title = title
    }

    package var body: some View {
        #if os(macOS)
            MacTabBar(
                selection: $selection,
                tabs: tabs.map {
                    MacTabBar.Tab(
                        value: $0.value, title: $0.title, systemImage: $0.systemImage, valueText: $0.valueText)
                },
                title: title)
        #else
            PhonePaneTabs(selection: $selection, tabs: tabs, title: title)
        #endif
    }
}

/// Shows the content for `selection`. A change fades the old content out over 0.1 s and slides
/// the new in from the side of its tab while it fades in. Reduce Motion cross-fades. Sizing the
/// panel to the tallest tab is the screen's job.
package struct PaneTabPanel<Value: Hashable, Content: View>: View {
    private let selection: Value
    private let order: [Value]
    private let content: Content

    @Environment(\.layoutDirection) private var layoutDirection
    // The last settled choice. During the render that follows a change it still holds the
    // previous choice, which is what gives the slide its direction.
    @State private var settled: Value

    package init(selection: Value, order: [Value], @ViewBuilder content: () -> Content) {
        self.selection = selection
        self.order = order
        self.content = content()
        _settled = State(initialValue: selection)
    }

    package var body: some View {
        ZStack {
            content
                .id(selection)
                .phoneTransition(transition)
        }
        .phoneAnimation(Motion.state, value: selection)
        .onChange(of: selection) { _, new in settled = new }
    }

    private var transition: AnyTransition {
        let removal = AnyTransition.opacity.animation(.linear(duration: 0.1))
        guard let edge = PaneSlide.edge(from: settled, to: selection, order: order) else {
            return .asymmetric(insertion: .opacity, removal: removal)
        }
        let towardTrailing = (edge == .trailing) == (layoutDirection == .leftToRight)
        let offset = towardTrailing ? Motion.tabSlide : -Motion.tabSlide
        return .asymmetric(
            insertion: .offset(x: offset).combined(with: .opacity), removal: removal)
    }
}

#if !os(macOS)
    private struct PhonePaneTabs<Value: Hashable>: View {
        @Binding var selection: Value
        let tabs: [PaneTab<Value>]
        let title: String

        @Namespace private var pill
        @Environment(\.colorScheme) private var colorScheme
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @FocusState private var containerFocused: Bool
        @State private var bounces: [Value: Int] = [:]

        var body: some View {
            HStack(spacing: 4) {
                ForEach(tabs.enumerated(), id: \.element.id) { index, tab in
                    button(tab, index: index)
                }
            }
            .dynamicTypeSize(...DynamicTypeSize.large)
            .phoneAnimation(Motion.spring, reduced: nil, value: selection)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(ifSet: title)
            // Arrows move only while the row itself holds focus; a focused tab keeps the
            // system's focus movement.
            .focusable()
            .focused($containerFocused)
            .focusEffectDisabled()
            .onKeyPress(.leftArrow) { move(by: -1) }
            .onKeyPress(.rightArrow) { move(by: 1) }
            .onChange(of: selection) { _, new in
                guard !reduceMotion else { return }
                bounces[new, default: 0] += 1
            }
        }

        private func move(by step: Int) -> KeyPress.Result {
            guard containerFocused, let index = tabs.firstIndex(where: { $0.value == selection }) else {
                return .ignored
            }
            let next = min(max(index + step, 0), tabs.count - 1)
            guard next != index else { return .handled }
            selection = tabs[next].value
            return .handled
        }

        private func button(_ tab: PaneTab<Value>, index: Int) -> some View {
            let isCurrent = tab.value == selection
            return Button {
                selection = tab.value
            } label: {
                VStack(spacing: 3) {
                    Image(systemName: tab.systemImage)
                        .font(.title3)
                        .symbolEffect(.bounce, options: .nonRepeating, value: bounces[tab.value, default: 0])
                        .frame(height: 22)
                    caption(tab)
                }
                .foregroundStyle(isCurrent ? Palette.accent : Palette.textSecondary)
                .phoneAnimation(Motion.state, value: isCurrent)
                .frame(maxWidth: .infinity, minHeight: ControlMetrics.tabHeight)
                .background {
                    if isCurrent {
                        RoundedRectangle(cornerRadius: ControlMetrics.containerRadius)
                            .fill(Palette.tint(colorScheme))
                            .matchedGeometryEffect(id: "pill", in: pill)
                    }
                }
                .libraryFocusRing(
                    isCurrent && containerFocused, shape: RoundedRectangle(cornerRadius: ControlMetrics.containerRadius)
                )
                .contentShape(.rect(cornerRadius: ControlMetrics.containerRadius))
            }
            .buttonStyle(PaneTabButtonStyle())
            .libraryHover(.rect(cornerRadius: ControlMetrics.containerRadius))
            .accessibilityLabel(tab.label)
            .accessibilityHint("Tab \(index + 1) of \(tabs.count)")
            .accessibilityAddTraits(isCurrent ? .isSelected : [])
            .accessibilityShowsLargeContentViewer {
                Label(tab.label, systemImage: tab.systemImage)
            }
        }

        private func caption(_ tab: PaneTab<Value>) -> some View {
            // One attributed run per part keeps the value's tabular digits in a single masked Text.
            var line = AttributedString(tab.title)
            if let valueText = tab.valueText {
                var value = AttributedString(" " + valueText)
                value.font = .caption.weight(.medium).monospacedDigit()
                line += value
            }
            return Text(line)
                .font(.caption.weight(.semibold))
                .tracking(0.12)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .contentMask()
        }
    }

    extension View {
        /// Names the view for VoiceOver unless `label` is empty, which leaves the system's name.
        @ViewBuilder fileprivate func accessibilityLabel(ifSet label: String) -> some View {
            if label.isEmpty { self } else { accessibilityLabel(label) }
        }
    }

    /// Scales to 0.94 the moment a press starts and springs back on release. Reduce Motion
    /// leaves the tab still.
    private struct PaneTabButtonStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.label.pressScale(configuration.isPressed, to: 0.94)
        }
    }
#endif

#Preview("Pane tabs") {
    @Previewable @State var tab = 0
    VStack {
        PaneTabs(
            selection: $tab,
            tabs: [
                PaneTab(0, title: "Speed", systemImage: "gauge.with.dots.needle.33percent", valueText: "75%"),
                PaneTab(1, title: "Pitch", systemImage: "tuningfork"),
                PaneTab(2, title: "Loops", systemImage: "repeat"),
            ])
        PaneTabPanel(selection: tab, order: [0, 1, 2]) {
            Text(["Speed panel", "Pitch panel", "Loops panel"][tab]).frame(maxWidth: .infinity, minHeight: 80)
        }
    }
    .padding()
}
