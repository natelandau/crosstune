/// The steps Practice, Trim, and Split move and zoom a waveform by.
enum WaveformSteps {
    /// An arrow press or a VoiceOver adjustment.
    static let nudgeMs: Int64 = 100
    /// A Shift-arrow press.
    static let largeNudgeMs: Int64 = 1000
    /// A zoom button press.
    static let zoomStep = 2.0
}
