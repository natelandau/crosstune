import XCTest

/// The App Store screenshots, in the order the site tells its story, and the App Preview.
final class StoreCaptures: CaptureTestCase {
    func test_store_catalog() throws {
        try phoneOnly()
        _ = launchMarketing()
        captureStill()
    }

    func test_store_tune() throws {
        try phoneOnly()
        let app = launchMarketing()
        app.collectionViews.firstMatch.swipeUp()
        shown(row(app, "Sail Away Ladies")).tap()
        shown(app.staticTexts["Joe at Clifftop"])
        showLearned(app)
        captureStill()
    }

    func test_store_practice() throws {
        try phoneOnly()
        let app = launchMarketing()
        openPractice(app)
        button(app, startingWith: "Speed").tap()
        shown(app.buttons["75%"]).tap()
        app.buttons["Loops"].tap()
        shown(app.buttons["Next loop"])
        captureStill()
    }

    func test_store_record() throws {
        try phoneOnly()
        let app = launchMarketing()
        app.buttons["Start a new recording"].firstMatch.tap()
        shown(app.buttons["Stop"])
        // Long enough for the live waveform to fill the screen.
        Thread.sleep(forTimeInterval: 4)
        captureStill()
    }

    func test_store_lists() throws {
        try phoneOnly()
        let app = launchMarketing()
        app.buttons["Lists"].firstMatch.tap()
        shown(row(app, "Saturday session")).tap()
        shown(app.buttons["Play"].firstMatch)
        captureStill()
    }

    func test_store_listen() throws {
        try phoneOnly()
        let app = launchMarketing()
        row(app, "Forked Deer").tap()
        shown(button(app, startingWith: "Play Forked Deer (field recording)"))
        captureStill()
    }

    func test_store_folk() throws {
        try phoneOnly()
        let app = launchMarketing()
        app.collectionViews.firstMatch.pressAndDrag(from: CGVector(dx: 0.5, dy: 0.7), to: CGVector(dx: 0.5, dy: 0.4))
        shown(row(app, "Lost Indian")).tap()
        showCrooked(app)
        captureStill()
    }

    func test_store_scans() throws {
        try phoneOnly()
        let app = launchMarketing()
        app.collectionViews.firstMatch.swipeUp()
        shown(row(app, "Sail Away Ladies")).tap()
        shown(app.staticTexts["Joe at Clifftop"])
        let scan = app.buttons["Open scan 1"]
        let tune = app.scrollViews.firstMatch
        for _ in 0..<6 where !(scan.exists && scan.isHittable) {
            tune.pressAndDrag(from: CGVector(dx: 0.5, dy: 0.7), to: CGVector(dx: 0.5, dy: 0.45))
        }
        scan.tap()
        shown(app.staticTexts["1 of 2"])
        captureStill()
    }

    /// The App Preview: the catalog filtered to D, then to the tunes the musician knows, then
    /// one of them played.
    func test_preview_filter() throws {
        try phoneOnly()
        let app = launchMarketing()
        let key = shown(app.buttons["Key: Any"])
        let timeline = CaptureTimeline(name: captureName)
        timeline.start()
        Thread.sleep(forTimeInterval: 1.5)
        timeline.tap(key)
        Thread.sleep(forTimeInterval: 0.6)
        timeline.tap(shown(app.otherElements["Key"].buttons["D"]))
        shown(app.staticTexts.matching(NSPredicate(format: "label ENDSWITH 'of 17 tunes'")).firstMatch)
        Thread.sleep(forTimeInterval: 2.5)
        timeline.tap(shown(app.buttons["Status: Any"]))
        Thread.sleep(forTimeInterval: 0.6)
        timeline.tap(shown(button(app, startingWith: "Known")))
        Thread.sleep(forTimeInterval: 2.5)
        timeline.tap(shown(row(app, "Backstep Cindy")))
        Thread.sleep(forTimeInterval: 0.8)
        timeline.tap(shown(button(app, startingWith: "Play Saturday session")))
        shown(app.buttons["Pause"])
        Thread.sleep(forTimeInterval: 3)
        timeline.end()
        timeline.attach(to: self)
    }

    func test_store_ipad_tune() throws {
        let app = try launchPad()
        app.staticTexts["Sail Away Ladies"].firstMatch.tap()
        shown(app.staticTexts["Joe at Clifftop"])
        showLearned(app)
        captureStill()
    }

    func test_store_ipad_catalog() throws {
        let app = try launchPad()
        app.buttons["Key: Any"].tap()
        shown(app.otherElements["Key"].buttons["D"]).tap()
        shown(app.staticTexts.matching(NSPredicate(format: "label ENDSWITH 'of 17 tunes'")).firstMatch)
        app.staticTexts["Backstep Cindy"].firstMatch.tap()
        shown(button(app, startingWith: "Play Saturday session"))
        captureStill()
    }

    func test_store_ipad_practice() throws {
        let app = try launchPad()
        // iPad rows are plain elements rather than buttons, so they are found by their titles.
        app.staticTexts["Bibb County Hoedown"].firstMatch.tap()
        shown(button(app, startingWith: "Play With the band")).tap()
        shown(button(app, startingWith: "Show player")).tap()
        shown(app.otherElements["Waveform"])
        app.buttons["Loops"].tap()
        shown(app.buttons["Next loop"])
        captureStill()
    }

    func test_store_ipad_lists() throws {
        let app = try launchPad()
        // The sidebar's destinations are cells.
        app.cells["Lists"].tap()
        shown(app.staticTexts["Saturday session"].firstMatch).tap()
        shown(app.buttons["Play"].firstMatch)
        app.staticTexts["Backstep Cindy"].firstMatch.tap()
        shown(button(app, startingWith: "Play Saturday session"))
        captureStill()
    }

    private func phoneOnly() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "runs on an iPhone simulator")
    }

    /// The iPad in landscape, where the catalog and the tune sit side by side.
    private func launchPad() throws -> XCUIApplication {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "runs on an iPad simulator")
        XCUIDevice.shared.orientation = .landscapeLeft
        return launchMarketing()
    }
}
