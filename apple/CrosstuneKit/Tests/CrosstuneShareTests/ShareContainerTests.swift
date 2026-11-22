import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneShare

struct ShareContainerTests {
    let root = TemporaryRoot()

    @Test func recordsAndClearsTheSignedInUser() throws {
        let container = ShareContainer(root: try root.folder())
        #expect(container.currentUserID() == nil)

        try container.setCurrentUserID("user_a")
        #expect(container.currentUserID() == "user_a")

        try container.setCurrentUserID(nil)
        #expect(container.currentUserID() == nil)
        try container.setCurrentUserID(nil)
    }

    @Test func readsBackTheTuneListAndAccount() throws {
        let container = ShareContainer(root: try root.folder())
        let tunes = [
            ShareTuneEntry(id: "t1", title: "Drowsy Maggie", detail: "Reel"),
            ShareTuneEntry(id: "t2", title: "Kesh", detail: nil),
        ]
        #expect(ShareTuneList.read(userID: "user_a", in: container).isEmpty)
        #expect(ShareAccount.read(userID: "user_a", in: container) == nil)

        try ShareTuneList.write(tunes, userID: "user_a", in: container)
        try ShareAccount.write(ShareAccount(maxFileBytes: 500), userID: "user_a", in: container)

        #expect(ShareTuneList.read(userID: "user_a", in: container) == tunes)
        #expect(ShareAccount.read(userID: "user_a", in: container) == ShareAccount(maxFileBytes: 500))
    }
}
