#if os(macOS)
    import AppKit
    import CrosstuneDesign
    import SwiftUI
    import Testing

    /// Every library menu, and every button the menu helpers style beside one, turns the system
    /// focus effect off, so only the library's keyboard ring shows.
    @MainActor @Suite(.serialized) struct MacMenuFocusTests {
        private static var seen: [Bool] = []

        /// Records whether the system focus effect reaches the label it stands in for.
        private struct FocusEffectProbe: View {
            @Environment(\.isFocusEffectEnabled) private var isEnabled

            var body: some View {
                Text(verbatim: "Probe").onAppear { MacMenuFocusTests.seen.append(isEnabled) }
            }
        }

        /// Whether the system focus effect reached each probe in `view` once drawn.
        private func focusEffects(_ view: some View) -> [Bool] {
            Self.seen = []
            let host = NSHostingView(rootView: view.frame(width: 240, height: 120))
            let window = hiddenWindow(size: CGSize(width: 300, height: 200), styleMask: [], appearance: .aqua)
            defer { window.close() }
            window.contentView = host
            window.orderBack(nil)
            for _ in 0..<5 {
                host.layoutSubtreeIfNeeded()
                host.display()
                RunLoop.main.run(until: .now.addingTimeInterval(0.02))
            }
            return Self.seen
        }

        private var menu: some View {
            Menu {
                Button("Item") {}
            } label: {
                FocusEffectProbe()
            }
        }

        @Test func textButtonMenuAndTheButtonsBesideItDrawNoSystemRing() {
            let seen = focusEffects(
                HStack {
                    menu
                    Button {
                    } label: {
                        FocusEffectProbe()
                    }
                }
                .textButtonMenuAppearance())
            #expect(seen == [false, false])
        }

        @Test func iconButtonMenuDrawsNoSystemRing() {
            #expect(focusEffects(menu.iconButtonMenuAppearance()) == [false])
        }

        /// The menu every pop-up and pull-down draws.
        @Test func popUpMenuDrawsNoSystemRing() {
            let popUp = MacPopUpMenu(style: MacPopUpStyle()) {
                Button("Item") {}
            } label: {
                FocusEffectProbe()
            }
            #expect(focusEffects(popUp) == [false])
        }

        @Test func chipMenuDrawsNoSystemRing() {
            let chip = ChipMenu(isSet: false) {
                Button("Item") {}
            } label: {
                FocusEffectProbe()
            }
            #expect(focusEffects(chip) == [false])
        }
    }
#endif
