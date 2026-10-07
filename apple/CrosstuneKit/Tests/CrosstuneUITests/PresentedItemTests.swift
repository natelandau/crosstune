import SwiftUI
import Testing

@testable import CrosstuneUI

@MainActor @Observable private final class Holder {
    var item: String? = "tune"
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
        #expect(!isPresented.wrappedValue)
    }
}
