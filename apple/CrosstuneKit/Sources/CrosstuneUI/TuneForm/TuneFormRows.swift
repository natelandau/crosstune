import CrosstuneVocabulary
import SwiftUI

/// One mode row per part, closed to the modes the API knows, with a row to add the next part's.
/// A part's row is removed by swiping it or from its menu; the first always stays.
struct ModeRows: View {
    @Binding var values: TuneFormValues

    var body: some View {
        let rows = values.modeRows
        ForEach(rows.indices, id: \.self) { index in
            SuggestionPicker(
                TuneFieldLabels.partMode(index),
                value: Binding {
                    values.modeRows.indices.contains(index) ? values.modeRows[index] : ""
                } set: { mode in
                    values.setMode(mode, part: index)
                },
                options: Vocabulary.modes, allowsOther: false
            )
            .contextMenu {
                if index > 0 {
                    Button(TuneFieldLabels.removePartMode, systemImage: "minus.circle", role: .destructive) {
                        values.removeModeRow(at: index)
                    }
                }
            }
            .deleteDisabled(index == 0)
        }
        .onDelete { offsets in
            for index in offsets.sorted(by: >) where index > 0 { values.removeModeRow(at: index) }
        }
        if values.canAddModeRow {
            Button(TuneFieldLabels.addPartMode, systemImage: "plus") {
                values.addModeRow()
            }
        }
    }
}

/// A tuning row per instrument, and a capo row for each that takes one.
struct TuningRows: View {
    let instruments: [String]
    @Binding var values: TuneFormValues

    var body: some View {
        ForEach(instruments, id: \.self) { instrument in
            SuggestionPicker(
                TuneFieldLabels.tuning(instrument), rowLabel: TuningText.instrumentLabel(instrument),
                value: Binding {
                    values.tuning(instrument).tuning
                } set: { tuning in
                    values.tunings[instrument, default: TuningValues()].tuning = tuning
                },
                options: Vocabulary.tuningSuggestions[instrument] ?? [], allowsOther: true,
                maxLength: Vocabulary.Limits.Tune.tuning)
            // The Tuning header does not name the instrument, so the capo row keeps its full name.
            if Vocabulary.capoInstruments.contains(instrument) {
                Picker(
                    TuneFieldLabels.capo(instrument),
                    selection: Binding {
                        values.tuning(instrument).capo
                    } set: { capo in
                        values.tunings[instrument, default: TuningValues()].capo = capo
                    }
                ) {
                    Text(TuneFieldLabels.noCapo).tag(Int64?.none)
                    ForEach(Vocabulary.capoFrets, id: \.self) { fret in
                        Text("\(fret)").tag(Int64?.some(fret))
                    }
                }
            }
        }
    }
}

/// The day the musician learned the tune, or Not set. Setting it starts at today.
struct LearnedOnRow: View {
    @Binding var day: String

    var body: some View {
        if let date = CalendarDay.date(day) {
            HStack {
                DatePicker(
                    TuneFieldLabels.learnedOn,
                    selection: Binding {
                        date
                    } set: {
                        day = CalendarDay.day($0)
                    }, displayedComponents: .date)
                Button(TuneFieldLabels.clearDate, systemImage: "xmark.circle.fill") { day = "" }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
            }
        } else {
            LabeledContent(TuneFieldLabels.learnedOn) {
                Button(TuneFieldLabels.notSet) { day = CalendarDay.day(.now) }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("\(TuneFieldLabels.learnedOn), \(TuneFieldLabels.notSet)")
                    .accessibilityHint(TuneFieldLabels.setsToday)
            }
        }
    }
}

/// The whole lyrics body, on a page of its own pushed from the form. What is typed stays part of
/// the form, so the form's Cancel discards it with everything else.
struct LyricsEditor: View {
    @Binding var lyrics: String

    var body: some View {
        TextEditor(text: $lyrics)
            .characterLimit(Vocabulary.Limits.Tune.lyrics, text: $lyrics)
            .accessibilityLabel(TuneFieldLabels.lyrics)
            .overlay(alignment: .topLeading) {
                if lyrics.isEmpty {
                    Text(TuneFieldLabels.lyricsPlaceholder)
                        .foregroundStyle(.tertiary)
                        .padding(.top, 8)
                        .padding(.leading, 5)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal)
            .navigationTitle(TuneFieldLabels.lyrics)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
    }
}
