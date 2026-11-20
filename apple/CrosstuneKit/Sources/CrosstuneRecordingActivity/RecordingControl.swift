/// The recording actions a Live Activity button can take.
@MainActor
public protocol RecordingControl: AnyObject, Sendable {
    func stop() async
    func resume() async
}

/// A button on the recording Live Activity.
public enum RecordingButton: Sendable {
    case stop, resume

    @MainActor
    public func perform(on control: any RecordingControl) async {
        switch self {
        case .stop: await control.stop()
        case .resume: await control.resume()
        }
    }
}
