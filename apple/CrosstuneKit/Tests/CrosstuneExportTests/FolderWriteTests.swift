import Foundation
import Testing

@testable import CrosstuneExport

private func temporaryFolder(_ label: String) throws -> URL {
    let folder = FileManager.default.temporaryDirectory
        .appending(path: "crosstune-folder-write-\(label)-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
}

private func write(_ text: String, to folder: URL, as name: String) throws -> URL {
    let url = folder.appending(path: name)
    try Data(text.utf8).write(to: url)
    return url
}

private func text(_ url: URL) throws -> String {
    String(decoding: try Data(contentsOf: url), as: UTF8.self)
}

private func contents(_ folder: URL) -> Set<String> {
    Set((try? FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false))) ?? [])
}

private let longStem = String(repeating: "a", count: 100)

@Suite struct FolderWriteTests {
    /// A name the folder already holds, in any case, gets the next free number, and the file
    /// already there is left as it was.
    @Test(
        arguments: [
            (["X 2026-09-14.m4a"], ["X 2026-09-14.m4a"], ["X 2026-09-14 (2).m4a"]),
            (["x 2026-09-14.M4A"], ["X 2026-09-14.m4a"], ["X 2026-09-14 (2).m4a"]),
            (["Reel.m4a", "reel (2).m4a"], ["Reel.m4a"], ["Reel (3).m4a"]),
            (["Reel.m4a"], ["Reel.webm", "Jig.m4a"], ["Reel.webm", "Jig.m4a"]),
            (["Reel.m4a"], ["Reel.m4a", "Reel (2).m4a"], ["Reel (2).m4a", "Reel (2) (2).m4a"]),
            ([], ["\(longStem) (2).m4a"], ["\(longStem) (2).m4a"]),
        ] as [([String], [String], [String])])
    func aNameTheFolderHoldsGetsTheNextNumber(existing: [String], incoming: [String], expected: [String]) throws {
        let job = try temporaryFolder("job")
        let folder = try temporaryFolder("chosen")
        defer {
            try? FileManager.default.removeItem(at: job)
            try? FileManager.default.removeItem(at: folder)
        }
        let old = try existing.map { try write("old \($0)", to: folder, as: $0) }
        let files = try incoming.map { try write("new \($0)", to: job, as: $0) }

        let written = try RecordingExport.writeIntoFolder(files, folder: folder)

        #expect(written.map { $0.lastPathComponent } == expected)
        let parents = Set(written.map { $0.deletingLastPathComponent().standardizedFileURL })
        #expect(parents == [folder.standardizedFileURL])
        for (file, destination) in zip(incoming, written) {
            #expect(try text(destination) == "new \(file)")
        }
        for (name, url) in zip(existing, old) {
            #expect(try text(url) == "old \(name)")
        }
        #expect(contents(folder) == Set(existing + expected))
    }

    @Test func aFailedWriteRemovesTheFilesItWroteAndLeavesTheRest() throws {
        let job = try temporaryFolder("job")
        let folder = try temporaryFolder("chosen")
        defer {
            try? FileManager.default.removeItem(at: job)
            try? FileManager.default.removeItem(at: folder)
        }
        _ = try write("old", to: folder, as: "Reel.m4a")
        let present = try write("new", to: job, as: "Jig.m4a")
        let missing = job.appending(path: "Hornpipe.m4a")

        #expect(throws: (any Error).self) {
            try RecordingExport.writeIntoFolder([present, missing], folder: folder)
        }
        #expect(contents(folder) == ["Reel.m4a"])
    }
}
