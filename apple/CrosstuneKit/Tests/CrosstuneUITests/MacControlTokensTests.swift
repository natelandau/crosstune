#if os(macOS)
    import CrosstuneDesign
    import SwiftUI
    import Testing

    @MainActor
    struct MacControlTokensTests {
        @Test(arguments: [MacMotion.hover, MacMotion.state, MacMotion.spring])
        func reduceMotionTurnsEveryAnimationOff(_ animation: Animation) {
            #expect(MacMotion.animation(animation, reduceMotion: true) == nil)
            #expect(MacMotion.animation(animation, reduceMotion: false) != nil)
        }

        /// Every fill a control draws under a hover or press keeps its label at 4.5:1.
        @Test(arguments: [ColorScheme.light, .dark])
        func labelsPassContrastOnPressedAndHoveredFills(scheme: ColorScheme) {
            let text = Palette.hex(.textPrimary, scheme)
            let accent = Palette.hex(.accent, scheme)
            var pairs: [(name: String, label: String, fill: String)] = []
            for (name, label, fill) in [
                ("field", text, Palette.hex(.field, scheme)),
                ("surfaceRaised", text, Palette.hex(.surfaceRaised, scheme)),
                ("accentFill", Palette.hex(.onAccentFill, scheme), Palette.hex(.accentFill, scheme)),
            ] {
                let pressed = blend(text, over: fill, opacity: Palette.pressedOverlayOpacity)
                pairs.append(("\(name) pressed", label, pressed))
            }
            let tintLabel = Palette.onTintIsAccent(scheme) ? accent : text
            for background in [Palette.Token.pageBackground, .surface] {
                for state in [MacPressState.hover, .pressed] {
                    let opacity = MacControl.tintFillOpacity(state, scheme: scheme)
                    let fill = blend(accent, over: Palette.hex(background, scheme), opacity: opacity)
                    pairs.append(("tint \(state) on \(background)", tintLabel, fill))
                }
            }
            for pair in pairs {
                let ratio = contrastRatio(pair.label, pair.fill)
                #expect(ratio >= 4.5, "\(pair.name) in \(scheme): \(ratio)")
            }
        }
    }
#endif
