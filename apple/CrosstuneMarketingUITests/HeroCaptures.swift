import XCTest

/// The hero's three clips: at the jam, at home, and recording.
final class HeroCaptures: CaptureTestCase {
    func test_hero_jam() throws {
        let app = launchMarketing()
        let timeline = CaptureTimeline(name: captureName)
        timeline.start()
        Thread.sleep(forTimeInterval: CaptureTimeline.pause)
        timeline.tap(app.buttons["Key: Any"])
        timeline.tap(shown(app.otherElements["Key"].buttons["D"]))
        timeline.tap(row(app, "Backstep Cindy"))
        timeline.tap(shown(button(app, startingWith: "Play Saturday session")))
        shown(app.buttons["Pause"])
        Thread.sleep(forTimeInterval: 1.5)
        timeline.end()
        timeline.attach(to: self)
    }

    func test_hero_home() throws {
        let app = launchMarketing()
        openPractice(app)
        let waveform = app.otherElements["Waveform"]
        let timeline = CaptureTimeline(name: captureName)
        timeline.start()
        timeline.tap(button(app, startingWith: "Speed"))
        timeline.tap(shown(app.buttons["75%"]))
        timeline.tap(app.buttons["Loops"])

        // A new loop spans four seconds each side of the playhead, held clear of the A part,
        // which ends at 8.5 s; past it, the loop starts where the B part does.
        let deadline = Date().addingTimeInterval(10)
        while seconds(waveform) < 9 && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
        timeline.tap(shown(app.buttons["New loop"]))
        let created = seconds(waveform)

        // The opening zoom fits the 30 s take to the waveform's width; the end goes 2.5 s later.
        let end = shown(app.otherElements["Loop end"])
        let later = 2.5 * waveform.frame.width / 30 / end.frame.width
        timeline.drag(end, from: CGVector(dx: 0.5, dy: 0.5), to: CGVector(dx: 0.5 + later, dy: 0.5))

        timeline.tap(shown(button(app, startingWith: "Loop 0:")))
        shown(app.textFields["Loop name"]).typeText("B part\n")
        shown(app.buttons["B part"])

        // The loop repeats: the playhead jumps back to its start, maybe while it was being named.
        var last = seconds(waveform)
        var wrapped = last < created
        let wrapDeadline = Date().addingTimeInterval(12)
        while !wrapped && Date() < wrapDeadline {
            Thread.sleep(forTimeInterval: 0.2)
            let now = seconds(waveform)
            wrapped = now < last
            last = now
        }
        XCTAssertTrue(wrapped, "the playhead never wrapped")
        Thread.sleep(forTimeInterval: 1.5)
        timeline.end()
        timeline.attach(to: self)
    }

    func test_hero_record() throws {
        let app = launchMarketing()
        let timeline = CaptureTimeline(name: captureName)
        timeline.start()
        Thread.sleep(forTimeInterval: CaptureTimeline.pause)
        timeline.tap(app.buttons["Start a new recording"].firstMatch)
        let stop = shown(app.buttons["Stop"])
        // With the idle wait XCUITest adds before tapping Stop, long enough for the live
        // waveform to fill the screen.
        Thread.sleep(forTimeInterval: 1)
        timeline.tap(stop)

        let take = shown(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Waiting to upload'")).firstMatch)
        timeline.drag(take, from: CGVector(dx: 0.85, dy: 0.5), to: CGVector(dx: 0.3, dy: 0.5), hold: 0.05)
        timeline.tap(shown(app.buttons["Add to tune"]))
        dismissKeyboardTip(app)
        app.typeText("Half")
        timeline.tap(shown(app.buttons["Add to Half Past Four"]))
        timeline.tap(shown(app.buttons["Open Half Past Four"]))
        shown(app.staticTexts["Half Past Four"])
        Thread.sleep(forTimeInterval: 1.5)
        timeline.end()
        timeline.attach(to: self)
    }

    /// The waveform's playhead, in whole seconds, from its `0:12 of 0:30` value.
    private func seconds(_ waveform: XCUIElement) -> Double {
        let value = (waveform.value as? String) ?? ""
        let parts = value.split(separator: " ").first?.split(separator: ":").compactMap { Double($0) } ?? []
        return parts.count == 2 ? parts[0] * 60 + parts[1] : 0
    }
}

extension CaptureTestCase {
    /// Bibb County Hoedown's band recording, playing, on the recording screen.
    func openPractice(_ app: XCUIApplication) {
        row(app, "Bibb County Hoedown").tap()
        shown(button(app, startingWith: "Play With the band")).tap()
        shown(button(app, startingWith: "Show player")).tap()
        shown(app.otherElements["Waveform"])
        Thread.sleep(forTimeInterval: 1)
    }

    /// A fresh simulator's first keyboard opens under a swipe-to-type tip.
    func dismissKeyboardTip(_ app: XCUIApplication) {
        let tip = app.buttons["Continue"]
        if tip.waitForExistence(timeout: 1) { tip.tap() }
    }
}
