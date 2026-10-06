import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct PhoneMotionTests {
    @Test func theMacNeverMoves() {
        #expect(PhoneMotion.resolve(reduceMotion: false, animatesPhoneMotion: false) == .none)
        #expect(PhoneMotion.resolve(reduceMotion: true, animatesPhoneMotion: false) == .none)
        #expect(PhoneMotion.none.animation(.default) == nil)
    }

    @Test func reduceMotionCrossFadesInsteadOfMoving() {
        let motion = PhoneMotion.resolve(reduceMotion: true, animatesPhoneMotion: true)
        #expect(motion == .crossFade)
        #expect(motion.animation(.spring()) != nil)
        #expect(motion.animation(.spring(), reduced: nil) == nil)
        #expect(motion.countTransition(value: 2) == .opacity)
    }

    @Test func fullMotionKeepsTheSlideAndTheRoll() {
        let motion = PhoneMotion.resolve(reduceMotion: false, animatesPhoneMotion: true)
        #expect(motion == .full)
        #expect(motion.animation(.spring()) != nil)
        // The roll keeps its direction: up as the count grows, down as it falls.
        #expect(motion.countTransition(value: 2) == .numericText(value: 2))
        #expect(motion.countTransition(value: 2) != .numericText())
    }
}
