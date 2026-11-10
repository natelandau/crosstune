import SwiftUI

/// A set of tools beside content, each with its own controls. On iPhone and iPad: tabs over the
/// chosen tool's controls, with every tool's controls laid out unseen so the panel holds the
/// tallest one's height and a change of tool never moves what sits above it. On the Mac: a row
/// of ``MacToolButton``s, each opening its controls in a popover, one open at a time.
package struct ToolPanel<Value: Hashable, Content: View, Between: View>: View {
    @Binding private var selection: Value
    private let tools: [PaneTab<Value>]
    private let isChanged: (Value) -> Bool
    private let isAvailable: Bool
    private let title: String
    private let content: (Value) -> Content
    private let between: Between
    private let onOpenChange: (Value?) -> Void
    private let focusOutside: () -> Void
    private let openBinding: Binding<Value?>?

    #if os(macOS)
        @State private var ownOpen: Value?
        /// Set while the row itself closes a popover, so only a close made through `open` from
        /// outside moves focus to the tool.
        @State private var closesHere = false
        /// The tool whose popover Escape closed, waiting to take focus back.
        @State private var focusReturnsTo: Value?
        /// The tool whose popover is on screen, which lags `open` while a popover closes.
        @State private var popoverShown: Value?
        @FocusState private var focusedTool: Value?
        @Environment(\.controlActiveState) private var windowState
    #else
        @Environment(\.spacing) private var spacing
    #endif

    /// - Parameters:
    ///   - isChanged: Whether a tool's value is off its default, which its Mac button shows in
    ///     the accent.
    ///   - isAvailable: False disables the tools and closes an open popover.
    ///   - title: What VoiceOver names the set of tools.
    ///   - open: On the Mac, the tool whose popover shows, for a caller that closes it, as a
    ///     screen's own Escape does. Setting it to nil from outside returns focus to that tool.
    ///     Nil keeps it inside the row. iPhone and iPad never read it.
    ///   - onOpenChange: On the Mac, the open tool, or nil, as the row appears and whenever it
    ///     changes. iPhone and iPad, where the chosen tool's controls always show, never call it.
    ///   - focusOutside: Moves focus to a stop outside the tools, for when going unavailable
    ///     disables the tool or popover that holds it.
    ///   - between: Drawn between the tabs and the chosen tool's controls on iPhone and iPad.
    ///     The Mac, where the controls open in a popover, leaves it out.
    package init(
        selection: Binding<Value>, tools: [PaneTab<Value>], isChanged: @escaping (Value) -> Bool,
        isAvailable: Bool, title: String, open: Binding<Value?>? = nil,
        onOpenChange: @escaping (Value?) -> Void = { _ in }, focusOutside: @escaping () -> Void = {},
        @ViewBuilder content: @escaping (Value) -> Content, @ViewBuilder between: () -> Between
    ) {
        _selection = selection
        self.tools = tools
        self.isChanged = isChanged
        self.isAvailable = isAvailable
        self.title = title
        self.content = content
        self.between = between()
        self.onOpenChange = onOpenChange
        self.focusOutside = focusOutside
        openBinding = open
    }

    /// The tool open after `toggling` is chosen while `current` is open: the chosen tool, or none
    /// when it was the open one.
    package nonisolated static func open(_ current: Value?, toggling tool: Value) -> Value? {
        current == tool ? nil : tool
    }

    /// The tool left open once the tools' availability is `availability`.
    package nonisolated static func openAfter(availability: Bool, open: Value?) -> Value? {
        availability ? open : nil
    }

    /// Whether focus moves out of the tools once their availability is `availability`: going
    /// unavailable disables every tool, so focus on one, or in an open popover, would be lost.
    package nonisolated static func focusLeaves(availability: Bool, open: Value?, focused: Value?) -> Bool {
        !availability && (open != nil || focused != nil)
    }

    /// The tool to focus after Escape closed its popover: the waiting tool, once its popover is
    /// off screen and the window holds the keyboard again. Focus asked for sooner is lost as the
    /// popover's window hands the keyboard back.
    package nonisolated static func focusReturn(pending: Value?, popoverShown: Value?, windowIsKey: Bool) -> Value? {
        popoverShown == nil && windowIsKey ? pending : nil
    }

    /// The tool whose popover is on screen once `tool`'s popover comes on or goes off. One
    /// popover can go after the next has come on, which leaves the next one on screen.
    package nonisolated static func popoverShown(_ current: Value?, tool: Value, shows: Bool) -> Value? {
        shows ? tool : (current == tool ? nil : current)
    }

    package var body: some View {
        #if os(macOS)
            macRow
        #else
            VStack(spacing: spacing.sectionGap) {
                PaneTabs(selection: $selection, tabs: tools, title: title)
                    .dimmedWhenDisabled(!isAvailable)
                between
                ZStack(alignment: .top) {
                    ForEach(tools) { tool in
                        content(tool.value)
                            .environment(\.isToolShown, false)
                            .hiddenKeepingRoom()
                    }
                    PaneTabPanel(selection: selection, order: tools.map(\.value)) {
                        content(selection)
                    }
                }
                .dimmedWhenDisabled(!isAvailable)
            }
        #endif
    }

    #if os(macOS)
        private var macRow: some View {
            HStack(spacing: 8) {
                ForEach(tools) { tool in
                    MacToolButton(
                        tool.title, systemImage: tool.systemImage, value: tool.valueText,
                        isChanged: isChanged(tool.value), isPresented: isOpen(tool.value),
                        onEscape: { focusReturnsTo = tool.value },
                        onPopoverShown: { popoverShown = Self.popoverShown(popoverShown, tool: tool.value, shows: $0) }
                    ) {
                        content(tool.value)
                    }
                    .focused($focusedTool, equals: tool.value)
                }
            }
            .frame(maxWidth: .infinity)
            .disabled(!isAvailable)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(title)
            .onAppear { onOpenChange(open) }
            .onChange(of: open) { old, open in
                onOpenChange(open)
                if open != nil {
                    focusReturnsTo = nil
                } else if let old, !closesHere {
                    focusReturnsTo = old
                }
                closesHere = false
            }
            .onChange(of: isAvailable) { _, isAvailable in availabilityChanged(to: isAvailable) }
            .onChange(of: focusReturnsTo) { returnFocus() }
            .onChange(of: popoverShown) { returnFocus() }
            .onChange(of: windowState) { returnFocus() }
        }

        private func returnFocus() {
            guard
                let tool = Self.focusReturn(
                    pending: focusReturnsTo, popoverShown: popoverShown, windowIsKey: windowState == .key)
            else { return }
            focusReturnsTo = nil
            // A turn later, so the window has settled the focus it restores on taking the keyboard.
            DispatchQueue.main.async { focusedTool = tool }
        }

        private var open: Value? {
            get { openBinding?.wrappedValue ?? ownOpen }
            nonmutating set {
                if let openBinding { openBinding.wrappedValue = newValue } else { ownOpen = newValue }
            }
        }

        private func availabilityChanged(to isAvailable: Bool) {
            let leaves = Self.focusLeaves(availability: isAvailable, open: open, focused: focusedTool)
            let after = Self.openAfter(availability: isAvailable, open: open)
            if after != open { closesHere = true }
            open = after
            if leaves { focusOutside() }
        }

        /// Whether `tool`'s popover shows. Opening it chooses the tool.
        private func isOpen(_ tool: Value) -> Binding<Bool> {
            Binding {
                open == tool
            } set: { shows in
                guard shows != (open == tool) else { return }
                closesHere = true
                open = Self.open(open, toggling: tool)
                if open == tool { selection = tool }
            }
        }
    #endif
}

extension ToolPanel where Between == EmptyView {
    package init(
        selection: Binding<Value>, tools: [PaneTab<Value>], isChanged: @escaping (Value) -> Bool,
        isAvailable: Bool, title: String, open: Binding<Value?>? = nil,
        onOpenChange: @escaping (Value?) -> Void = { _ in }, focusOutside: @escaping () -> Void = {},
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.init(
            selection: selection, tools: tools, isChanged: isChanged, isAvailable: isAvailable, title: title,
            open: open, onOpenChange: onOpenChange, focusOutside: focusOutside, content: content,
            between: { EmptyView() })
    }
}

extension EnvironmentValues {
    /// False for a tool's controls laid out unseen to hold the panel's height, so live work such
    /// as an outline that follows playback runs only in the copy that shows.
    @Entry package var isToolShown = true
}

extension View {
    /// Disables the view and dims it, so a blocked control reads as unavailable.
    package func dimmedWhenDisabled(_ isDisabled: Bool) -> some View {
        disabled(isDisabled).opacity(isDisabled ? 0.5 : 1)
    }
}

#if !os(macOS)
    extension View {
        /// Keeps the view's room with nothing there that can be seen, pressed, focused, or read.
        fileprivate func hiddenKeepingRoom() -> some View {
            opacity(0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                .disabled(true)
        }
    }
#endif
