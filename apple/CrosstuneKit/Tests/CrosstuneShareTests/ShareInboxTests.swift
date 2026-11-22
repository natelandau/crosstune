import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneShare

struct ShareInboxTests {
    let root = TemporaryRoot()

    private func container() throws -> ShareContainer {
        ShareContainer(root: try root.folder())
    }

    /// A share time `seconds` after a fixed moment, in milliseconds.
    private func time(_ seconds: TimeInterval) -> Int64 {
        1_790_000_000_000 + Int64(seconds * 1000)
    }

    @Test func roundTripsEachItemKind() throws {
        let container = try container()
        let existing = ShareItem.link(
            url: "https://example.com/a", title: "A", tune: .existing(id: "t1", title: "Drowsy Maggie"),
            sharedAt: time(0))
        let new = ShareItem.link(
            url: "https://example.com/b", title: nil, tune: .new(id: "t2", title: "Kesh"), sharedAt: time(1))
        let audio = ShareItem.audio(fileName: "memo.m4a", sharedName: "memo.m4a", label: "Memo", sharedAt: time(2.25))
        let source = try root.folder().appending(path: "source.m4a")
        try Data([1, 2, 3]).write(to: source)

        try ShareInbox.add(audio, audioFrom: source, userID: "user_a", in: container)
        try ShareInbox.add(existing, audioFrom: nil, userID: "user_a", in: container)
        try ShareInbox.add(new, audioFrom: nil, userID: "user_a", in: container)

        let pending = ShareInbox.pending(userID: "user_a", in: container)
        #expect(pending.map(\.item) == [existing, new, audio])
        let audioFile = try #require(pending.last?.audioFile)
        #expect(try FileHandle(forReadingFrom: audioFile).readToEnd() == Data([1, 2, 3]))
    }

    @Test func refusesAnAudioItemWithoutItsFile() throws {
        let container = try container()
        let audio = ShareItem.audio(fileName: "memo.m4a", sharedName: "memo.m4a", label: "Memo", sharedAt: time(0))

        #expect(throws: (any Error).self) {
            try ShareInbox.add(audio, audioFrom: nil, userID: "user_a", in: container)
        }
        #expect(ShareInbox.pending(userID: "user_a", in: container).isEmpty)
    }

    @Test func listsOnlyCompleteItems() throws {
        let container = try container()
        let partial = container.userFolder("user_a").appending(path: "inbox/.partial-x", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: partial, withIntermediateDirectories: true)
        let item = ShareItem.audio(fileName: "memo.m4a", sharedName: "memo.m4a", label: "Memo", sharedAt: time(0))
        try JSONEncoder().encode(item).write(to: partial.appending(path: "item.json"))

        #expect(ShareInbox.pending(userID: "user_a", in: container).isEmpty)
    }

    @Test func readsOnlyItsOwnUser() throws {
        let container = try container()
        let item = ShareItem.link(
            url: "https://example.com", title: nil, tune: .existing(id: "t1", title: "Kesh"), sharedAt: time(0))
        try ShareInbox.add(item, audioFrom: nil, userID: "user_a", in: container)

        #expect(ShareInbox.pending(userID: "user_b", in: container).isEmpty)
    }

    @Test func listsNewTunesStillInTheInbox() throws {
        let container = try container()
        let item = ShareItem.link(
            url: "https://example.com", title: nil, tune: .new(id: "t1", title: "Drowsy Maggie"), sharedAt: time(0))
        try ShareInbox.add(item, audioFrom: nil, userID: "user_a", in: container)

        #expect(
            ShareInbox.pendingNewTunes(userID: "user_a", in: container)
                == [ShareTuneEntry(id: "t1", title: "Drowsy Maggie", detail: nil)])
    }

    /// Several files from one share, at one moment, are added in the order they were shared.
    @Test func listsItemsSharedAtOneMomentInOrder() throws {
        let container = try container()
        let labels = (0..<12).map { "Memo \($0)" }
        for (index, label) in labels.enumerated() {
            let source = try root.folder().appending(path: "\(index).m4a")
            try Data([1]).write(to: source)
            try ShareInbox.add(
                .audio(fileName: "memo.m4a", sharedName: "memo.m4a", label: label, sharedAt: time(0)),
                audioFrom: source, order: index,
                userID: "user_a", in: container)
        }

        let listed = ShareInbox.pending(userID: "user_a", in: container).map { pending -> String in
            guard case .audio(_, _, let label, _) = pending.item else { return "" }
            return label
        }
        #expect(listed == labels)
    }

    @Test func removesOnlyAbandonedCopiesPartialItemsAndUnreadableItems() throws {
        let container = try container()
        let now = Date(timeIntervalSince1970: 1_790_010_000)
        let user = container.userFolder("user_a")
        let old = Int64((now.timeIntervalSince1970 - 2 * 60 * 60) * 1000)
        let fresh = Int64((now.timeIntervalSince1970 - 60) * 1000)
        let names = [
            "incoming/\(old)-a", "incoming/\(fresh)-b", "incoming/unnamed",
            "inbox/.partial-\(old)-c", "inbox/.partial-\(fresh)-d", "inbox/\(old)-complete",
            "inbox/\(old)-unreadable", "inbox/\(fresh)-unreadable",
        ]
        for name in names {
            try FileManager.default.createDirectory(
                at: user.appending(path: name, directoryHint: .isDirectory), withIntermediateDirectories: true)
        }
        let item = ShareItem.link(
            url: "https://example.com", title: nil, tune: .existing(id: "t1", title: "Kesh"), sharedAt: time(0))
        try JSONEncoder().encode(item).write(to: user.appending(path: "inbox/\(old)-complete/item.json"))

        ShareInbox.removeAbandoned(userID: "user_a", in: container, now: now)

        let left = names.filter { FileManager.default.fileExists(atPath: user.appending(path: $0).path) }
        #expect(
            left == [
                "incoming/\(fresh)-b", "inbox/.partial-\(fresh)-d", "inbox/\(old)-complete",
                "inbox/\(fresh)-unreadable",
            ])
    }
}
