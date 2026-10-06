import XCTest

/// The catalog on each Apple device, for the "anywhere" stills.
final class FamilyCaptures: CaptureTestCase {
    func test_family_iphone() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "runs on an iPhone simulator")
        _ = launchMarketing()
        captureStill()
    }

    func test_family_ipad() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "runs on an iPad simulator")
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = launchMarketing()
        app.staticTexts["Backstep Cindy"].firstMatch.tap()
        shown(button(app, startingWith: "Play Saturday session"))
        captureStill()
    }
}
