import CrosstuneVocabulary
import Foundation

/// The Isolate panel's readouts: where each range sits, in words.
enum IsolateReadout {
    private static let panMin = Vocabulary.Ranges.Recording.isolatePanStart.lowerBound
    private static let panMax = Vocabulary.Ranges.Recording.isolatePanEnd.upperBound

    /// `Left of center, 35 left`: a stereo edge's place in words and in units off center, or the
    /// words alone at center.
    static func stereoEdge(_ pan: Int) -> String {
        if pan == 0 { return position(Double(pan)) }
        let units = pan < 0 ? RecordingScreenText.stereoLeftBy(-pan) : RecordingScreenText.stereoRightBy(pan)
        return "\(position(Double(pan))), \(units)"
    }

    /// `Left of center`, where a place in the stereo picture (-100 to 100) sits.
    static func position(_ pan: Double) -> String {
        let distance = abs(pan)
        if distance < 10 { return RecordingScreenText.stereoCenter }
        if distance >= 60 { return pan < 0 ? RecordingScreenText.stereoLeft : RecordingScreenText.stereoRight }
        return pan < 0 ? RecordingScreenText.stereoLeftOfCenter : RecordingScreenText.stereoRightOfCenter
    }

    private static func stereoWidth(_ width: Int) -> String {
        if width < 25 { return RecordingScreenText.stereoNarrow }
        if width < 60 { return RecordingScreenText.stereoMedium }
        return RecordingScreenText.stereoWide
    }

    /// `Left of center, medium`: where the stereo range sits and how wide it is.
    static func stereo(start: Int, end: Int) -> String {
        if start <= panMin && end >= panMax { return RecordingScreenText.stereoEverything }
        return "\(position(Double(start + end) / 2)), \(stereoWidth(end - start))"
    }

    /// `200 Hz` or `4.1 kHz`.
    static func hz(_ hz: Int) -> String {
        if hz < 1000 { return "\(hz) Hz" }
        let tenths = Int((Double(hz) / 100).rounded())
        return tenths % 10 == 0 ? "\(tenths / 10) kHz" : "\(tenths / 10).\(tenths % 10) kHz"
    }

    /// `200 Hz to 4.1 kHz`.
    static func frequency(low: Int, high: Int) -> String {
        "\(hz(low)) to \(hz(high))"
    }
}
