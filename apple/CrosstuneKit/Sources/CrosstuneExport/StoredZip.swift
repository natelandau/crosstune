import Foundation
import zlib

/// A stored-entry (method 0) zip writer for exports that can run past a gigabyte of audio.
///
/// Each file is read twice, chunk by chunk: once for its CRC, which the local header needs
/// before the bytes, then to copy it into the zip, so no entry is ever held in memory whole.
/// Field layouts follow PKWARE's APPNOTE.TXT and match the web client's writer byte for byte;
/// every multi-byte field is little-endian.
struct ZipEntry: Sendable {
    enum Source: Sendable {
        case data(Data)
        case file(URL)
    }

    var path: String
    var source: Source
}

enum StoredZipError: LocalizedError, Equatable {
    /// A file's length or bytes changed between computing its CRC and copying it.
    case fileChanged(String)

    var errorDescription: String? {
        switch self {
        case .fileChanged(let path): "\(path) changed while it was being exported. Try exporting again."
        }
    }
}

private let localHeaderSignature: UInt32 = 0x0403_4b50
private let centralHeaderSignature: UInt32 = 0x0201_4b50
private let endOfCentralDirectorySignature: UInt32 = 0x0605_4b50
private let zip64EndOfCentralDirectorySignature: UInt32 = 0x0606_4b50
private let zip64LocatorSignature: UInt32 = 0x0706_4b50
private let zip64ExtraID: UInt16 = 0x0001

private let versionStored: UInt16 = 10
private let versionZip64: UInt16 = 45
// Info-ZIP decodes the names of entries made on MS-DOS (host 0) as an OEM code page, which mangles
// UTF-8 names whatever bit 11 says, so entries claim Unix (host 3) with regular file permissions.
private let madeByUnix: UInt16 = 3 << 8
private let versionMadeBy: UInt16 = madeByUnix | 20
private let versionMadeByZip64: UInt16 = madeByUnix | versionZip64
private let regularFileAttributes: UInt32 = 0o100644 << 16
private let flagUTF8Name: UInt16 = 0x0800
private let maxUInt16: UInt64 = 0xFFFF
private let maxUInt32: UInt64 = 0xFFFF_FFFF

private let chunkSize = 1 << 20

/// IEEE CRC-32. Pass the CRC of the bytes before `bytes` as `previous` to continue a stream.
func crc32(_ bytes: Data, previous: UInt32 = 0) -> UInt32 {
    bytes.withUnsafeBytes { buffer in
        var crc = uLong(previous)
        var start = 0
        // zlib takes a 32-bit length, so a larger buffer goes in pieces.
        while start < buffer.count {
            let length = min(buffer.count - start, Int(UInt32.max))
            let piece = buffer.baseAddress?.advanced(by: start).assumingMemoryBound(to: Bytef.self)
            crc = zlib.crc32(crc, piece, uInt(length))
            start += length
        }
        return UInt32(crc)
    }
}

/// The DOS time and date of `date` on a clock in `timeZone`. DOS dates span only 1980 through
/// 2107, so a date outside clamps to the nearest end.
func dosDateTime(_ date: Date, timeZone: TimeZone) -> (time: UInt16, date: UInt16) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    let year = parts.year ?? 1980
    if year < 1980 { return (0, 1 << 5 | 1) }
    if year > 2107 { return (23 << 11 | 59 << 5 | 29, 127 << 9 | 12 << 5 | 31) }
    let time = (parts.hour ?? 0) << 11 | (parts.minute ?? 0) << 5 | (parts.second ?? 0) / 2
    let day = (year - 1980) << 9 | (parts.month ?? 1) << 5 | (parts.day ?? 1)
    return (UInt16(time), UInt16(day))
}

private struct LittleEndian {
    var data = Data()

    mutating func u16(_ value: UInt16) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    mutating func u16(_ value: UInt64) { u16(UInt16(value)) }
    mutating func u32(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    mutating func u32(_ value: UInt64) { u32(UInt32(value)) }
    mutating func u64(_ value: UInt64) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    mutating func raw(_ value: Data) { data.append(value) }
}

private struct ZipRecord {
    let name: Data
    let crc: UInt32
    let size: UInt64
    let offset: UInt64
    let zip64: Bool
}

private func localHeader(_ record: ZipRecord, time: UInt16, date: UInt16) -> Data {
    var w = LittleEndian()
    w.u32(localHeaderSignature)
    w.u16(record.zip64 ? versionZip64 : versionStored)
    w.u16(flagUTF8Name)
    w.u16(UInt16(0))
    w.u16(time)
    w.u16(date)
    w.u32(record.crc)
    w.u32(record.zip64 ? maxUInt32 : record.size)
    w.u32(record.zip64 ? maxUInt32 : record.size)
    w.u16(UInt64(record.name.count))
    w.u16(UInt16(record.zip64 ? 4 + 16 : 0))
    w.raw(record.name)
    // The local Zip64 extra carries both sizes and never the offset.
    if record.zip64 {
        w.u16(zip64ExtraID)
        w.u16(UInt16(16))
        w.u64(record.size)
        w.u64(record.size)
    }
    return w.data
}

private func centralHeader(_ record: ZipRecord, time: UInt16, date: UInt16) -> Data {
    var w = LittleEndian()
    w.u32(centralHeaderSignature)
    w.u16(record.zip64 ? versionMadeByZip64 : versionMadeBy)
    w.u16(record.zip64 ? versionZip64 : versionStored)
    w.u16(flagUTF8Name)
    w.u16(UInt16(0))
    w.u16(time)
    w.u16(date)
    w.u32(record.crc)
    w.u32(record.zip64 ? maxUInt32 : record.size)
    w.u32(record.zip64 ? maxUInt32 : record.size)
    w.u16(UInt64(record.name.count))
    w.u16(UInt16(record.zip64 ? 4 + 24 : 0))
    w.u16(UInt16(0))
    w.u16(UInt16(0))
    w.u16(UInt16(0))
    w.u32(regularFileAttributes)
    w.u32(record.zip64 ? maxUInt32 : record.offset)
    w.raw(record.name)
    // A Zip64 record marks sizes and offset all as 0xFFFFFFFF, so its extra carries all three,
    // in the spec's order: uncompressed size, compressed size, local header offset.
    if record.zip64 {
        w.u16(zip64ExtraID)
        w.u16(UInt16(24))
        w.u64(record.size)
        w.u64(record.size)
        w.u64(record.offset)
    }
    return w.data
}

/// Calls `body` with each chunk of the file, checking for cancellation before each, and returns
/// how many bytes it read and their CRC.
private func forEachChunk(of url: URL, _ body: (Data) throws -> Void) throws -> (size: UInt64, crc: UInt32) {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var size: UInt64 = 0
    var crc: UInt32 = 0
    while true {
        try Task.checkCancellation()
        // Each chunk is autoreleased; without a pool per chunk, none is freed until the whole
        // file has been read, so memory would grow to the file's size.
        let more = try drainingAutoreleased {
            guard let chunk = try handle.read(upToCount: chunkSize), !chunk.isEmpty else { return false }
            try body(chunk)
            size += UInt64(chunk.count)
            crc = crc32(chunk, previous: crc)
            return true
        }
        if !more { return (size, crc) }
    }
}

private func drainingAutoreleased<Result>(_ body: () throws -> Result) rethrows -> Result {
    #if canImport(ObjectiveC)
        try autoreleasepool(invoking: body)
    #else
        try body()
    #endif
}

/// Writes a zip of stored entries to `destination`, replacing any file there. Directory entries
/// are not written; entry paths imply them. `onEntry` gets the entries written so far after
/// each one. Sizes and offsets at or over `zip64Threshold` use Zip64 fields; tests lower it.
/// `betweenPasses` runs after an entry's CRC pass and before its copy, for tests.
func writeStoredZip(
    _ entries: [ZipEntry], to destination: URL, modified: Date, timeZone: TimeZone,
    zip64Threshold: UInt64 = 0xFFFF_FFFF, onEntry: (Int) -> Void = { _ in },
    betweenPasses: (ZipEntry) throws -> Void = { _ in }
) throws {
    let threshold = min(zip64Threshold, maxUInt32)
    let (time, date) = dosDateTime(modified, timeZone: timeZone)

    guard FileManager.default.createFile(atPath: destination.path(percentEncoded: false), contents: nil) else {
        throw CocoaError(.fileWriteUnknown, userInfo: [NSURLErrorKey: destination])
    }
    let output = try FileHandle(forWritingTo: destination)
    defer { try? output.close() }

    var records: [ZipRecord] = []
    var offset: UInt64 = 0
    for entry in entries {
        try Task.checkCancellation()
        let crc: UInt32
        let size: UInt64
        switch entry.source {
        case .data(let data):
            crc = crc32(data)
            size = UInt64(data.count)
        case .file(let url):
            (size, crc) = try forEachChunk(of: url) { _ in }
        }
        try betweenPasses(entry)
        let record = ZipRecord(
            name: Data(entry.path.utf8), crc: crc, size: size, offset: offset,
            zip64: size >= threshold || offset >= threshold)
        let header = localHeader(record, time: time, date: date)
        try output.write(contentsOf: header)
        switch entry.source {
        case .data(let data):
            try output.write(contentsOf: data)
        case .file(let url):
            let copied = try forEachChunk(of: url) { try output.write(contentsOf: $0) }
            if copied != (size, crc) { throw StoredZipError.fileChanged(entry.path) }
        }
        records.append(record)
        offset += UInt64(header.count) + size
        onEntry(records.count)
    }

    let centralOffset = offset
    for record in records {
        let header = centralHeader(record, time: time, date: date)
        try output.write(contentsOf: header)
        offset += UInt64(header.count)
    }
    let centralSize = offset - centralOffset

    let count = UInt64(records.count)
    // 0xFFFF is the classic record's Zip64 sentinel, so exactly 65,535 entries also needs Zip64.
    let countOverflows = count >= maxUInt16
    let sizeOverflows = centralSize >= threshold
    let offsetOverflows = centralOffset >= threshold
    var end = LittleEndian()
    if records.contains(where: \.zip64) || countOverflows || sizeOverflows || offsetOverflows {
        let zip64End = offset
        end.u32(zip64EndOfCentralDirectorySignature)
        end.u64(UInt64(56 - 12))
        end.u16(versionZip64)
        end.u16(versionZip64)
        end.u32(UInt32(0))
        end.u32(UInt32(0))
        end.u64(count)
        end.u64(count)
        end.u64(centralSize)
        end.u64(centralOffset)
        end.u32(zip64LocatorSignature)
        end.u32(UInt32(0))
        end.u64(zip64End)
        end.u32(UInt32(1))
    }
    end.u32(endOfCentralDirectorySignature)
    end.u16(UInt16(0))
    end.u16(UInt16(0))
    end.u16(countOverflows ? maxUInt16 : count)
    end.u16(countOverflows ? maxUInt16 : count)
    end.u32(sizeOverflows ? maxUInt32 : centralSize)
    end.u32(offsetOverflows ? maxUInt32 : centralOffset)
    end.u16(UInt16(0))
    try output.write(contentsOf: end.data)
}
