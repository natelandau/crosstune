import SwiftUI
import Testing

@testable import CrosstuneUI

private struct Item: Identifiable, Equatable {
    let id: String
}

@MainActor @Observable private final class Holder {
    var item: String? = "tune"
    var row: Item? = Item(id: "a")
}

@MainActor
struct PresentedItemTests {
    @Test func showsWhileTheItemIsSetAndDismissingClearsIt() {
        let holder = Holder()
        let isPresented = Bindable(holder).item.isPresent()
        #expect(isPresented.wrappedValue)

        isPresented.wrappedValue = true
        #expect(holder.item == "tune")

        isPresented.wrappedValue = false
        #expect(holder.item == nil)
        #expect(isPresented.wrappedValue == false)
    }

    @Test func aRowSeesOnlyItsOwnItemAndClearsOnlyItsOwn() {
        let holder = Holder()
        let own = Bindable(holder).row.matching("a")
        let other = Bindable(holder).row.matching("b")
        #expect(own.wrappedValue == Item(id: "a"))
        #expect(other.wrappedValue == nil)

        other.wrappedValue = nil
        #expect(holder.row == Item(id: "a"))

        own.wrappedValue = nil
        #expect(holder.row == nil)
    }
}
