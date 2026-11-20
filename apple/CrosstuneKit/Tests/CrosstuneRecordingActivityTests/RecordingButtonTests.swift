import Testing

@testable import CrosstuneRecordingActivity

@MainActor
final class FakeControl: RecordingControl {
    enum Call: Equatable { case stop, resume }

    var calls: [Call] = []

    func stop() async { calls.append(.stop) }
    func resume() async { calls.append(.resume) }
}

@MainActor
@Test(arguments: [
    (RecordingButton.stop, [FakeControl.Call.stop]),
    (RecordingButton.resume, [FakeControl.Call.resume]),
])
func buttonsCallTheMatchingAction(button: RecordingButton, expected: [FakeControl.Call]) async {
    let control = FakeControl()
    await button.perform(on: control)
    #expect(control.calls == expected)
}
