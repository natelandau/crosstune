/// The widgets' kinds, which the widgets register under and the app reloads by.
public enum WidgetKind: String, CaseIterable, Sendable {
    case recordings = "Recordings"
    case list = "List"
    case tuner = "Tuner"

    /// The kinds whose part of the summary differs between `old` and `new`, so a write reloads
    /// only those. Every kind when nothing was written before.
    public static func showingChanges(from old: WidgetSummary?, to new: WidgetSummary) -> Set<WidgetKind> {
        guard let old else { return Set(allCases) }
        var kinds = Set<WidgetKind>()
        if old.recordingsPlay != new.recordingsPlay || old.recordings != new.recordings
            || old.recording != new.recording || old.recordingFreshUntil != new.recordingFreshUntil
        {
            kinds.insert(.recordings)
        }
        if old.lists != new.lists || old.listPlayback != new.listPlayback { kinds.insert(.list) }
        if old.tunerReferenceLabel != new.tunerReferenceLabel { kinds.insert(.tuner) }
        return kinds
    }
}
