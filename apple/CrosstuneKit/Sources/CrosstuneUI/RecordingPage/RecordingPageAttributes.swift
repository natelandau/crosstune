import CrosstuneDesign
import SwiftUI

/// The recording's attributes, each row editing in place, with the map of the spot under the
/// Location row, ended by the day the recording was added.
struct RecordingPageAttributes: View {
    let rows: ScreenRows
    let attributeRows: [AttributeColumnRow<RecordingAttributeID>]
    let fields: RecordingAttributeModel
    let layout: AttributesLayout
    /// Opens the recording's tune; nil, as for an unfiled recording, leaves Go to tune out.
    let onGoToTune: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
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
                dateAdded
                    .padding(.top, AttributesLayout.columnGroupGap)
            }
            // The column draws its footer; the card has none, so the line follows it.
            if layout == .card {
                dateAdded
                    .padding(.top, 16)
            }
        }
    }

    private var dateAdded: some View {
        AddedOn(date: rows.recording.addedAt.date)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, layout.textInset)
    }
}
