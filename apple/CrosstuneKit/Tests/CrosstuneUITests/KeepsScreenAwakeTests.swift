import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct KeepsScreenAwakeTests {
    @Test(arguments: [ScenePhase.active, .inactive, .background], [true, false])
    func holdsOnlyWhileActiveInTheForeground(phase: ScenePhase, active: Bool) {
        #expect(KeepsScreenAwake.holds(active: active, phase: phase) == (active && phase == .active))
    }

    @MainActor
    @Test func theDisplaySleepsOnlyOnceEveryHoldLetsGo() {
        var awake: [Bool] = []
        let holds = ScreenAwakeHolds { awake.append($0) }
        let reader = ScreenAwakeHold(holds: holds)
        let tuner = ScreenAwakeHold(holds: holds)

        reader.set(true)
        tuner.set(true)
        reader.set(false)
        #expect(holds.count == 1)
        #expect(awake == [true])

        tuner.set(false)
        #expect(holds.count == 0)
        #expect(awake == [true, false])
    }

    @MainActor
    @Test func aHoldCountsOnceHoweverOftenItIsSet() {
        let holds = ScreenAwakeHolds { _ in }
        let hold = ScreenAwakeHold(holds: holds)
        let other = ScreenAwakeHold(holds: holds)

        other.set(true)
        hold.set(false)
        hold.set(true)
        hold.set(true)
        #expect(holds.count == 2)

        hold.set(false)
        hold.set(false)
        #expect(holds.count == 1)
    }
}
