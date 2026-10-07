import CrosstuneAnalytics
import CrosstuneExport
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// Stats and the stand report an opening alongside their screen view, and the export reports
/// once its zip is made.
@MainActor
@Suite struct OpenedEventTests {
    private let sink = RecordingAnalyticsSink()

    @Test func statsAndTheStandAreFeaturesOpenedAsWellAsScreens() {
        #expect(Screen.stats.openedEvent == .statsViewed)
        #expect(Screen.stand.openedEvent == .standOpened)
        for screen: Screen in [.catalog, .tune, .list, .lists, .recordings, .recording, .settings] {
            #expect(screen.openedEvent == nil)
        }
    }

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

    @Test func reportsNoExportThatFailed() async throws {
        struct DiskFull: Error {}
        let model = ExportDataModel(exporter: exporter { throw DiskFull() }, analytics: sink.client)
        await model.followCounts()

        await model.start()?.value

        #expect(sink.calls.isEmpty)
    }
}
