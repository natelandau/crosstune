import XCTest

/// The feature sections' clips and stills.
final class FeatureCaptures: CaptureTestCase {
    func test_tunes_status() throws {
        let app = launchMarketing()
        let status = shown(app.buttons["Status: Any"])
        let timeline = sceneStart()
        timeline.tap(status)
        timeline.tap(shown(button(app, startingWith: "Learning")))
        shown(app.staticTexts["6 of 17 tunes"])
        sceneEnd(timeline)
    }

    func test_tunes_filter() throws {
        let app = launchMarketing()
        let key = shown(app.buttons["Key: Any"])
        let timeline = sceneStart()
        timeline.tap(key)
        timeline.tap(shown(app.otherElements["Key"].buttons["A"]))
        shown(app.staticTexts["4 of 17 tunes"])
        sceneEnd(timeline)
    }

    func test_tunes_search() throws {
        let app = launchMarketing()
        let search = shown(app.searchFields["Search tunes"])
        // The keyboard is up before the scene, so the clip opens on the field ready for typing.
        search.tap()
        shown(app.keyboards.firstMatch.keys["w"])
        Thread.sleep(forTimeInterval: 1)
        let timeline = sceneStart()
        // typeText sends hardware key events, which hide the on-screen keyboard mid-word. The
        // letters sit in the keyboard's left half, which the clip's zoom keeps in frame.
        let keyboard = app.keyboards.firstMatch
        for letter in ["w", "e", "s", "t"] { timeline.tap(keyboard.keys[letter]) }
        shown(app.staticTexts["1 of 17 tunes"])
        shown(row(app, "Westphalia Waltz"))
        sceneEnd(timeline)
    }

    func test_tune_links() throws {
        let app = launchMarketing()
        row(app, "Backstep Cindy").tap()
        let play = shown(button(app, startingWith: "Play Saturday session"))
        shown(button(app, startingWith: "Play Backstep Cindy - The Red Hots"))
        let timeline = sceneStart()
        timeline.tap(play)
        shown(app.buttons["Pause"])
        sceneEnd(timeline)
    }

    func test_tune_scans() throws {
        let app = launchMarketing()
        // Scrolled on to the lyrics row so the chips, which the clip's zoom would cut, are off screen.
        openSailAway(app, scrolledTo: app.buttons["Open lyrics"])
        let scan = app.buttons["Open scan 1"]
        XCTAssertTrue(scan.isHittable, "the first scan scrolled off screen")
        let timeline = sceneStart()
        timeline.tap(scan)
        shown(app.staticTexts["1 of 2"])
        sceneEnd(timeline)
    }

    func test_tune_lyrics() throws {
        let app = launchMarketing()
        let lyrics = openSailAway(app, scrolledTo: app.buttons["Open lyrics"])
        let timeline = sceneStart()
        timeline.tap(lyrics)
        shown(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Sail away, ladies'")).firstMatch)
        sceneEnd(timeline)
    }

    func test_tune_learned() throws {
        let app = launchMarketing()
        let learned = app.staticTexts["Learned from Joe at Clifftop on Aug 6, 2026"]
        // The page opens above the notes, and the scene scrolls down to them.
        openSailAway(app, scrolledTo: app.buttons["Open lyrics"])
        let timeline = sceneStart()
        timeline.drag(
            app.scrollViews.firstMatch, from: CGVector(dx: 0.5, dy: 0.7), to: CGVector(dx: 0.5, dy: 0.35))
        XCTAssertTrue(learned.isHittable, "the learned-from line scrolled off screen")
        sceneEnd(timeline)
    }

    func test_practice_speed() throws {
        let app = launchMarketing()
        openPractice(app)
        button(app, startingWith: "Speed").tap()
        let speed = shown(app.buttons["75%"])
        let timeline = sceneStart()
        timeline.tap(speed)
        sceneEnd(timeline)
    }

    func test_practice_pitch() throws {
        let app = launchMarketing()
        openPractice(app)
        button(app, startingWith: "Pitch").tap()
        let up = shown(app.buttons["Up a semitone"])
        let timeline = sceneStart()
        timeline.tap(up)
        timeline.tap(up)
        sceneEnd(timeline)
    }

    func test_practice_loops() throws {
        let app = launchMarketing()
        openPractice(app)
        app.buttons["Loops"].tap()
        let next = shown(app.buttons["Next loop"])
        let timeline = sceneStart()
        timeline.tap(next)
        timeline.tap(app.buttons["Previous loop"])
        sceneEnd(timeline)
    }

    func test_record() throws {
        let app = launchMarketing()
        app.buttons["Recordings"].firstMatch.tap()
        shown(button(app, startingWith: "Play Saturday session"))
        captureStill()
    }

    func test_lists() throws {
        let app = launchMarketing()
        app.buttons["Lists"].firstMatch.tap()
        shown(row(app, "Saturday session"))
        let timeline = CaptureTimeline(name: captureName)
        timeline.start()
        Thread.sleep(forTimeInterval: CaptureTimeline.pause)
        timeline.tap(row(app, "Saturday session"))
        timeline.tap(shown(app.buttons["Play"].firstMatch))
        let next = shown(app.buttons["Next tune"])
        Thread.sleep(forTimeInterval: 1)
        timeline.tap(next)
        let second = NSPredicate(format: "label BEGINSWITH 'Show player' AND label ENDSWITH '2 of 3'")
        shown(app.buttons.matching(second).firstMatch)
        Thread.sleep(forTimeInterval: 1.5)
        timeline.end()
        timeline.attach(to: self)
    }

    func test_services() throws {
        let app = launchMarketing()
        row(app, "Forked Deer").tap()
        shown(button(app, startingWith: "Play Forked Deer (field recording)")).press(forDuration: 1)
        shown(app.buttons["Add to recordings"])
        captureStill()
    }

    func test_folk() throws {
        let app = launchMarketing()
        app.collectionViews.firstMatch.pressAndDrag(from: CGVector(dx: 0.5, dy: 0.7), to: CGVector(dx: 0.5, dy: 0.4))
        shown(row(app, "Lost Indian")).tap()
        shown(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Crooked'")).firstMatch)
        captureStill()
    }

    /// Starts a bullet's scene on a settled screen, held a beat so the clip opens before the action.
    private func sceneStart() -> CaptureTimeline {
        let timeline = CaptureTimeline(name: captureName)
        timeline.start()
        Thread.sleep(forTimeInterval: CaptureTimeline.pause)
        return timeline
    }

    /// Holds the action's result on screen, then ends and attaches the scene.
    private func sceneEnd(_ timeline: CaptureTimeline) {
        Thread.sleep(forTimeInterval: 1.5)
        timeline.end()
        timeline.attach(to: self)
    }

    /// Opens Sail Away Ladies and scrolls until `target` is on screen, then lets the list settle.
    @discardableResult
    private func openSailAway(_ app: XCUIApplication, scrolledTo target: XCUIElement) -> XCUIElement {
        app.collectionViews.firstMatch.swipeUp()
        shown(row(app, "Sail Away Ladies")).tap()
        shown(app.staticTexts["Joe at Clifftop"])
        let tune = app.scrollViews.firstMatch
        for _ in 0..<6 where !(target.exists && target.isHittable) {
            tune.pressAndDrag(from: CGVector(dx: 0.5, dy: 0.7), to: CGVector(dx: 0.5, dy: 0.45))
        }
        XCTAssertTrue(target.isHittable, "\(target) never scrolled into view")
        Thread.sleep(forTimeInterval: 1)
        return target
    }
}
