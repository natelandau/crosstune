import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import Observation
import SwiftUI
import os

/// The words the Edit recording sheet shows.
public enum EditRecordingText {
    public static let title = "Edit recording"
    public static let nameHeader = "Name"
    public static let nameLabel = "Recording name"
    public static let placeholder = "Jam at Tom’s, take 2, …"
    public static let dateHeader = "Date recorded"
    public static let year = "Year"
    public static let month = "Month"
    public static let day = "Day"
    public static let any = "Any"
    public static let clearDate = "Clear date"

    /// `Recorded at <time>`: the exact time of a take, which its date parts cannot show.
    public static func recordedAtNote(
        _ at: Timestamp, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> String {
        "Recorded at \(at.date.formatted(Date.FormatStyle(time: .shortened, locale: locale, timeZone: timeZone)))"
    }
}

/// The Edit sheet's state: the typed name, the date recorded, and the one save they make. A
/// blank name clears the recording's own name, so it goes back to being named for its tune or
/// its date. The date is written only when its parts changed.
@MainActor
@Observable
public final class EditRecordingModel {
    public let recordingID: String
    public private(set) var name: String
    public private(set) var date: RecordingDateDraft
    public private(set) var isSaving = false
    /// Set once a save lands, so a second press saves nothing more.
    public private(set) var isSaved = false
    /// The last save's failure, cleared at the next edit.
    public private(set) var failure: String?
    /// Why the date parts cannot be stored, shown under them and cleared at the next edit.
    public private(set) var dateFailure: String?

    private let store: CrosstuneStore
    private let openedName: String
    private let now: () -> Timestamp
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "edit-recording")

    /// `timeZone` reads a take's day; `now` decides which dates are still to come.
    public init(
        store: CrosstuneStore, recording: Recording, timeZone: TimeZone = .current,
        now: @escaping () -> Timestamp = { .now }
    ) {
        self.store = store
        self.now = now
        recordingID = recording.id
        name = recording.label ?? ""
        openedName = recording.label ?? ""
        date = RecordingDateDraft(recording: recording, timeZone: timeZone)
    }

    /// Whether the sheet holds an edit a dismissal would lose.
    public var isEdited: Bool { name != openedName || date.isChanged }

    public func setName(_ name: String) {
        self.name = name
        failure = nil
    }

    public func setYear(_ year: String) { editDate { $0.setYear(year) } }
    public func setMonth(_ month: Int?) { editDate { $0.setMonth(month) } }
    public func setDay(_ day: Int?) { editDate { $0.setDay(day) } }
    public func clearDate() { editDate { $0.clear() } }

    private func editDate(_ edit: (inout RecordingDateDraft) -> Void) {
        edit(&date)
        dateFailure = nil
        failure = nil
    }

    /// Saves the trimmed name, or clears it when blank, and the date when it changed, in one
    /// write. True once the save lands; a date that cannot be stored writes nothing.
    public func save() async -> Bool {
        guard !isSaving, !isSaved else { return false }
        let time = now()
        var newDate: (at: Timestamp?, precision: RecordingPrecision?)?
        if date.isChanged {
            do {
                newDate = try date.resolved(now: time)
            } catch {
                dateFailure = error.message
                return false
            }
        }
        isSaving = true
        failure = nil
        defer { isSaving = false }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let recordingID = recordingID
        let written = newDate
        do {
            try await store.write { writer in
                try writer.updateRecording(recordingID, label: .value(trimmed.isEmpty ? nil : trimmed), at: time)
                if let written {
                    try writer.updateRecordingDate(
                        recordingID, recordedAt: written.at, precision: written.precision, at: time)
                }
            }
            isSaved = true
            return true
        } catch {
            Self.logger.warning("A recording edit failed: \(error)")
            failure = ListModel.message(error)
            return false
        }
    }
}

/// A recording's name and the date it was recorded, over whatever screen asked. Reads the store
/// from the environment.
public struct EditRecordingSheet: View {
    private let view: RecordingView

    @Environment(\.store) private var store
    @State private var model: EditRecordingModel?

    public init(view: RecordingView) {
        self.view = view
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let model {
                    EditRecordingForm(model: model)
                } else {
                    Color.clear
                }
            }
            .navigationTitle(EditRecordingText.title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        #if os(iOS)
            // Full height at once, so Date recorded stays above the keyboard.
            .presentationDetents([.large])
            .shellSheet()
        #else
            .frame(minWidth: 480, idealWidth: 480, minHeight: 380)
            .shellSheet()
        #endif
        .task {
            guard model == nil, let store else { return }
            model = EditRecordingModel(store: store, recording: view.recording)
        }
    }
}

private struct EditRecordingForm: View {
    let model: EditRecordingModel

    private enum Field: Hashable {
        case name
        case year
    }

    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Field?

    private static let months = Array(1...12)

    var body: some View {
        Form {
            nameSection
            dateSection
        }
        .formStyle(.grouped)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(TuneFormSheet.cancel) { dismiss() }
                    .disabled(model.isSaving)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(ListNameSheet.save, action: save)
                    .fontWeight(.semibold)
                    .disabled(model.isSaving || model.isSaved)
            }
        }
        .interactiveDismissDisabled(model.isEdited || model.isSaving)
        .onAppear { focused = .name }
    }

    private var nameSection: some View {
        let name = Binding {
            model.name
        } set: {
            model.setName($0)
        }
        return Section {
            TextField(EditRecordingText.nameLabel, text: name, prompt: Text(EditRecordingText.placeholder))
                .characterLimit(Vocabulary.Limits.Recording.label, text: name)
                .focused($focused, equals: .name)
                .submitLabel(.done)
                .onSubmit(save)
        } header: {
            Text(EditRecordingText.nameHeader)
        } footer: {
            if let failure = model.failure {
                Text(failure)
                    .foregroundStyle(.red)
            }
        }
    }

    private var dateSection: some View {
        let date = model.date
        let year = Binding {
            date.year
        } set: {
            model.setYear($0)
        }
        let month = Binding {
            date.month
        } set: {
            model.setMonth($0)
        }
        let day = Binding {
            date.day
        } set: {
            model.setDay($0)
        }
        return Section {
            LabeledContent(EditRecordingText.year) {
                TextField(EditRecordingText.year, text: year, prompt: Text(TuneFieldLabels.notSet))
                    .multilineTextAlignment(.trailing)
                    #if os(iOS)
                        .keyboardType(.numberPad)
                    #endif
                    .focused($focused, equals: .year)
                    .submitLabel(.done)
                    .onSubmit(save)
            }
            Picker(EditRecordingText.month, selection: month) {
                Text(EditRecordingText.any).tag(Int?.none)
                ForEach(Self.months, id: \.self) { choice in
                    Text(Calendar.current.standaloneMonthSymbols[choice - 1]).tag(Int?.some(choice))
                }
            }
            .disabled(!date.isMonthEnabled)
            Picker(EditRecordingText.day, selection: day) {
                Text(EditRecordingText.any).tag(Int?.none)
                // Kept while Day is disabled, so a chosen day still shows its value.
                ForEach(Array(stride(from: 1, through: date.dayCount, by: 1)), id: \.self) { choice in
                    Text(String(choice)).tag(Int?.some(choice))
                }
            }
            .disabled(!date.isDayEnabled)
            Button(EditRecordingText.clearDate) { model.clearDate() }
                .disabled(date.isEmpty)
        } header: {
            Text(EditRecordingText.dateHeader)
        } footer: {
            if let dateFailure = model.dateFailure {
                Text(dateFailure)
                    .foregroundStyle(.red)
            } else if let take = date.keptTake {
                Text(EditRecordingText.recordedAtNote(take))
            }
        }
    }

    private func save() {
        Task {
            guard await model.save() else {
                focused = model.dateFailure == nil ? .name : .year
                return
            }
            dismiss()
        }
    }
}
