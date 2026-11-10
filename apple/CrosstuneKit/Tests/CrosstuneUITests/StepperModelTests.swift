import Testing

@testable import CrosstuneDesign

struct StepperModelTests {
    @Test func stepClampsToTheRange() {
        #expect(StepperModel.stepped(12, by: 1, in: -12...12) == 12)
        #expect(StepperModel.stepped(-11, by: -5, in: -12...12) == -12)
    }

    @Test func cannotStepPastABound() {
        #expect(StepperModel.canStep(12, by: 1, in: -12...12) == false)
        #expect(StepperModel.canStep(-12, by: -1, in: -12...12) == false)
        #expect(StepperModel.canStep(11, by: 1, in: -12...12))
    }

    @Test func repeatStopsAtBound() {
        let range = -12...12
        #expect(StepperModel.repeated(10, by: 1, in: range) == 11)
        #expect(StepperModel.repeated(11, by: 1, in: range) == 12)
        #expect(StepperModel.repeated(12, by: 1, in: range) == nil)
        #expect(StepperModel.repeated(-11, by: -5, in: range) == -12)
        #expect(StepperModel.repeated(-12, by: -5, in: range) == nil)
    }
}
