import Foundation
import Sentry
import Testing

@testable import CrosstuneDiagnostics

private let presigned = "https://r2.example/a/b.m4a?X-Amz-Signature=abc&X-Amz-Date=1"

@Test func scrubsURLQueriesInMessagesAndExceptionValues() throws {
    let event = Event()
    event.message = SentryMessage(formatted: "PUT \(presigned) failed")
    let exception = Exception(value: "Could not reach \(presigned)", type: "URLError")
    event.exceptions = [exception]
    let request = SentryRequest()
    request.url = presigned
    request.queryString = "X-Amz-Signature=abc"
    event.request = request
    let crumb = Breadcrumb(level: .info, category: "http")
    crumb.message = "GET \(presigned)"
    crumb.setData(value: presigned, key: "url")
    crumb.setData(value: 200, key: "status")
    event.breadcrumbs = [crumb]

    let scrubbed = scrub(event)

    #expect(scrubbed.message?.formatted == "PUT https://r2.example/a/b.m4a?… failed")
    #expect(scrubbed.exceptions?.first?.value == "Could not reach https://r2.example/a/b.m4a?…")
    #expect(scrubbed.request?.url == "https://r2.example/a/b.m4a?…")
    #expect(scrubbed.request?.queryString == nil)
    let scrubbedCrumb = try #require(scrubbed.breadcrumbs?.first)
    #expect(scrubbedCrumb.message == "GET https://r2.example/a/b.m4a?…")
    #expect(scrubbedCrumb.data?["url"] as? String == "https://r2.example/a/b.m4a?…")
    #expect(scrubbedCrumb.data?["status"] as? Int == 200)
    #expect(scrubbed.exceptions?.first?.value?.contains("X-Amz-Signature") == false)
}

@Test func scrubsASingleBreadcrumb() {
    let crumb = Breadcrumb(level: .info, category: "navigation")
    crumb.message = presigned
    #expect(!(scrub(crumb).message ?? "").contains("X-Amz-Signature"))
}

@Test func keepsOnlyTheInstallID() {
    let event = Event()
    let user = User(userId: "install-1")
    user.email = "a@example.com"
    user.username = "someone"
    user.ipAddress = "203.0.113.9"
    event.user = user

    let scrubbed = scrub(event)

    #expect(scrubbed.user?.userId == "install-1")
    #expect(scrubbed.user?.email == nil)
    #expect(scrubbed.user?.username == nil)
    #expect(scrubbed.user?.ipAddress == nil)
}

@Test func dropsAUserWithoutAnID() {
    let event = Event()
    let user = User()
    user.email = "a@example.com"
    event.user = user
    #expect(scrub(event).user == nil)
}

@Test func keepsMessagesOtherwise() {
    let event = Event()
    event.exceptions = [Exception(value: "Index out of range", type: "Fatal error")]
    #expect(scrub(event).exceptions?.first?.value == "Index out of range")
}

@Test func scrubsTheURLInAnErrorEventTheWayTheSDKBuildsIt() throws {
    let url = try #require(URL(string: presigned))
    let error = URLError(
        .badServerResponse,
        userInfo: [
            NSURLErrorFailingURLErrorKey: url, NSURLErrorFailingURLStringErrorKey: presigned,
            "nested": ["list": [presigned]],
        ])
    let nsError = error as NSError
    let event = Event(level: .error)
    event.context = ["user info": nsError.userInfo]
    let exception = Exception(value: nsError.localizedDescription, type: "NSURLErrorDomain")
    let mechanism = Mechanism(type: "NSError")
    mechanism.desc = nsError.description
    mechanism.data = nsError.userInfo
    exception.mechanism = mechanism
    event.exceptions = [exception]

    let json = try JSONSerialization.data(withJSONObject: scrub(event).serialize())

    #expect(!String(decoding: json, as: UTF8.self).contains("X-Amz-Signature"))
}

@Test func scrubsAnUnderlyingErrorAndExtraInTheContext() throws {
    let underlying = NSError(
        domain: "NSPOSIXErrorDomain", code: 54, userInfo: [NSURLErrorFailingURLStringErrorKey: presigned])
    let event = Event(level: .error)
    event.context = ["user info": [NSUnderlyingErrorKey: underlying]]
    event.extra = ["detail": ["failed \(presigned)": presigned]]

    let json = try JSONSerialization.data(withJSONObject: scrub(event).serialize())

    #expect(!String(decoding: json, as: UTF8.self).contains("X-Amz-Signature"))
}

@Test func scrubsTheMacUserNameFromAFilePath() throws {
    let path = "/Users/someone/Library/Containers/app.crosstune.Crosstune/Data/tune.m4a"
    let error = CocoaError(
        .fileReadNoSuchFile,
        userInfo: [NSFilePathErrorKey: path, NSURLErrorKey: URL(filePath: path)])
    let nsError = error as NSError
    let event = Event(level: .error)
    event.context = ["user info": nsError.userInfo]
    let exception = Exception(value: "Could not open \(path)", type: "NSCocoaErrorDomain")
    let mechanism = Mechanism(type: "NSError")
    mechanism.desc = nsError.description
    mechanism.data = nsError.userInfo
    exception.mechanism = mechanism
    event.exceptions = [exception]
    event.message = SentryMessage(formatted: "Failed at \(path)")

    let data = try JSONSerialization.data(withJSONObject: scrub(event).serialize(), options: .withoutEscapingSlashes)
    let json = String(decoding: data, as: UTF8.self)

    #expect(!json.contains("someone"))
    #expect(json.contains("/Users/…/Library/Containers"))
}

@Test func scrubsTheMacUserNameFromAHomeFolderPath() {
    let event = Event(level: .error)
    event.message = SentryMessage(formatted: "No access to /Users/someone")

    #expect(scrub(event).message?.formatted == "No access to /Users/…")
}

@Test func scrubsTheMacUserNameFromStackFramesAndImages() throws {
    let binary = "/Users/someone/Downloads/Crosstune.app/Contents/MacOS/Crosstune"
    func stacktrace() -> SentryStacktrace {
        let frame = Frame()
        frame.package = binary
        frame.fileName = "/Users/someone/src/Tune.swift"
        frame.instructionAddress = "0x0000000100001234"
        frame.imageAddress = "0x0000000100000000"
        return SentryStacktrace(frames: [frame], registers: [:])
    }
    let event = Event(level: .fatal)
    let exception = Exception(value: "EXC_BAD_ACCESS", type: "EXC_BAD_ACCESS")
    exception.stacktrace = stacktrace()
    event.exceptions = [exception]
    let thread = SentryThread(threadId: 0)
    thread.stacktrace = stacktrace()
    event.threads = [thread]
    event.stacktrace = stacktrace()
    let image = DebugMeta()
    image.codeFile = binary
    image.debugID = "8A2D3A6C-0D1B-3F3B-9C7E-3E4D5F6A7B8C"
    image.imageAddress = "0x0000000100000000"
    event.debugMeta = [image]

    let scrubbed = scrub(event)
    let data = try JSONSerialization.data(withJSONObject: scrubbed.serialize(), options: .withoutEscapingSlashes)
    let json = String(decoding: data, as: UTF8.self)

    #expect(!json.contains("someone"))
    #expect(scrubbed.debugMeta?.first?.codeFile == "/Users/…/Downloads/Crosstune.app/Contents/MacOS/Crosstune")
    #expect(scrubbed.debugMeta?.first?.debugID == "8A2D3A6C-0D1B-3F3B-9C7E-3E4D5F6A7B8C")
    #expect(scrubbed.debugMeta?.first?.imageAddress == "0x0000000100000000")
    let frame = try #require(scrubbed.threads?.first?.stacktrace?.frames.first)
    #expect(frame.instructionAddress == "0x0000000100001234")
    #expect(frame.imageAddress == "0x0000000100000000")
}
