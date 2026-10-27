#if os(macOS)
    import CrosstuneDesign
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @Suite struct MacControlsTests {
        /// The chosen segment reads raised, lighter than the field track, in both appearances.
        /// Its fill takes only the appearance, so an inactive window draws it the same.
        @Test(arguments: [ColorScheme.light, .dark])
        func macSegmentedKeepsSelectionVisibleWhenInactive(scheme: ColorScheme) {
            // Lighter means further from black.
            let chosen = contrastRatio(Palette.hex(MacSegmented<Int>.chosenFillToken, scheme), "#000000")
            let track = contrastRatio(Palette.hex(.field, scheme), "#000000")
            #expect(chosen > track, "\(scheme)")
        }

        /// A segment's label and its badge read on the chosen token and on the bare track.
        @Test(arguments: [ColorScheme.light, .dark])
        func macSegmentedTextPassesContrast(scheme: ColorScheme) {
            for back in [Palette.hex(MacSegmented<Int>.chosenFillToken, scheme), Palette.hex(.field, scheme)] {
                #expect(contrastRatio(Palette.hex(.textPrimary, scheme), back) >= 4.5, "\(scheme) label on \(back)")
                #expect(
                    contrastRatio(Palette.hex(.textSecondary, scheme), back) >= 4.5, "\(scheme) badge on \(back)")
            }
        }

        @Test func macSegmentSpeaksItsBadge() {
            #expect(MacSegmentTrack<Int>.spokenName("Speed", badge: "75%") == "Speed 75%")
            #expect(MacSegmentTrack<Int>.spokenName("Loops", badge: nil) == "Loops")
        }

        @Test func macSliderSnapsToDetent() {
            let cents = -50.0...50.0
            #expect(MacSlider.snapped(0.9, in: cents, detent: 0) == 0)
            #expect(MacSlider.snapped(-0.9, in: cents, detent: 0) == 0)
            #expect(MacSlider.snapped(1.5, in: cents, detent: 0) == 1.5)
            #expect(MacSlider.snapped(0.9, in: cents, detent: nil) == 0.9)
            let speed = 25.0...200.0
            #expect(MacSlider.snapped(101.5, in: speed, detent: 100) == 100)
            #expect(MacSlider.snapped(103, in: speed, detent: 100) == 103)
        }

        @Test func macSliderStepsWithinItsRange() {
            #expect(MacSlider.stepped(48, by: 5, in: -50...50) == 50)
            #expect(MacSlider.stepped(-48, by: -5, in: -50...50) == -50)
            #expect(MacSlider.stepped(0, by: 1, in: -50...50) == 1)
        }

        /// The checkbox's outline at rest holds 3:1 on every fill a row sits on, and its check
        /// reads on the accent fill.
        @Test(arguments: [ColorScheme.light, .dark])
        func macCheckboxPassesContrast(scheme: ColorScheme) {
            let stroke = Palette.hex(MacCheckboxStyle.restStroke, scheme)
            for background in [Palette.Token.pageBackground, .surface, .field] {
                #expect(contrastRatio(stroke, Palette.hex(background, scheme)) >= 3, "\(background)")
            }
            #expect(
                contrastRatio(
                    Palette.hex(MacCheckboxStyle.check, scheme), Palette.hex(MacCheckboxStyle.onFill, scheme))
                    >= 4.5)
            #expect(MacCheckboxStyle.onFill == .accentFill)
        }

        /// The checkbox draws from the palette alone, so an inactive window never grays it, and
        /// every Mac checkbox is this one.
        @Test func everyMacCheckboxIsTheMacCheckbox() throws {
            let style = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Mac/MacCheckbox.swift")))
            #expect(!style.contains("controlActiveState"))
            #expect(!style.contains("appearsActive"))
            for file in SourceScan.files() where SourceScan.relative(file) != "Mac/MacCheckbox.swift" {
                let text = SourceScan.macCompiled(SourceScan.withoutComments(try SourceScan.text(at: file)))
                #expect(!text.contains(".toggleStyle(.checkbox)"), "\(SourceScan.relative(file))")
            }
        }

        /// Storage reads on one thin meter in the primary text color wherever it shows on the Mac, never the
        /// system's accent progress bar.
        @Test func storageShowsOnTheSharedMeter() throws {
            for name in ["Settings/StorageMeter.swift", "Recordings/StorageSummary.swift"] {
                let text = SourceScan.macCompiled(
                    SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: name))))
                #expect(text.contains("MacMeter(fraction:"), "\(name)")
                #expect(!text.contains("ProgressView("), "\(name)")
            }
            let meter = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Mac/MacMeter.swift")))
            #expect(!meter.contains("accent"))
            #expect(MacMeter.clamped(1.4) == 1)
            #expect(MacMeter.clamped(-0.2) == 0)
        }

        /// A form group's help sits in its subtitle under the heading or in a row's second line,
        /// never under the card, so the section takes no footer.
        @Test func formSectionsTakeNoFooter() throws {
            let form = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Mac/MacForm.swift")))
            #expect(!form.contains("footer"))
            let call = try Regex(#"MacFormSection\([^{]*footer:"#)
            for file in SourceScan.files() {
                let text = SourceScan.withoutComments(try SourceScan.text(at: file))
                #expect(!text.contains(call), "\(SourceScan.relative(file))")
            }
        }

        @Test func practiceMetricsAreTheSpecs() {
            #expect(MacStyle.stageRadius == 12)
            #expect(MacStyle.transportDiameter == 44)
        }
    }
#endif
