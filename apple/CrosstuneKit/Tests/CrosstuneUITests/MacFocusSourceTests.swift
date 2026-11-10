#if os(macOS)
    import AppKit
    import CrosstuneDesign
    import Testing

    @Suite struct MacFocusSourceTests {
        @Test func tabSetsKeyboardSource() {
            for start in [MacFocusSource.none, .pointer, .keyboard] {
                #expect(MacFocusSource.next(after: .tab, from: start) == .keyboard)
                #expect(MacFocusSource.next(after: .backTab, from: start) == .keyboard)
                #expect(MacFocusSource.next(after: .arrow, from: start) == .keyboard)
            }
        }

        @Test func clickClearsKeyboardSource() {
            #expect(MacFocusSource.next(after: .pointerDown, from: .keyboard) == .pointer)
            #expect(MacFocusSource.next(after: .pointerDown, from: .none) == .pointer)
        }

        @Test func windowOpeningClearsTheSource() {
            for start in [MacFocusSource.none, .pointer, .keyboard] {
                #expect(MacFocusSource.next(after: .windowOpened, from: start) == .none)
            }
        }

        @Test func typingKeepsTheSource() {
            for start in [MacFocusSource.none, .pointer, .keyboard] {
                #expect(MacFocusSource.next(after: .otherKey, from: start) == start)
            }
        }

        @Test func ringShowsOnlyForKeyboardOrAField() {
            #expect(!MacFocusSource.showsRing(isFocused: true, source: .pointer, isTextField: false))
            #expect(MacFocusSource.showsRing(isFocused: true, source: .keyboard, isTextField: false))
            #expect(MacFocusSource.showsRing(isFocused: true, source: .pointer, isTextField: true))
            #expect(!MacFocusSource.showsRing(isFocused: false, source: .keyboard, isTextField: false))
            #expect(!MacFocusSource.showsRing(isFocused: true, source: .none, isTextField: false))
            #expect(!MacFocusSource.showsRing(isFocused: false, source: .pointer, isTextField: true))
        }

        struct KeyCase: Sendable, CustomTestStringConvertible {
            let keyCode: UInt16
            var modifiers: NSEvent.ModifierFlags = []
            var inTextField = false
            let input: MacFocusSource.Input

            var testDescription: String { "key \(keyCode) in field \(inTextField)" }
        }

        @Test(arguments: [
            KeyCase(keyCode: 48, input: .tab),
            KeyCase(keyCode: 48, modifiers: .shift, input: .backTab),
            KeyCase(keyCode: 48, inTextField: true, input: .tab),
            KeyCase(keyCode: 123, input: .arrow),
            KeyCase(keyCode: 126, input: .arrow),
            KeyCase(keyCode: 125, inTextField: true, input: .otherKey),
            KeyCase(keyCode: 0, modifiers: .command, input: .otherKey),
            KeyCase(keyCode: 36, input: .otherKey),
        ])
        func keysMapToTheirInput(_ key: KeyCase) {
            #expect(
                MacFocusSource.input(keyCode: key.keyCode, modifiers: key.modifiers, inTextField: key.inTextField)
                    == key.input)
        }

        @Test func onlyAnotherWindowTakingKeyOpensOne() {
            let windows = [NSObject(), NSObject()]
            let first = ObjectIdentifier(windows[0])
            let second = ObjectIdentifier(windows[1])
            #expect(!MacFocusSource.opensWindow(becameKey: first, lastResignedKey: first))
            #expect(MacFocusSource.opensWindow(becameKey: second, lastResignedKey: first))
            #expect(MacFocusSource.opensWindow(becameKey: first, lastResignedKey: nil))
            #expect(MacFocusSource.opensWindow(becameKey: nil, lastResignedKey: nil))
        }

        @Test func customControlsJoinTabOrderOnlyWithKeyboardNavigation() {
            #expect(!MacFocusSource.joinsTabOrder(isTextField: false, keyboardNavigation: false))
            #expect(MacFocusSource.joinsTabOrder(isTextField: false, keyboardNavigation: true))
            #expect(MacFocusSource.joinsTabOrder(isTextField: true, keyboardNavigation: false))
        }
    }
#endif
