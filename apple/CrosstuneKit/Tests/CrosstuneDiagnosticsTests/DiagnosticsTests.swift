import CrosstuneAnalytics
@_spi(Testing) import CrosstuneTestSupport
import Foundation
import Sentry
import Testing

@testable @_spi(Testing) import CrosstuneDiagnostics

@MainActor
@Test func blankDSNIsNoop() {
    #expect(Diagnostics.start(dsn: nil).isNoop)
    #expect(Diagnostics.start(dsn: "").isNoop)
    #expect(Diagnostics.start(dsn: "  \n").isNoop)
}

@Test func clientForwardsReportsAndScreens() {
    let sink = RecordingDiagnosticsSink()
    let client = sink.client

    client.report(URLError(.badServerResponse), area: .sync)
    client.screen(.tune)

    #expect(sink.reports.count == 1)
    #expect(sink.reports.first?.area == .sync)
    #expect((sink.reports.first?.error as? URLError)?.code == .badServerResponse)
    #expect(sink.screens == [.tune])
}

@Test func redactsQueriesAndFragments() {
    #expect(
        redactingURLQueries("PUT https://r2.example/a/b.m4a?X-Amz-Signature=abc failed")
            == "PUT https://r2.example/a/b.m4a?… failed")
    #expect(redactingURLQueries("https://x.example/p#frag") == "https://x.example/p#…")
    #expect(redactingURLQueries("https://x.example/p?a=1#frag") == "https://x.example/p?…")
    #expect(redactingURLQueries("Index out of range") == "Index out of range")
}

/// A session carries the install ID, start time, and duration: usage data, not a crash report.
@Test func sessionsAreOff() {
    let options = Options()
    SentrySink.configure(options, dsn: "https://key@o0.ingest.sentry.io/0")
    #expect(!options.enableAutoSessionTracking)
    #expect(!options.sendDefaultPii)
}
