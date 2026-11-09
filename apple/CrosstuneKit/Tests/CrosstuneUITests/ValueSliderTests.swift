import Testing

@testable import CrosstuneDesign

struct ValueSliderTests {
    @Test func snapsNearTheDefault() {
        #expect(DefaultSnap.snapped(97.5, toward: 100, in: 50...125) == 100)
        #expect(DefaultSnap.snapped(95, toward: 100, in: 50...125) == 95)
    }

    @Test func snapsAtTheEdgeOfTheZone() {
        // 4% of a 75 span is 3.
        #expect(DefaultSnap.snapped(103, toward: 100, in: 50...125) == 100)
        #expect(DefaultSnap.snapped(103.5, toward: 100, in: 50...125) == 104)
    }

    @Test func clampsToTheRange() {
        #expect(DefaultSnap.snapped(200, toward: 100, in: 50...125) == 125)
        #expect(DefaultSnap.snapped(0, toward: 100, in: 50...125) == 50)
    }

    @Test func stepperAndSliderShareOneValue() {
        let stepped = StepperModel.stepped(80, by: 5, in: 50...125)
        #expect(DefaultSnap.snapped(Double(stepped), toward: 100, in: 50...125) == stepped)
    }

    @Test func entryFiresOnEachReentry() {
        let path = [90, 100, 100, 90, 100]
        let fired = zip(path, path.dropFirst()).filter {
            DefaultSnap.entered(from: $0, to: $1, defaultValue: 100)
        }
        #expect(fired.count == 2)
    }

    @Test func staysOnTheDefaultWithoutFiring() {
        #expect(!DefaultSnap.entered(from: 100, to: 100, defaultValue: 100))
        #expect(!DefaultSnap.entered(from: 100, to: 95, defaultValue: 100))
    }
}

struct SliderThumbTests {
    /// The system thumb's center, measured on an iPhone simulator: 142.3 pt into a 408 pt slider
    /// at a third of the range.
    @Test func centersOnTheSystemThumb() {
        let x = SliderThumb.centerX(of: 75, in: 50...125, width: 408)
        #expect(abs(x - 142.3) < 0.5)
    }

    @Test func endsHalfAThumbFromEachEdge() {
        let low = SliderThumb.centerX(of: 50, in: 50...125, width: 408)
        let high = SliderThumb.centerX(of: 125, in: 50...125, width: 408)
        #expect(abs(low - SliderThumb.width / 2) < 0.01)
        #expect(abs(high - (408 - SliderThumb.width / 2)) < 0.01)
    }
}

struct ValueSliderLayoutTests {
    /// At the accessibility sizes the title takes a line of its own, so it never breaks mid-word
    /// beside Reset and the stepper.
    @Test func stacksTheLabelLineAtAccessibilitySizes() throws {
        func source(_ file: String) throws -> String {
            SourceScan.iOSCompiled(
                SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: "Phone/Controls/\(file)"))))
        }
        #expect(try source("ValueLabelLine.swift").contains("dynamicTypeSize.isAccessibilitySize"))
        #expect(try source("ValueSlider.swift").contains("ValueLabelLine(title)"))
    }
}
