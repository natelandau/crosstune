/// The stepping rules of a value stepper, apart from its view.
package enum StepperModel {
    /// `value` moved by `step`, held inside `range`.
    package static func stepped(_ value: Int, by step: Int, in range: ClosedRange<Int>) -> Int {
        min(max(value + step, range.lowerBound), range.upperBound)
    }

    /// Whether a step changes the value.
    package static func canStep(_ value: Int, by step: Int, in range: ClosedRange<Int>) -> Bool {
        stepped(value, by: step, in: range) != value
    }

    /// The value after one repeat step, or nil once a bound stops the repeat.
    package static func repeated(_ value: Int, by step: Int, in range: ClosedRange<Int>) -> Int? {
        canStep(value, by: step, in: range) ? stepped(value, by: step, in: range) : nil
    }
}
