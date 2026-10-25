import Foundation
import Testing

@testable import CrosstuneUI

/// The shell's actions compare by the hosts that supplied them, so a host redrawing leaves the
/// screens that read them alone, while actions from different hosts never pass for each other.
@MainActor
@Suite struct TuneScreenActionsTests {
    @Test func actionsFromTheSameHostsAreEqual() {
        let outer = UUID()
        let inner = UUID()
        func build(_ tag: String) -> TuneScreenActions {
            TuneScreenActions()
                .supplied(by: outer) { $0.addLink = { _ in _ = tag } }
                .supplied(by: inner) { $0.readLyrics = { _ in _ = tag } }
        }
        #expect(build("first") == build("second"))
    }

    @Test func actionsFromAnotherHostDiffer() {
        let one = TuneScreenActions().supplied(by: UUID()) { $0.addLink = { _ in } }
        let other = TuneScreenActions().supplied(by: UUID()) { $0.addLink = { _ in } }
        #expect(one != other)
    }

    @Test func actionsHandedToTheInitializerEqualNoOthers() {
        #expect(TuneScreenActions(addLink: { _ in }) != TuneScreenActions(addLink: { _ in }))
        #expect(TuneScreenActions() == TuneScreenActions())
    }

    @Test func listSheetActionsCompareByTheirHost() {
        let host = UUID()
        #expect(
            ListSheetActions(source: host, name: { _ in }, pick: { _ in })
                == ListSheetActions(source: host, name: { _ in }, pick: { _ in }))
        #expect(ListSheetActions(name: { _ in }, pick: { _ in }) != ListSheetActions(name: { _ in }, pick: { _ in }))
    }
}
