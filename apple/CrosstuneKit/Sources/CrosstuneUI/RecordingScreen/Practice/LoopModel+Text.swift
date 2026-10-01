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
        let limit = Vocabulary.Limits.RecordingLoop.label
        guard text.unicodeScalars.count > limit else { return text }
        var kept = ""
        var scalars = 0
        for character in text {
            scalars += character.unicodeScalars.count
            if scalars > limit { break }
            kept.append(character)
        }
        return kept
    }

    static func canCreate(liveCount: Int, bounds: LoopSpan) -> (allowed: Bool, reason: String?) {
        if liveCount >= maxLoops { return (false, PracticeText.loopLimit) }
        if bounds.endMs - bounds.startMs < minLoopMs { return (false, nil) }
        return (true, nil)
    }
}
