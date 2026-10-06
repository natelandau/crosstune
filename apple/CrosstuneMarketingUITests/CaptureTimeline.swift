import XCTest

/// One capture's scene markers and taps, attached as `<name>.timeline.json` so the site pipeline
/// can trim the screen recording and draw a fingertip at each tap.
@MainActor
final class CaptureTimeline {
    private struct Tap: Encodable {
        let t: Double
        let x: Double
        let y: Double
    }

    private struct Record: Encodable {
        let name: String
        let scale: Double
        let start: Double
        let end: Double
        let taps: [Tap]
    }

    /// The gap after each tap, so each step reads on video before the next one starts.
    static let pause: TimeInterval = 0.6

    let name: String
    private var startedAt: Double?
    private var endedAt: Double?
    private var taps: [Tap] = []

    init(name: String) {
        self.name = name
    }

    func start() {
        startedAt = Self.now
    }

    func end() {
        endedAt = Self.now
    }

    /// Logs the element's center in points, then taps it.
    func tap(_ element: XCUIElement) {
        log(element.frame.midX, element.frame.midY)
        element.tap()
        Thread.sleep(forTimeInterval: Self.pause)
    }

    /// Logs where a press-and-drag starts, then drags between two points in the element's frame.
    func drag(_ element: XCUIElement, from: CGVector, to: CGVector, hold: TimeInterval = 0.05) {
        let frame = element.frame
        log(frame.minX + frame.width * from.dx, frame.minY + frame.height * from.dy)
        element.pressAndDrag(from: from, to: to, hold: hold)
        Thread.sleep(forTimeInterval: Self.pause)
    }

    func attach(to testCase: XCTestCase) {
        let now = Self.now
        let record = Record(
            name: name, scale: Self.scale, start: startedAt ?? now,
            end: endedAt ?? now, taps: taps)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        // The record holds only numbers and a name, which always encode.
        let data = try! encoder.encode(record)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "\(name).timeline.json"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }

    private func log(_ x: CGFloat, _ y: CGFloat) {
        taps.append(Tap(t: Self.now, x: Double(x), y: Double(y)))
    }

    private static var now: Double { Date().timeIntervalSince1970 }

    /// Pixels per point. XCUIScreen reports it only through a screenshot, so one is taken the
    /// first time a timeline is attached and reused for every later capture in the run.
    private static let scale = Double(XCUIScreen.main.screenshot().image.scale)
}

extension XCUIElement {
    /// Presses at one point in the element's frame and drags slowly to another, as a finger
    /// scrolling a list does.
    func pressAndDrag(from: CGVector, to: CGVector, hold: TimeInterval = 0.05) {
        coordinate(withNormalizedOffset: from).press(
            forDuration: hold, thenDragTo: coordinate(withNormalizedOffset: to), withVelocity: .slow,
            thenHoldForDuration: 0.2)
    }
}

/// What every capture test shares: the marketing catalog in dark mode, and stills.
@MainActor
class CaptureTestCase: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// The test plan's arguments and environment reach only the runner, so the app gets its
    /// fixture, record-from-file audio, and appearance here.
    func launchMarketing() -> XCUIApplication {
        guard let fixture = ProcessInfo.processInfo.environment["CAPTURE_FIXTURE"] else {
            XCTFail("CAPTURE_FIXTURE is not set; run with the Marketing test plan")
            return XCUIApplication()
        }
        let catalog = URL(fileURLWithPath: fixture).standardizedFileURL
        let take = catalog.deletingLastPathComponent().appending(path: "assets/jam-take.m4a")
        let app = XCUIApplication()
        app.launchArguments = [
            "-MarketingShell", catalog.path, "-RecordFromFile", take.path, "-crosstune.appearance", "dark",
        ]
        app.launch()
        // The catalog title shows before its rows load on a cold launch.
        XCTAssertTrue(app.staticTexts["Backstep Cindy"].firstMatch.waitForExistence(timeout: 60), "catalog rows")
        return app
    }

    /// A catalog or list row, whose label starts with the tune's title and goes on to its details.
    func row(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        button(app, startingWith: "\(title),")
    }

    /// A button whose label starts with `prefix`, for labels that go on to a duration or date.
    func button(_ app: XCUIApplication, startingWith prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    /// Fails the capture unless `element` appears, and hands it back.
    @discardableResult
    func shown(_ element: XCUIElement, timeout: TimeInterval = 10) -> XCUIElement {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(element) never appeared")
        return element
    }

    /// The capture's name: the test method without `test_`, underscores as hyphens.
    var captureName: String {
        let method = name.split(separator: " ").last.map { String($0.dropLast()) } ?? name
        return method.replacing("test_", with: "", maxReplacements: 1).replacing("_", with: "-")
    }

    /// Attaches the settled screen as `<name>.png`, with a timeline around it.
    func captureStill() {
        let timeline = CaptureTimeline(name: captureName)
        timeline.start()
        Thread.sleep(forTimeInterval: 1)
        // A screenshot's pixels stay in portrait order, with the rotation only in its metadata;
        // redrawing bakes a landscape screen upright.
        let image = XCUIScreen.main.screenshot().image
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        let upright = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in image.draw(at: .zero) }
        let shot = XCTAttachment(image: upright)
        shot.name = "\(captureName).png"
        shot.lifetime = .keepAlways
        add(shot)
        timeline.end()
        timeline.attach(to: self)
    }
}
