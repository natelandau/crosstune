import CrosstuneDesign
import SwiftUI

/// The recording's attributes, each row editing in place, with the map of the spot under the
/// Location row.
struct RecordingPageAttributes: View {
    let rows: ScreenRows
    let attributeRows: [AttributeColumnRow<RecordingAttributeID>]
    let fields: RecordingAttributeModel
    let layout: AttributesLayout
    /// Opens the recording's tune; nil, as for an unfiled recording, leaves Go to tune out.
    let onGoToTune: (() -> Void)?

    var body: some View {
        AttributesColumn(
            owner: rows.recording.id, heading: RecordingPageCopy.attributesLabel, groups: RecordingPageRows.groups,
            rows: attributeRows, emptyText: RecordingPageCopy.notSet, layout: layout,
            failure: fields.failure
        ) { row, isPresented, button in
            button
                .recordingEditor(
                    for: row.id, rows: rows, isPresented: isPresented, label: row.label, model: fields,
                    onGoToTune: onGoToTune)
        } below: { id, isPresented in
            if id == .location, let point = RecordingPageRows.mapPoint(rows) {
                RecordingLocationMap(point: point, address: RecordingPageRows.placeAddress(rows)) {
                    isPresented.wrappedValue = true
                }
                .padding(.horizontal, layout.textInset)
                .padding(.bottom, layout == .card ? PageStyle.attributesCardInset : 8)
            }
        } footer: {
            EmptyView()
        }
    }
}
