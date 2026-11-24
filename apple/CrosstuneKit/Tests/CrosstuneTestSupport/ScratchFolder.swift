import Foundation

/// Temporary: where test stores go. `CROSSTUNE_TEST_SCRATCH` moves them, so a CI run can put
/// them on a RAM disk and show whether disk speed stalls the main actor.
public let testScratchFolder: URL =
    ProcessInfo.processInfo.environment["CROSSTUNE_TEST_SCRATCH"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    ?? FileManager.default.temporaryDirectory
