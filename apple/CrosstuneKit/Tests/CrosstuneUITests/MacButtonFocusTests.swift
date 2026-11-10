#if os(macOS)
    import AppKit
    @testable import CrosstuneDesign
    import SwiftUI
    import Testing

    /// Every library button and menu style sees its own control's focus, which a style body's
    /// `isFocused` never reports on the Mac, so the keyboard ring can draw.
    @MainActor
    @Suite(
        .serialized,
        .enabled(
            if: NSApplication.shared.isFullKeyboardAccessEnabled, "Buttons take focus only under Keyboard navigation")
    )
    struct MacButtonFocusTests {
        private static var seen: [String: Bool] = [:]

        /// A label that records whether the style drawing it sees its control focused.
        private struct Probe: View {
            let name: String
            @Environment(\.macButtonFocused) private var focused

            var body: some View {
                Text(verbatim: name)
                    .onAppear { MacButtonFocusTests.seen[name] = focused }
                    .onChange(of: focused) { _, focused in MacButtonFocusTests.seen[name] = focused }
            }
        }

        enum Control: String, CaseIterable {
            case button, libraryButton, chip, row, labelOnly, searchFilters, popUp, textMenu

            @MainActor @ViewBuilder var view: some View {
                let probe = Probe(name: rawValue)
                switch self {
                case .button:
                    Button {
                    } label: {
                        probe
                    }.buttonStyle(.mac(.secondary, size: .small))
                case .libraryButton:
                    Button {
                    } label: {
                        probe
                    }.buttonStyle(.tinted)
                case .chip:
                    Button {
                    } label: {
                        probe
                    }.buttonStyle(MacChipStyle(state: .rest, size: .standalone))
                case .row:
                    Button {
                    } label: {
                        probe
                    }.buttonStyle(.macRow)
                case .labelOnly:
                    Button {
                    } label: {
                        probe
                    }.buttonStyle(.labelOnly)
                case .searchFilters:
                    Button {
                    } label: {
                        probe
                    }.buttonStyle(SearchFiltersStyle(isSet: false))
                case .popUp:
                    MacPopUpMenu(style: MacPopUpStyle()) {
                        Button("Item") {}
                    } label: {
                        probe
                    }
                case .textMenu:
                    Menu {
                        Button("Item") {}
                    } label: {
                        probe
                    }.textButtonMenuAppearance()
                }
            }
        }

        /// What each probe in `view` saw once the window gave focus to its first control.
        private func seen(_ view: some View) -> [String: Bool] {
            Self.seen = [:]
            let host = NSHostingView(rootView: view.padding())
            let window = hiddenWindow(
                size: CGSize(width: 300, height: 200), styleMask: [.titled], appearance: .aqua, reportsKey: true)
            defer { window.close() }
            window.contentView = host
            window.orderBack(nil)
            for _ in 0..<20 {
                host.layoutSubtreeIfNeeded()
                host.display()
                RunLoop.main.run(until: .now.addingTimeInterval(0.02))
            }
            return Self.seen
        }

        @Test(arguments: Control.allCases)
        func focusedControlSeesItsFocus(_ control: Control) {
            #expect(seen(control.view) == [control.rawValue: true])
        }

        /// A menu helper styles a menu and the buttons beside it, and only the focused one sees focus.
        @Test(arguments: [true, false])
        func onlyTheFocusedControlBesideAMenuSeesFocus(menuFirst: Bool) {
            let menu = Menu {
                Button("Item") {}
            } label: {
                Probe(name: "menu")
            }
            let button = Button {
            } label: {
                Probe(name: "button")
            }
            let seen = seen(
                HStack {
                    if menuFirst {
                        menu
                        button
                    } else {
                        button
                        menu
                    }
                }
                .textButtonMenuAppearance())
            #expect(seen == ["menu": menuFirst, "button": !menuFirst])
        }

        /// The tracker reads the app's own key and mouse events, so Tab sets keyboard focus and a
        /// click clears it.
        @Test func appEventsSetTheFocusSource() throws {
            let window = hiddenWindow(size: CGSize(width: 100, height: 100), styleMask: [], appearance: .aqua)
            defer { window.close() }
            let tracker = MacFocusTracker.shared
            let click = try #require(
                NSEvent.mouseEvent(
                    with: .leftMouseDown, location: .zero, modifierFlags: [], timestamp: 0,
                    windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1))
            let tab = try #require(
                NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0,
                    windowNumber: window.windowNumber, context: nil, characters: "\t",
                    charactersIgnoringModifiers: "\t", isARepeat: false, keyCode: 48))
            NSApp.sendEvent(click)
            #expect(tracker.source == .pointer)
            NSApp.sendEvent(tab)
            #expect(tracker.source == .keyboard)
        }
    }
#endif
