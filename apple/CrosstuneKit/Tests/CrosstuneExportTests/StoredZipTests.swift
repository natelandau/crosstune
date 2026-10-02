import Foundation
import Testing

@testable import CrosstuneExport

/// A folder for one test's files, removed when the test ends.
final class ScratchFolder {
    let url = FileManager.default.temporaryDirectory
        .appending(path: "crosstune-zip-tests-\(UUID().uuidString)", directoryHint: .isDirectory)

    init() throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit {
        try? FileManager.default.removeItem(at: url)
    }

    func file(_ name: String, _ contents: Data) throws -> URL {
        let file = url.appending(path: name)
        try contents.write(to: file)
        return file
    }
}

extension Data {
    func littleEndian<Value: FixedWidthInteger>(_ at: Int, as type: Value.Type) -> Value {
        self[(startIndex + at)..<(startIndex + at + Value.bitWidth / 8)].reversed()
            .reduce(0) { $0 << 8 | Value($1) }
    }

    func u16(_ at: Int) -> UInt16 { littleEndian(at, as: UInt16.self) }
    func u32(_ at: Int) -> UInt32 { littleEndian(at, as: UInt32.self) }
    func u64(_ at: Int) -> UInt64 { littleEndian(at, as: UInt64.self) }

    func find(_ signature: UInt32) -> Int? {
        (0..<(count - 3)).first { u32($0) == signature }
    }
}

/// Every central directory entry's method, flags, and name, walked from the end record.
func centralEntries(_ zip: Data) -> [(method: UInt16, flags: UInt16, name: String)] {
    let end = zip.count - 22
    var at = Int(zip.u32(end + 16))
    return (0..<Int(zip.u16(end + 10))).map { _ in
        let nameLength = Int(zip.u16(at + 28))
        let entry = (
            method: zip.u16(at + 10), flags: zip.u16(at + 8),
            name: String(decoding: zip[(at + 46)..<(at + 46 + nameLength)], as: UTF8.self)
        )
        at += 46 + nameLength + Int(zip.u16(at + 30)) + Int(zip.u16(at + 32))
        return entry
    }
}

private let anyTime = Date(timeIntervalSince1970: 1_790_000_000)
private let utc = TimeZone(identifier: "UTC")!
private let unixMadeBy: UInt16 = 3 << 8 | 20
private let unixMadeByZip64: UInt16 = 3 << 8 | 45
private let regularFileAttributes: UInt32 = 0o100644 << 16

@Test func crc32OfTheCheckStringIsTheStandardValue() {
    #expect(crc32(Data("123456789".utf8)) == 0xCBF4_3926)
}

@Test func crc32ContinuesAcrossChunks() {
    #expect(crc32(Data("6789".utf8), previous: crc32(Data("12345".utf8))) == crc32(Data("123456789".utf8)))
}

@Test func entriesAreStoredWithUTF8Names() throws {
    let scratch = try ScratchFolder()
    let zipURL = scratch.url.appending(path: "out.zip")
    let audio = try scratch.file("audio.m4a", Data([1, 2, 3]))

    try writeStoredZip(
        [
            ZipEntry(path: "tunes.csv", source: .data(Data("a,b\r\n".utf8))),
            ZipEntry(path: "recordings/Ríl Mhór/2026-09-20.m4a", source: .file(audio)),
        ], to: zipURL, modified: anyTime, timeZone: utc)

    let entries = centralEntries(try Data(contentsOf: zipURL))
    #expect(entries.map(\.name) == ["tunes.csv", "recordings/Ríl Mhór/2026-09-20.m4a"])
    #expect(entries.allSatisfy { $0.method == 0 && $0.flags & 0x0800 != 0 })
}

@Test func marksEachCentralEntryAsMadeOnUnixWithRegularFilePermissions() throws {
    let scratch = try ScratchFolder()
    let zipURL = scratch.url.appending(path: "out.zip")
    try writeStoredZip(
        [ZipEntry(path: "a", source: .data(Data("x".utf8)))], to: zipURL, modified: anyTime, timeZone: utc)
    let bytes = try Data(contentsOf: zipURL)
    let central = try #require(bytes.find(0x0201_4b50))
    #expect(bytes.u16(central + 4) == unixMadeBy)
    #expect(bytes.u16(central + 6) == 10)
    #expect(bytes.u32(central + 38) == regularFileAttributes)
}

@Test func writesNoZip64RecordsUnderTheThreshold() throws {
    let scratch = try ScratchFolder()
    let zipURL = scratch.url.appending(path: "out.zip")
    try writeStoredZip(
        [ZipEntry(path: "a", source: .data(Data("x".utf8)))], to: zipURL, modified: anyTime, timeZone: utc)
    #expect(try Data(contentsOf: zipURL).find(0x0606_4b50) == nil)
}

@Test func laysOutZip64ExtrasAndEndRecordsWithSentinelsOnlyWhereFieldsOverflow() throws {
    // `a` is over the threshold by size and `b` by offset; the central directory starts past the
    // threshold but its size stays under it, and the entry count never overflows.
    let scratch = try ScratchFolder()
    let zipURL = scratch.url.appending(path: "out.zip")
    let big = try scratch.file("a", Data(repeating: UInt8(ascii: "x"), count: 200))
    try writeStoredZip(
        [ZipEntry(path: "a", source: .file(big)), ZipEntry(path: "b", source: .data(Data("y".utf8)))],
        to: zipURL, modified: anyTime, timeZone: utc, zip64Threshold: 160)
    let bytes = try Data(contentsOf: zipURL)

    #expect(bytes.u32(0) == 0x0403_4b50)
    #expect(bytes.u16(4) == 45)
    #expect(bytes.u32(18) == 0xFFFF_FFFF)
    #expect(bytes.u32(22) == 0xFFFF_FFFF)
    #expect(bytes.u16(28) == 20)
    let localExtra = 30 + 1
    #expect(bytes.u16(localExtra) == 0x0001)
    #expect(bytes.u16(localExtra + 2) == 16)
    #expect(bytes.u64(localExtra + 4) == 200)
    #expect(bytes.u64(localExtra + 12) == 200)

    let end = bytes.count - 22
    let locator = end - 20
    let central = try #require(bytes.find(0x0201_4b50))
    let zip64End = Int(bytes.u64(locator + 8))
    let centralSize = zip64End - central
    #expect(central == 51 + 200 + 51 + 1)
    #expect(centralSize < 160)
    #expect(bytes.u16(central + 4) == unixMadeByZip64)
    #expect(bytes.u16(central + 6) == 45)
    #expect(bytes.u32(central + 38) == regularFileAttributes)

    #expect(bytes.u32(zip64End) == 0x0606_4b50)
    #expect(bytes.u64(zip64End + 4) == 44)
    #expect(bytes.u16(zip64End + 12) == 45)
    #expect(bytes.u16(zip64End + 14) == 45)
    #expect(bytes.u32(zip64End + 16) == 0)
    #expect(bytes.u32(zip64End + 20) == 0)
    #expect(bytes.u64(zip64End + 24) == 2)
    #expect(bytes.u64(zip64End + 32) == 2)
    #expect(bytes.u64(zip64End + 40) == UInt64(centralSize))
    #expect(bytes.u64(zip64End + 48) == UInt64(central))

    #expect(bytes.u32(locator) == 0x0706_4b50)
    #expect(bytes.u32(locator + 4) == 0)
    #expect(bytes.u32(locator + 16) == 1)

    #expect(bytes.u32(end) == 0x0605_4b50)
    #expect(bytes.u16(end + 4) == 0)
    #expect(bytes.u16(end + 6) == 0)
    #expect(bytes.u16(end + 8) == 2)
    #expect(bytes.u16(end + 10) == 2)
    #expect(bytes.u32(end + 12) == UInt32(centralSize))
    #expect(bytes.u32(end + 16) == 0xFFFF_FFFF)
}

@Test func stampsTheLocalDOSTimeAndDate() throws {
    let scratch = try ScratchFolder()
    let zipURL = scratch.url.appending(path: "out.zip")
    let zone = TimeZone(identifier: "America/Los_Angeles")!
    // 13:45:31 on 2026-10-02 in Los Angeles.
    let modified = Date(timeIntervalSince1970: 1_790_973_931)
    try writeStoredZip(
        [ZipEntry(path: "a", source: .data(Data("x".utf8)))], to: zipURL, modified: modified, timeZone: zone)
    let bytes = try Data(contentsOf: zipURL)
    #expect(bytes.u16(10) == 13 << 11 | 45 << 5 | 15)
    #expect(bytes.u16(12) == (2026 - 1980) << 9 | 10 << 5 | 2)
}

@Test func clampsDOSDatesToTheRepresentableRange() {
    let late = dosDateTime(Date(timeIntervalSince1970: 7_258_118_400), timeZone: utc)  // 2200-01-01
    #expect(late.time == 23 << 11 | 59 << 5 | 29)
    #expect(late.date == 127 << 9 | 12 << 5 | 31)
    let early = dosDateTime(Date(timeIntervalSince1970: 0), timeZone: utc)
    #expect(early.time == 0)
    #expect(early.date == 1 << 5 | 1)
}

@Test func reportsEachEntryWritten() throws {
    let scratch = try ScratchFolder()
    var calls: [Int] = []
    try writeStoredZip(
        [ZipEntry(path: "a", source: .data(Data("x".utf8))), ZipEntry(path: "b", source: .data(Data("y".utf8)))],
        to: scratch.url.appending(path: "out.zip"), modified: anyTime, timeZone: utc
    ) { calls.append($0) }
    #expect(calls == [1, 2])
}

@Test func stopsBeforeTheNextEntryWhenCancelled() async throws {
    let scratch = try ScratchFolder()
    let second = try scratch.file("b", Data("y".utf8))
    let zipURL = scratch.url.appending(path: "out.zip")
    let task = Task {
        try writeStoredZip(
            [ZipEntry(path: "a", source: .data(Data("x".utf8))), ZipEntry(path: "b", source: .file(second))],
            to: zipURL, modified: anyTime, timeZone: utc
        ) { _ in withUnsafeCurrentTask { $0?.cancel() } }
    }
    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(try Data(contentsOf: zipURL).count == 30 + 1 + 1, "only the first entry was written")
}

#if os(macOS)
    @Test func unzipReadsTheArchiveBack() throws {
        let scratch = try ScratchFolder()
        let zipURL = scratch.url.appending(path: "out.zip")
        let audio = try scratch.file("audio.m4a", Data((0..<255).map(UInt8.init)))
        try writeStoredZip(
            [
                ZipEntry(path: "tunes.csv", source: .data(Data("a,b\r\n".utf8))),
                ZipEntry(path: "recordings/Ríl Mhór/2026-09-20.m4a", source: .file(audio)),
            ], to: zipURL, modified: anyTime, timeZone: utc)
        let path = zipURL.path(percentEncoded: false)

        #expect(try run("/usr/bin/unzip", ["-t", path]).contains(text: "No errors detected"))
        // Every entry in archive order: Process passes arguments decomposed (NFD), so a non-ASCII
        // pattern never matches the NFC name.
        #expect(try run("/usr/bin/unzip", ["-p", path]) == Data("a,b\r\n".utf8) + Data((0..<255).map(UInt8.init)))
        let python = "/usr/bin/python3"
        if FileManager.default.isExecutableFile(atPath: python) {
            let names = try run(
                python, ["-c", "import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).namelist())", path])
            #expect(String(decoding: names, as: UTF8.self) == "['tunes.csv', 'recordings/Ríl Mhór/2026-09-20.m4a']\n")
        }
    }

    @Test func unzipExtractsAnAccentedPathWithItsBytes() throws {
        let scratch = try ScratchFolder()
        let zipURL = scratch.url.appending(path: "out.zip")
        let bytes = Data([1, 2, 3, 250])
        let audio = try scratch.file("audio.m4a", bytes)
        try writeStoredZip(
            [ZipEntry(path: "recordings/Ríl Mhór/2026-09-20.m4a", source: .file(audio))], to: zipURL,
            modified: anyTime, timeZone: utc)
        let out = scratch.url.appending(path: "out", directoryHint: .isDirectory)

        _ = try run(
            "/usr/bin/unzip", ["-q", zipURL.path(percentEncoded: false), "-d", out.path(percentEncoded: false)])

        let extracted = out.appending(path: "recordings/Ríl Mhór/2026-09-20.m4a")
        #expect(try Data(contentsOf: extracted) == bytes)
    }

    func run(_ executable: String, _ arguments: [String]) throws -> Data {
        let process = Process()
        process.executableURL = URL(filePath: executable)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        try process.run()
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        #expect(process.terminationStatus == 0, "\(executable) \(arguments)")
        return output
    }

    extension Data {
        func contains(text: String) -> Bool { String(decoding: self, as: UTF8.self).contains(text) }
    }
#endif

@Test func aFileThatChangesLengthBetweenPassesIsRejected() throws {
    let scratch = try ScratchFolder()
    let audio = try scratch.file("a.m4a", Data([1, 2, 3]))
    #expect(throws: StoredZipError.fileChanged("a.m4a")) {
        try writeStoredZip(
            [ZipEntry(path: "a.m4a", source: .file(audio))], to: scratch.url.appending(path: "out.zip"),
            modified: anyTime, timeZone: utc, betweenPasses: { _ in try Data([1, 2, 3, 4]).write(to: audio) })
    }
}

@Test func aFileThatChangesContentBetweenPassesIsRejected() throws {
    let scratch = try ScratchFolder()
    let audio = try scratch.file("a.m4a", Data([1, 2, 3]))
    #expect(throws: StoredZipError.fileChanged("a.m4a")) {
        try writeStoredZip(
            [ZipEntry(path: "a.m4a", source: .file(audio))], to: scratch.url.appending(path: "out.zip"),
            modified: anyTime, timeZone: utc, betweenPasses: { _ in try Data([3, 2, 1]).write(to: audio) })
    }
}

#if canImport(Darwin)
    /// The memory this process holds now, as the system counts it against an app's limit.
    private func footprint() throws -> UInt64 {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        try #require(result == KERN_SUCCESS)
        return info.phys_footprint
    }

    @Test func memoryStaysFlatWhileZippingALargeFile() async throws {
        let scratch = try ScratchFolder()
        let size = 192 << 20
        let big = scratch.url.appending(path: "big.m4a")
        FileManager.default.createFile(atPath: big.path(percentEncoded: false), contents: nil)
        let handle = try FileHandle(forWritingTo: big)
        let chunk = Data(repeating: 7, count: 1 << 20)
        for _ in 0..<(size >> 20) { try handle.write(contentsOf: chunk) }
        try handle.close()

        // Detached, as the export runs, so no outer autorelease pool drains between chunks. The
        // samples follow each pass over the file, while anything it failed to free is still held.
        let growth = try await Task.detached {
            let baseline = try footprint()
            var highest = baseline
            try writeStoredZip(
                [ZipEntry(path: "big.m4a", source: .file(big))], to: scratch.url.appending(path: "out.zip"),
                modified: anyTime, timeZone: utc, onEntry: { _ in highest = max(highest, (try? footprint()) ?? 0) },
                betweenPasses: { _ in highest = max(highest, try footprint()) })
            return highest - baseline
        }.value

        #expect(growth < 64 << 20, "footprint grew by \(growth >> 20) MiB")
    }
#endif
