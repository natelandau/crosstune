import CrosstuneStore
import Foundation
import GRDB

/// Where an import puts its tunes.
public enum ImportListChoice: Equatable, Sendable {
    case none
    case new(name: String)
    case existing(listID: String)
}

/// One batch of titles to add, with the status and genre every tune in it takes.
public struct ImportPlan: Equatable, Sendable {
    public let titles: [String]
    public let status: String
    public let genre: String?
    public let list: ImportListChoice

    public init(titles: [String], status: String, genre: String?, list: ImportListChoice) {
        self.titles = titles
        self.status = status
        self.genre = genre
        self.list = list
    }
}

/// What an import created: the user tune ids in title order, and the list they went on, if any.
public struct ImportResult: Equatable, Sendable {
    public let userTuneIDs: [String]
    public let listID: String?
    public let listCreated: Bool
}

extension StoreWriter {
    /// Adds one tune per title, and optionally puts them all on a list, in the caller's
    /// transaction so a refusal anywhere leaves nothing behind. Titles keep their order on the list.
    public func importTunes(_ plan: ImportPlan, at time: Timestamp = .now) throws -> ImportResult {
        guard !plan.titles.isEmpty else { throw CommandError.nothingToImport }

        var listID: String?
        var listCreated = false
        if case .existing(let id) = plan.list {
            guard let list = try TuneList.fetchOne(db, key: id), list.deletedAt == nil else {
                throw CommandError.listNotFound
            }
            listID = list.id
        }

        let userTune = UserTuneInput(status: plan.status)
        var userTuneIDs: [String] = []
        for title in plan.titles {
            let created = try createTune(TuneInput(title: title, genre: plan.genre), userTune: userTune, at: time)
            userTuneIDs.append(created.userTuneID)
        }

        if case .new(let name) = plan.list {
            listID = try createList(name, at: time)
            listCreated = true
        }
        if let listID { try addTunesToList(listID: listID, userTuneIDs: userTuneIDs, at: time) }
        return ImportResult(userTuneIDs: userTuneIDs, listID: listID, listCreated: listCreated)
    }
}

extension Commands {
    public func importTunes(_ plan: ImportPlan) async throws -> ImportResult {
        try await store.write { writer in try writer.importTunes(plan) }
    }
}

/// Decodes the bytes of an opened text file.
public enum ImportText {
    /// UTF-16 by its byte-order mark, otherwise UTF-8; the mark itself is dropped. Bytes that do
    /// not decode, an odd byte at the end of UTF-16 included, become replacement characters
    /// rather than failing, as the web client's `TextDecoder` has them.
    public static func decode(_ data: Data) -> String {
        let bytes = [UInt8](data.prefix(3))
        if bytes.starts(with: [0xFF, 0xFE]) {
            return String(decoding: littleEndianUnits(data.dropFirst(2)), as: UTF16.self)
        }
        if bytes.starts(with: [0xFE, 0xFF]) {
            return String(decoding: bigEndianUnits(data.dropFirst(2)), as: UTF16.self)
        }
        let body = bytes == [0xEF, 0xBB, 0xBF] ? data.dropFirst(3) : data[...]
        return String(decoding: body, as: UTF8.self)
    }

    private static func littleEndianUnits(_ data: Data) -> [UInt16] {
        units(data) { UInt16($0) | UInt16($1) << 8 }
    }

    private static func bigEndianUnits(_ data: Data) -> [UInt16] {
        units(data) { UInt16($0) << 8 | UInt16($1) }
    }

    private static func units(_ data: Data, _ unit: (UInt8, UInt8) -> UInt16) -> [UInt16] {
        let bytes = [UInt8](data)
        var units = stride(from: 0, to: bytes.count - 1, by: 2).map { unit(bytes[$0], bytes[$0 + 1]) }
        if bytes.count % 2 == 1 { units.append(0xFFFD) }
        return units
    }
}
