import Testing

@testable import CrosstuneWidgetIntents

@MainActor
struct WidgetRequestInboxTests {
    @Test func inboxHoldsOneRequestUntilTaken() {
        let inbox = WidgetRequestInbox()
        inbox.post(.openTuner)
        #expect(inbox.pending == .openTuner)
        #expect(inbox.take() == .openTuner)
        #expect(inbox.take() == nil)
    }

    @Test func aNewRequestReplacesAnUntakenOne() {
        let inbox = WidgetRequestInbox()
        inbox.post(.openTuner)
        inbox.post(.record)
        #expect(inbox.take() == .record)
        #expect(inbox.take() == nil)
    }

    struct UserChanges: Sendable, CustomTestStringConvertible {
        let testDescription: String
        /// The changes before the request is posted, then the ones after.
        let before: [UserChange]
        let after: [UserChange]
        let kept: Bool
    }

    struct UserChange: Sendable {
        let from: String?
        let to: String?
    }

    nonisolated static let userChanges: [UserChanges] = [
        UserChanges(
            testDescription: "first store opens", before: [], after: [UserChange(from: nil, to: "a")], kept: true),
        UserChanges(
            testDescription: "first store already open", before: [], after: [UserChange(from: "a", to: "a")], kept: true
        ),
        UserChanges(
            testDescription: "sign-out", before: [UserChange(from: nil, to: "a")],
            after: [UserChange(from: "a", to: nil)],
            kept: false),
        UserChanges(
            testDescription: "account switch", before: [UserChange(from: nil, to: "a")],
            after: [UserChange(from: "a", to: "b")], kept: false),
        UserChanges(
            testDescription: "sign-out, then sign-in",
            before: [UserChange(from: nil, to: "a"), UserChange(from: "a", to: nil)],
            after: [UserChange(from: nil, to: "b")], kept: false),
    ]

    /// A tap can launch the app before its first store opens, so that store keeps the request.
    /// Any later change of user drops it, so it never runs in another session.
    @Test(arguments: userChanges)
    func aRequestSurvivesOnlyTheFirstStore(_ changes: UserChanges) {
        let inbox = WidgetRequestInbox()
        for change in changes.before { inbox.userChanged(from: change.from, to: change.to) }
        inbox.post(.record)
        for change in changes.after { inbox.userChanged(from: change.from, to: change.to) }
        #expect((inbox.pending != nil) == changes.kept)
    }
}
