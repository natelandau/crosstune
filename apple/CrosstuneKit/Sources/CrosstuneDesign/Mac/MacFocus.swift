#if os(macOS)
    import AppKit
    import Observation
    import SwiftUI

    /// What moved focus last, which decides whether a focused control draws its ring.
    package enum MacFocusSource: Equatable {
        case none, keyboard, pointer

        /// An event that can change the source.
        package enum Input {
            case tab, backTab, arrow, pointerDown, windowOpened, otherKey
        }

        package static func next(after input: Input, from source: Self) -> Self {
            switch input {
            case .tab, .backTab, .arrow: .keyboard
            case .pointerDown: .pointer
            case .windowOpened: .none
            case .otherKey: source
            }
        }

        /// A text field rings while it is edited however editing started; any other control only
        /// once the keyboard moved focus to it.
        package static func showsRing(isFocused: Bool, source: MacFocusSource, isTextField: Bool) -> Bool {
            isFocused && (isTextField || source == .keyboard)
        }

        /// Controls other than text fields take Tab only under the system Keyboard navigation
        /// setting, as AppKit controls do.
        package static func joinsTabOrder(isTextField: Bool, keyboardNavigation: Bool) -> Bool {
            isTextField || keyboardNavigation
        }

        /// The input a key press is. An arrow inside a text field moves the caret, not focus.
        package static func input(keyCode: UInt16, modifiers: NSEvent.ModifierFlags, inTextField: Bool) -> Input {
            switch keyCode {
            case 48: modifiers.contains(.shift) ? .backTab : .tab
            case 123...126: inTextField ? .otherKey : .arrow
            default: .otherKey
            }
        }

        /// Whether a window becoming key is one opening. The window that last gave up key taking
        /// it back, as when the app comes forward again, opens nothing, so its ring stays.
        package static func opensWindow(becameKey: ObjectIdentifier?, lastResignedKey: ObjectIdentifier?) -> Bool {
            becameKey == nil || becameKey != lastResignedKey
        }
    }

    /// The app's one record of what moved focus last, fed by AppKit's event stream.
    @MainActor @Observable package final class MacFocusTracker {
        package static let shared = MacFocusTracker()

        package private(set) var source: MacFocusSource = .none
        package private(set) var keyboardNavigation: Bool

        @ObservationIgnored private var eventMonitor: Any?
        @ObservationIgnored private var observers: [NSObjectProtocol] = []
        @ObservationIgnored private var lastResignedKey: ObjectIdentifier?

        private init() {
            keyboardNavigation = NSApp?.isFullKeyboardAccessEnabled ?? false
            eventMonitor = NSEvent.addLocalMonitorForEvents(
                matching: [.keyDown, .leftMouseDown, .rightMouseDown]
            ) { event in
                let input: MacFocusSource.Input =
                    event.type == .keyDown
                    ? MacFocusSource.input(
                        keyCode: event.keyCode, modifiers: event.modifierFlags,
                        inTextField: event.window?.firstResponder is NSText)
                    : .pointerDown
                MainActor.assumeIsolated { MacFocusTracker.shared.receive(input) }
                return event
            }
            let center = NotificationCenter.default
            observers = [
                center.addObserver(forName: NSWindow.didResignKeyNotification, object: nil, queue: .main) { note in
                    let window = (note.object as AnyObject?).map(ObjectIdentifier.init)
                    MainActor.assumeIsolated { MacFocusTracker.shared.lastResignedKey = window }
                },
                center.addObserver(forName: NSWindow.didBecomeKeyNotification, object: nil, queue: .main) { note in
                    let window = (note.object as AnyObject?).map(ObjectIdentifier.init)
                    MainActor.assumeIsolated { MacFocusTracker.shared.windowBecameKey(window) }
                },
                center.addObserver(
                    forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
                ) { _ in
                    MainActor.assumeIsolated { MacFocusTracker.shared.refreshKeyboardNavigation() }
                },
            ]
        }

        private func receive(_ input: MacFocusSource.Input) {
            let next = MacFocusSource.next(after: input, from: source)
            // Skip same-value writes so typing never invalidates every ring.
            if next != source { source = next }
        }

        private func windowBecameKey(_ window: ObjectIdentifier?) {
            if MacFocusSource.opensWindow(becameKey: window, lastResignedKey: lastResignedKey) {
                receive(.windowOpened)
            }
        }

        private func refreshKeyboardNavigation() {
            let enabled = NSApp.isFullKeyboardAccessEnabled
            if enabled != keyboardNavigation { keyboardNavigation = enabled }
        }
    }

    extension View {
        /// The Mac focus ring for a control that draws its own shape: a stroke in the full
        /// accent outside the shape, or inside it with `inset` (a row in a card), shown only when
        /// ``MacFocusSource/showsRing(isFocused:source:isTextField:)`` says so. Never animated.
        /// `token` replaces the accent for a ring that marks something else, such as an invalid
        /// field.
        package func macFocusRing(
            _ isFocused: Bool, cornerRadius: CGFloat, inset: Bool = false, isTextField: Bool = false,
            token: Palette.Token = MacControl.focusRingToken
        ) -> some View {
            modifier(
                MacFocusRingModifier(
                    isFocused: isFocused, shape: RoundedRectangle(cornerRadius: cornerRadius), inset: inset,
                    isTextField: isTextField, token: token))
        }

        /// The ring in any shape, for a control that is not a rounded rectangle.
        package func macFocusRing(_ isFocused: Bool, shape: some InsettableShape) -> some View {
            modifier(
                MacFocusRingModifier(
                    isFocused: isFocused, shape: shape, inset: false, isTextField: false,
                    token: MacControl.focusRingToken))
        }

        /// Makes a library control a focus stop with the system ring off. It joins the Tab order
        /// as ``MacFocusSource/joinsTabOrder(isTextField:keyboardNavigation:)`` says, and never
        /// while `isEnabled` is false.
        package func macFocusable(isTextField: Bool = false, isEnabled: Bool = true) -> some View {
            modifier(MacFocusableModifier(isTextField: isTextField, isEnabled: isEnabled))
        }
    }

    extension View {
        /// Steps a control that is one keyboard stop by -1 or 1: Left and Right always, and with
        /// `isAdjustable` also Down and Up and VoiceOver's adjust actions.
        package func macStepCommands(isAdjustable: Bool, step: @escaping (Int) -> Void) -> some View {
            modifier(MacStepCommands(isAdjustable: isAdjustable, step: step))
        }
    }

    private struct MacStepCommands: ViewModifier {
        let isAdjustable: Bool
        let step: (Int) -> Void

        func body(content: Content) -> some View {
            let moved = content.onMoveCommand { direction in
                switch direction {
                case .left: step(-1)
                case .right: step(1)
                case .down: if isAdjustable { step(-1) }
                case .up: if isAdjustable { step(1) }
                @unknown default: break
                }
            }
            if isAdjustable {
                moved.accessibilityAdjustableAction { direction in
                    switch direction {
                    case .decrement: step(-1)
                    case .increment: step(1)
                    @unknown default: break
                    }
                }
            } else {
                moved
            }
        }
    }

    extension View {
        /// Makes a view that draws its own content, such as a grid the arrow keys move through, one
        /// focus stop with the Mac ring in `shape`, joining the Tab order as a library control does.
        package func macFocusStop(shape: some InsettableShape) -> some View {
            modifier(MacFocusStop(shape: shape))
        }

        /// Marks the region whose hover shows each ``macRevealedOnHoverOrFocus()`` control in it.
        package func macRevealRegion() -> some View {
            modifier(MacRevealRegion())
        }

        /// Shows this control only while the pointer is over its ``macRevealRegion()`` or the
        /// control holds keyboard focus. Hidden, it keeps its place and still takes a click.
        package func macRevealedOnHoverOrFocus() -> some View {
            modifier(MacRevealed())
        }
    }

    private struct MacFocusStop<S: InsettableShape>: ViewModifier {
        let shape: S
        @FocusState private var focused: Bool

        func body(content: Content) -> some View {
            content.libraryFocus($focused, shape: shape)
        }
    }

    private struct MacRevealRegion: ViewModifier {
        @State private var isHovered = false

        func body(content: Content) -> some View {
            content
                .environment(\.macRevealRegionHovered, isHovered)
                .onHover { isHovered = $0 }
        }
    }

    private struct MacRevealed: ViewModifier {
        @Environment(\.macRevealRegionHovered) private var regionHovered
        @FocusState private var focused: Bool

        func body(content: Content) -> some View {
            content
                .focused($focused)
                // Not zero, which would drop the control from clicks and from VoiceOver.
                .opacity(regionHovered || focused ? 1 : 0.001)
        }
    }

    extension EnvironmentValues {
        /// Whether the pointer is over the nearest ``View/macRevealRegion()``.
        @Entry package var macRevealRegionHovered = false
    }

    extension View {
        /// Opens a window, sheet, or tab with focus on a stop beside the content that draws nothing
        /// and VoiceOver skips, so no control opens holding focus; Tab moves on from it to the
        /// first control. `isEnabled` false leaves the opening focus to the system, which puts it
        /// in the first text field.
        package func macOpensUnfocused(_ isEnabled: Bool = true) -> some View {
            modifier(MacOpensUnfocused(isEnabled: isEnabled))
        }
    }

    private struct MacOpensUnfocused: ViewModifier {
        let isEnabled: Bool
        @FocusState private var holdsFocus: Bool

        func body(content: Content) -> some View {
            content
                .background(alignment: .topLeading) {
                    Color.clear
                        .frame(width: 1, height: 1)
                        .focusable(isEnabled)
                        .focusEffectDisabled()
                        .focused($holdsFocus)
                        .accessibilityHidden(true)
                }
                .modifier(DefaultFocus(holdsFocus: $holdsFocus, isEnabled: isEnabled))
        }

        /// Asks for the opening focus only for a stop that can take it.
        private struct DefaultFocus: ViewModifier {
            let holdsFocus: FocusState<Bool>.Binding
            let isEnabled: Bool

            func body(content: Content) -> some View {
                if isEnabled {
                    content.defaultFocus(holdsFocus, true)
                } else {
                    content
                }
            }
        }
    }

    private struct MacFocusRingModifier<S: InsettableShape>: ViewModifier {
        let isFocused: Bool
        let shape: S
        let inset: Bool
        let isTextField: Bool
        let token: Palette.Token

        @Environment(\.macPreviewFocused) private var previewFocused

        func body(content: Content) -> some View {
            // Starts the tracker as the first ring draws, so it sees the Tab that focuses a control.
            let tracker = MacFocusTracker.shared
            // Only a focused control reads the source, so a change of source re-renders one ring.
            let showsRing =
                isFocused
                && MacFocusSource.showsRing(
                    isFocused: isFocused, source: previewFocused ? .keyboard : tracker.source,
                    isTextField: isTextField)
            content.overlay {
                shape.inset(by: inset ? 0 : -MacControl.focusRingWidth)
                    .strokeBorder(Palette.color(token), lineWidth: MacControl.focusRingWidth)
                    .opacity(showsRing ? 1 : 0)
                    .allowsHitTesting(false)
                    .transaction { $0.animation = nil }
            }
        }
    }

    extension View {
        /// Gives the button or menu it modifies a focus state and hands it to that control's style
        /// as ``EnvironmentValues/macButtonFocused``. A button style's body reads `isFocused` as
        /// false on the Mac even while its button holds focus.
        package func macButtonFocus() -> some View {
            modifier(MacButtonFocus())
        }
    }

    private struct MacButtonFocus: ViewModifier {
        @FocusState private var focused: Bool

        func body(content: Content) -> some View {
            content
                .focused($focused)
                .environment(\.macButtonFocused, focused)
        }
    }

    extension EnvironmentValues {
        /// Whether the button or menu a style draws holds focus, set by ``View/macButtonFocus()``.
        /// Every Mac button style reads this, never `isFocused`.
        @Entry package var macButtonFocused = false

        /// A gallery shows a control as if the keyboard had focused it: the control reads this as
        /// its focused state, and the ring as keyboard focus, so a control of several parts rings
        /// only the part that holds focus.
        @Entry package var macPreviewFocused = false
    }

    private struct MacFocusableModifier: ViewModifier {
        let isTextField: Bool
        let isEnabled: Bool

        func body(content: Content) -> some View {
            content
                .focusable(
                    isEnabled
                        && MacFocusSource.joinsTabOrder(
                            isTextField: isTextField, keyboardNavigation: MacFocusTracker.shared.keyboardNavigation),
                    interactions: .activate
                )
                .focusEffectDisabled()
        }
    }
#endif
