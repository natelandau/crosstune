import CrosstuneAnalytics
import CrosstuneExport
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// The export reports once its zip is made.
@MainActor
@Suite struct OpenedEventTests {
    private let sink = RecordingAnalyticsSink()

    private func zip() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: "opened-events-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let zip = folder.appending(path: "crosstune-export.zip")
        try Data("zip".utf8).write(to: zip)
        return zip
    }

    private func exporter(make: @escaping @Sendable () throws -> URL) -> Exporter {
        Exporter(
            counts: {
                AsyncThrowingStream {
                    $0.yield(ExportCounts(onDevice: 1, total: 1))
                    $0.finish()
                }
            },
            make: { _ in try make() })
    }

    @Test func reportsAnExportOnceItsZipIsMade() async throws {
        let made = try zip()
        let model = ExportDataModel(exporter: exporter { made }, analytics: sink.client)
        await model.followCounts()

        await model.start()?.value

        #expect(sink.captures == [.init(name: "export_completed", properties: ["format": .string("zip")])])
        model.finishHandOff()
    }

    @Test func reportsNoCompletionForAnExportThatFailed() async throws {
        struct DiskFull: Error {}
        let model = ExportDataModel(exporter: exporter { throw DiskFull() }, analytics: sink.client)
        await model.followCounts()

        await model.start()?.value

        #expect(sink.captures.map(\.name) == ["export_failed"])
    }
}
