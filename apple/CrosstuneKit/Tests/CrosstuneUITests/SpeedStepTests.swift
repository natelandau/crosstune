import Testing

@testable import CrosstuneUI

@Suite struct SpeedStepTests {
    @Test(arguments: [
        (70, -5, 65),
        (70, 5, 75),
        (72, -5, 70),
        (72, 5, 75),
        (73, -5, 70),
        (73, 5, 75),
        (72, -10, 65),
        (52, -5, 50),
        (148, 5, 150),
        (50, -5, 50),
        (150, 5, 150),
    ])
    func neverSkipsAGridStep(percent: Int, delta: Int, expected: Int) {
        #expect(SpeedPanel.stepped(percent, by: delta) == expected)
    }
}
