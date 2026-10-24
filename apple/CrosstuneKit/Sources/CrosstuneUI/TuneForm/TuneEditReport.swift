import CrosstuneAnalytics
import CrosstuneStore

/// Reports an edit to a tune that landed: the fields it changed, and a status change on its own.
/// An edit that changed nothing reports nothing.
func reportEdit(
    analytics: AnalyticsClient, before: TuneFormValues, after: TuneFormValues, storedTunings: JSONObject,
    tuneID: String
) {
    let fields = after.changedFields(from: before, storedTunings: storedTunings)
    guard !fields.isEmpty else { return }
    analytics.send(.tuneEdited(fieldsChanged: fields, tuneID: tuneID))
    if fields.contains(.status), let from = TuneStatus(before.status), let to = TuneStatus(after.status) {
        analytics.send(.tuneStatusChanged(from: from, to: to, tuneID: tuneID))
    }
}
