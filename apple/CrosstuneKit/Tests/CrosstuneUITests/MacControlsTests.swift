#if os(macOS)
    import CrosstuneDesign
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @Suite struct MacControlsTests {
        /// A segment's label and its badge read on the chosen token and on the bare track, on
        /// every container.
        @Test(arguments: [ColorScheme.light, .dark])
        func macSegmentedTextPassesContrast(scheme: ColorScheme) {
            for container in MacContainer.allCases {
                let fills = [MacSegmented<Int>.chosenFillToken(on: container), container.controlFill]
                for back in fills.map({ Palette.hex($0, scheme) }) {
                    #expect(
                        contrastRatio(Palette.hex(.textPrimary, scheme), back) >= 4.5,
                        "\(scheme) \(container) label on \(back)")
                    #expect(
                        contrastRatio(Palette.hex(.textSecondary, scheme), back) >= 4.5,
                        "\(scheme) \(container) badge on \(back)")
                }
            }
        }

        /// One segmented look everywhere: no segmented control draws the accent fill.
        @Test func noSegmentedControlDrawsTheAccentLook() throws {
            let segmented = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Mac/MacSegmented.swift")))
            let picker = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Mac/MacSegmentedPicker.swift")))
            for (name, text) in [("MacSegmented", segmented), ("MacSegmentedPicker", picker)] {
                #expect(!text.contains("accentFill"), "\(name)")
                #expect(!text.contains("MacSegmentLook"), "\(name)")
            }
        }

        /// A shared control draws its Mac look on the Mac, never the system control it draws on
        /// iPhone and iPad.
        @Test(arguments: [
            (
                file: "Phone/Controls/SegmentedControl.swift", macLook: "MacSegmented(",
                system: ".pickerStyle(.segmented)"
            ),
            (file: "Phone/Controls/FilledTextFieldStyle.swift", macLook: "MacFieldStyle(", system: "Palette.field"),
        ])
        func sharedControlDrawsItsMacLook(_ control: (file: String, macLook: String, system: String)) throws {
            let mac = SourceScan.macCompiled(
                SourceScan.withoutPreviews(
                    SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: control.file)))))
            #expect(mac.contains(control.macLook), "\(control.file)")
            #expect(!mac.contains(control.system), "\(control.file)")
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

        /// A slider of whole steps lands a drag on the grid from its start, and settles on the
        /// default from as far as its reach.
        @Test func macSliderOnAStepGridSnapsToStepsAndTheDefault() {
            let speed = 50.0...125.0
            #expect(MacSlider.snapped(93, in: speed, detent: 100, step: 5, reach: 0.04) == 95)
            #expect(MacSlider.snapped(97, in: speed, detent: 100, step: 5, reach: 0.04) == 100)
            #expect(MacSlider.snapped(104, in: speed, detent: 100, step: 5, reach: 0.04) == 105)
            #expect(MacSlider.snapped(200, in: speed, detent: 100, step: 5, reach: 0.04) == 125)
        }

        /// The snap haptic fires on the change that reaches the default, never while the value
        /// stays on it or moves elsewhere.
        @Test func snapFiresOnceOnEntering() {
            #expect(MacSlider.entersDetent(from: 95, to: 100, detent: 100))
            #expect(!MacSlider.entersDetent(from: 100, to: 100, detent: 100))
            #expect(!MacSlider.entersDetent(from: 95, to: 96, detent: 100))
            #expect(!MacSlider.entersDetent(from: 95, to: 100, detent: nil))
        }

        /// A stepper half dims at its limit, and a disabled stepper dims once as a whole, never
        /// again in its halves.
        @Test(arguments: [
            (atLimit: false, isControlEnabled: true, dims: false),
            (atLimit: true, isControlEnabled: true, dims: true),
            (atLimit: false, isControlEnabled: false, dims: false),
            (atLimit: true, isControlEnabled: false, dims: false),
        ])
        func stepperHalfDimsOnlyAtItsLimit(atLimit: Bool, isControlEnabled: Bool, dims: Bool) {
            let opacity = MacStepper.glyphOpacity(atLimit: atLimit, isControlEnabled: isControlEnabled)
            #expect((opacity < 1) == dims)
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

        /// Every dock button draws with the library's button styles or the transport, and every
        /// glyph takes its size from a token.
        @Test func dockDrawsOnlyLibraryButtons() throws {
            let scanned = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Mac/PlayerDock.swift")))
            #expect(!scanned.contains(".buttonStyle(.plain)"))
            #expect(!scanned.contains(try Regex(#"\.system\(size:\s*\d"#)))
        }

        /// The controls sample screen is where a Mac-only control's states are looked at, so one
        /// missing from it goes unseen. A style counts by the shorthand that applies it.
        @Test(arguments: [
            "MacPopUp", "MacPullDown", "macInlinePopUp", "macField", "macTitleField", "MacTextArea", "macCheckbox",
            "macSwitch", "MacSlider", "MacStepper", "macRow", "MacActionBar", "MacToolButton",
        ])
        func galleryShowsEveryMacControl(name: String) throws {
            let code = SourceScan.macCompiled(try ControlGalleryTests.galleryCode())
            #expect(code.contains(try Regex("\\b\(name)\\b")), "ControlGallery never shows \(name) on the Mac")
        }

        @Test func practiceMetricsAreTheSpecs() {
            #expect(MacStyle.stageRadius == 12)
            #expect(MacStyle.transportDiameter == 44)
        }
    }
#endif
