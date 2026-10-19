import CrosstuneAnalytics
import Foundation
import Sentry

/// Sends crashes, app hangs, and reported errors to Sentry without identifying the musician.
/// Sentry keeps its own per-install ID, which is the only identity an event carries.
struct SentrySink: DiagnosticsSink {
    /// Starts the SDK. Every integration that makes spans, captures requests, screenshots, or
    /// interaction trails is off: crash and hang reports are all this collects.
    @MainActor static func start(dsn: String) -> SentrySink {
        SentrySDK.start { configure($0, dsn: dsn) }
        return SentrySink()
    }

    /// Sets `options` to report only crashes, hangs, and handed errors, apart from `start` so a
    /// test can read what is turned off.
    static func configure(_ options: Options, dsn: String) {
        options.dsn = dsn
        options.environment = "production"
        options.sendDefaultPii = false
        // A session carries the install ID, start time, and duration, which is usage data.
        options.enableAutoSessionTracking = false
        options.enableAutoBreadcrumbTracking = false
        options.enableNetworkBreadcrumbs = false
        options.enableCaptureFailedRequests = false
        options.enableAutoPerformanceTracing = false
        options.enableNetworkTracking = false
        options.enableFileIOTracing = false
        options.enableCoreDataTracing = false
        options.enableAppHangTracking = true
        options.appHangTimeoutInterval = 2
        #if os(iOS)
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            options.enableUserInteractionTracing = false
        #endif
        #if os(macOS)
            options.enableUncaughtNSExceptionReporting = true
        #endif
        options.beforeSend = { scrub($0) }
        options.beforeBreadcrumb = { scrub($0) }
    }

    func report(_ error: any Error, area: DiagnosticArea) {
        SentrySDK.capture(error: error) { scope in
            scope.setTag(value: area.rawValue, key: "area")
            scope.setContext(value: ["description": redacted(String(describing: error))], key: "error")
        }
    }

    func breadcrumb(screen: Screen) {
        let crumb = Breadcrumb(level: .info, category: "navigation")
        crumb.message = screen.rawValue
        SentrySDK.addBreadcrumb(crumb)
    }
}

/// `event` with every URL query and fragment and home folder name cut, and every user field but
/// the install ID dropped.
func scrub(_ event: Event) -> Event {
    if let message = event.message {
        let clean = SentryMessage(formatted: redacted(message.formatted))
        clean.message = message.message.map(redacted)
        clean.params = message.params?.map(redacted)
        event.message = clean
    }
    for exception in event.exceptions ?? [] {
        exception.value = exception.value.map(redacted)
        exception.stacktrace.map(scrub)
        if let mechanism = exception.mechanism {
            mechanism.desc = mechanism.desc.map(redacted)
            mechanism.data = mechanism.data.map(redactingStrings)
        }
    }
    // A binary's path names the home folder when the app runs from inside it, such as from
    // Downloads. Only the path changes; the IDs and addresses symbolication reads stay.
    for thread in event.threads ?? [] { thread.stacktrace.map(scrub) }
    event.stacktrace.map(scrub)
    for image in event.debugMeta ?? [] { image.codeFile = image.codeFile.map(redacted) }
    if let request = event.request {
        request.url = request.url.map(redacted)
        request.queryString = nil
        request.fragment = nil
    }
    // `capture(error:)` copies the error's userInfo, which holds the failing URL, into the context.
    event.context = event.context?.mapValues { redactingStrings($0) }
    event.extra = event.extra.map(redactingStrings)
    event.breadcrumbs = event.breadcrumbs?.map(scrub)
    event.user = event.user?.userId.map { User(userId: $0) }
    return event
}

/// Cuts the home folder name from the path of each frame's binary and source file.
private func scrub(_ stacktrace: SentryStacktrace) {
    for frame in stacktrace.frames {
        frame.package = frame.package.map(redacted)
        frame.fileName = frame.fileName.map(redacted)
    }
}

/// `crumb` with every URL query and fragment and home folder name cut from its message and string data.
func scrub(_ crumb: Breadcrumb) -> Breadcrumb {
    crumb.message = crumb.message.map(redacted)
    for (key, value) in crumb.data ?? [:] {
        crumb.setData(value: redactingStrings(value), key: key)
    }
    return crumb
}

/// `value` with the query or fragment cut from every URL, and the home folder name from every
/// path, in each string inside it, however deep
/// in dictionaries and arrays, and in dictionary keys. Anything that is not a plain property-list
/// value, such as an underlying `NSError` or a URL session task, is described as a string and
/// redacted, since its description holds the URL or path.
private func redactingStrings(_ value: Any) -> Any {
    switch value {
    case let string as String: redacted(string)
    case let url as URL: redacted(url.absoluteString)
    case let dictionary as [String: Any]: redactingStrings(dictionary)
    case let array as [Any]: array.map(redactingStrings)
    case is NSNumber, is NSNull, is Date: value
    default: redacted(String(describing: value))
    }
}

private func redactingStrings(_ dictionary: [String: Any]) -> [String: Any] {
    Dictionary(
        dictionary.map { (redacted($0.key), redactingStrings($0.value)) },
        uniquingKeysWith: { first, _ in first })
}

/// `text` with every URL query and fragment cut, and the folder name in every `/Users/<name>` path,
/// which on a Mac is the person's account name.
private func redacted(_ text: String) -> String {
    redactingURLQueries(text).replacing(#/\/Users\/[^\/\s"'<>]+(?=[\/\s"'<>]|$)/#) { _ in "/Users/…" }
}
