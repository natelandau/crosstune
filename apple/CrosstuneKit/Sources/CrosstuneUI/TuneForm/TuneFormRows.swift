import CrosstuneAnalytics
import CrosstuneVocabulary
import SwiftUI

/// The status field's choices, one segment per word. A system segment shows an image or a
/// word, never both, and the words are what a musician chooses by.
enum StatusField {
    static var segments: [(value: String, label: String)] {
        Vocabulary.statuses.map { ($0, StatusStyle.label($0)) }
    }

    /// The segment shown as chosen. A stored status this build cannot read shows as want to learn.
    static func chosen(_ status: String) -> String {
        StatusStyle.normalized(status)
    }
}

/// The tune form's status field.
struct StatusPicker: View {
    @Binding var status: String

    var body: some View {
        #if os(macOS)
            MacSegmentedPicker(
                TuneFieldLabels.status,
                selection: Binding {
                    StatusField.chosen(status)
                } set: {
                    if let chosen = $0 { status = chosen }
                },
                options: StatusField.segments)
        #else
            picker
        #endif
    }

    private var picker: some View {
        Picker(
            TuneFieldLabels.status,
            selection: Binding {
                StatusField.chosen(status)
            } set: {
                status = $0
            }
        ) {
            ForEach(StatusField.segments, id: \.value) { segment in
                Text(segment.label).tag(segment.value)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }
}

/// The bulk edit sheet's status row. It shows the status every tune shares, and no segment when
/// they disagree or none holds one. Only a segment that changes a tune touches the row.
enum BulkStatusField {
    static func chosen(_ form: BulkEditForm) -> String? {
        if case .text(let status) = form.value(.status) { status } else { nil }
    }

    static func choose(_ choice: String, in form: inout BulkEditForm) {
        form.touch(.status, .text(choice))
    }
}

struct BulkStatusPicker: View {
    @Binding var form: BulkEditForm

    var body: some View {
        #if os(macOS)
            MacSegmentedPicker(
                TuneFieldLabels.status,
                selection: Binding<String?> {
                    BulkStatusField.chosen(form)
                } set: { choice in
                    if let choice { BulkStatusField.choose(choice, in: &form) }
                },
                options: StatusField.segments)
        #else
            picker
        #endif
    }

    private var picker: some View {
        Picker(
            TuneFieldLabels.status,
            selection: Binding<String?> {
                BulkStatusField.chosen(form)
            } set: { choice in
                // Every segment is tagged with a status, so the picker never sets none.
                if let choice { BulkStatusField.choose(choice, in: &form) }
            }
        ) {
            ForEach(StatusField.segments, id: \.value) { segment in
                Text(segment.label).tag(Optional(segment.value))
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }
}

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
                options: Vocabulary.modes
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
            #if os(macOS)
                .buttonStyle(.macPlain)
            #endif
        }
    }
}

/// A tuning row per instrument, and a capo row for each that takes one.
struct TuningRows: View {
    let instruments: [String]
    @Binding var values: TuneFormValues
    /// The tuning field's focus, for a single instrument's rows whose caller moves it.
    var focus: FocusState<Bool>.Binding?
    /// Runs with a chosen tuning suggestion in place of setting it.
    var onPickTuning: ((_ instrument: String, _ tuning: String) -> Void)?

    #if !os(macOS)
        @Environment(\.rowsOutsideForm) private var outsideForm
    #endif

    nonisolated static func takesCapo(_ instrument: String) -> Bool {
        Vocabulary.capoInstruments.contains(instrument)
    }

    var body: some View {
        ForEach(instruments, id: \.self) { instrument in
            SuggestionField(
                TuneFieldLabels.tuning(instrument), rowLabel: Vocabulary.instrumentLabel(instrument),
                value: Binding {
                    values.tuning(instrument).tuning
                } set: { tuning in
                    values.tunings[instrument, default: TuningValues()].tuning = tuning
                },
                suggestions: Vocabulary.tuningSuggestions[instrument] ?? [],
                maxLength: Vocabulary.Limits.Tune.tuning, focus: focus,
                onPick: onPickTuning.map { pick in { pick(instrument, $0) } })
            // The Tuning header does not name the instrument, so the capo row keeps its full name.
            if Self.takesCapo(instrument) {
                let capo = Binding {
                    values.tuning(instrument).capo
                } set: { capo in
                    values.tunings[instrument, default: TuningValues()].capo = capo
                }
                #if os(macOS)
                    MacPopUp(
                        TuneFieldLabels.capo(instrument), selection: capo,
                        options: [nil] + Vocabulary.capoFrets.map(Optional.some),
                        label: { $0.map { "\($0)" } ?? TuneFieldLabels.noCapo })
                #else
                    if outsideForm {
                        LabeledContent(TuneFieldLabels.capo(instrument)) {
                            capoPicker(instrument, capo).labelsHidden()
                        }
                    } else {
                        capoPicker(instrument, capo)
                    }
                #endif
            }
        }
    }

    #if !os(macOS)
        private func capoPicker(_ instrument: String, _ capo: Binding<Int64?>) -> some View {
            Picker(TuneFieldLabels.capo(instrument), selection: capo) {
                Text(TuneFieldLabels.noCapo).tag(Int64?.none)
                ForEach(Vocabulary.capoFrets, id: \.self) { fret in
                    Text("\(fret)").tag(Int64?.some(fret))
                }
            }
        }
    #endif
}

/// The day the musician learned the tune, or Not set. Setting it starts at today.
struct LearnedOnRow: View {
    @Binding var day: String

    var body: some View {
        #if os(macOS)
            LabeledContent(TuneFieldLabels.learnedOn) {
                MacDateValue(
                    label: TuneFieldLabels.learnedOn, day: day, placeholder: TuneFieldLabels.notSet,
                    onSet: { day = $0 }, onClear: { day = "" })
            }
        #else
            phoneBody
        #endif
    }

    #if !os(macOS)
        @ViewBuilder private var phoneBody: some View {
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
                        .foregroundStyle(.inkSecondary)
                }
            } else {
                LabeledContent(TuneFieldLabels.learnedOn) {
                    Button(TuneFieldLabels.notSet) { day = CalendarDay.day(.now) }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.inkSecondary)
                        .accessibilityLabel("\(TuneFieldLabels.learnedOn), \(TuneFieldLabels.notSet)")
                        .accessibilityHint(TuneFieldLabels.setsToday)
                }
            }
        }
    #endif
}

#if os(macOS)
    /// A calendar day as a form row's value: a date field with a control that clears it, or a
    /// placeholder that a press sets to today.
    struct MacDateValue: View {
        let label: String
        let day: String
        let placeholder: String
        let onSet: (String) -> Void
        let onClear: () -> Void

        var body: some View {
            if let date = CalendarDay.date(day) {
                HStack(spacing: 4) {
                    DatePicker(
                        label,
                        selection: Binding {
                            date
                        } set: {
                            onSet(CalendarDay.day($0))
                        }, displayedComponents: .date
                    )
                    .labelsHidden()
                    Button(TuneFieldLabels.clearDate, systemImage: "xmark.circle.fill", action: onClear)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.macIcon)
                        .help(TuneFieldLabels.clearDate)
                }
            } else {
                Button(placeholder) { onSet(CalendarDay.day(.now)) }
                    .buttonStyle(.macQuiet)
                    .accessibilityLabel("\(label), \(placeholder)")
                    .accessibilityHint(TuneFieldLabels.setsToday)
            }
        }
    }
#endif
