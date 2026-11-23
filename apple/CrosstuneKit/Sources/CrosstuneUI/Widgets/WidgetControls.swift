import CrosstuneRecording
import CrosstuneRecordingActivity
import CrosstuneWidgetIntents

/// The control that widget and Live Activity buttons run on without opening the app. Each button
/// acts on the list player or recorder. When neither holds what the button is for, as after the
/// app was ended while suspended, the button clears that state from the widget summary instead,
/// so the widget stops offering it.
@MainActor
public final class WidgetControls: WidgetPlaybackControl, RecordingControl {
    private let listPlayback: ListPlayback
    private let recorders: RecorderHost
    private let publisher: WidgetPublisher?

    /// - Parameter publisher: Nil in a build without the App Group, which has no summary to clear.
    init(listPlayback: ListPlayback, recorders: RecorderHost, publisher: WidgetPublisher?) {
        self.listPlayback = listPlayback
        self.recorders = recorders
        self.publisher = publisher
    }

    public func pauseList() async {
        guard listPlayback.isActive else {
            publisher?.clearListPlayback()
            return
        }
        await listPlayback.pauseList()
    }

    public func resumeList() async {
        guard listPlayback.isActive else {
            publisher?.clearListPlayback()
            return
        }
        await listPlayback.resumeList()
    }

    public func stop() async {
        await recorders.stop()
    }

    public func resume() async {
        guard let recorder = recorders.current, recorder.state != .idle else {
            publisher?.clearRecording()
            return
        }
        await recorders.resume()
    }
}
