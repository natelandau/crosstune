import CrosstuneStore
import CrosstuneVocabulary
import Foundation

extension LoopModel {
    /// What a loop is called: its label, or `Loop 0:58` from where it starts on the trimmed
    /// timeline when it has none.
    static func name(label: String?, startMs: Int64, trimStartMs: Int64) -> String {
        if let label, !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return label }
        return PracticeText.loopName(RecordingText.duration(of: startMs - trimStartMs))
    }

    /// `text` cut to the longest label the server stores, which it counts in code points, so a
    /// character made of several is never split.
    static func cappedLabel(_ text: String) -> String {
        text.cappedCodePoints(Vocabulary.Limits.RecordingLoop.label)
    }
}
