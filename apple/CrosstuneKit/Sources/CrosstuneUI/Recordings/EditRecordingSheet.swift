import CrosstuneAnalytics
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
    public static let players = "Players"
    public static let notes = "Notes"
    public static let notesPlaceholder = "Tuning, who it came from, what to work on…"
    public static let place = "Place"
    public static let clearPlace = "Clear place"

    /// `Recorded at <time>`: the exact time of a take, which its date parts cannot show.
    public static func recordedAtNote(
        _ at: Timestamp, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> String {
        "Recorded at \(at.date.formatted(Date.FormatStyle(time: .shortened, locale: locale, timeZone: timeZone)))"
    }
}

/// The Edit sheet's state: the typed name, the date recorded, the notes, players, and place, and
/// the one save they make. A blank name clears the recording's own name, so it goes back to being
/// named for its tune or its date. The date is written only when its parts changed, and the place
/// only when it changed, so a place left alone keeps its captured accuracy.
@MainActor
@Observable
public final class EditRecordingModel {
    public let recordingID: String
    public private(set) var name: String
    public private(set) var date: RecordingDateDraft
    public private(set) var notes: String
    public private(set) var players: String
    public private(set) var place: RecordingPlace?
    /// How the place was picked, nil until one is or once it is cleared.
    public private(set) var placeMethod: PlaceMethod?
    /// Coordinates with no name show no place, yet the musician can still clear them.
    private var hasUnnamedCoordinates: Bool
    /// The players on the musician's recordings, to suggest; empty until ``load()``.
    public private(set) var playerOptions: [String] = []
    /// The places on the musician's other recordings, most recent first; empty until ``load()``.
    public private(set) var recentPlaces: [RecordingPlace] = []
    public private(set) var isSaving = false
    /// Set once a save lands, so a second press saves nothing more.
    public private(set) var isSaved = false
    /// The last save's failure, cleared at the next edit.
    public private(set) var failure: String?
    /// Why the date parts cannot be stored, shown under them and cleared at the next edit.
    public private(set) var dateFailure: String?

    private let store: CrosstuneStore
    private let analytics: AnalyticsClient
    private let recording: Recording
    private let openedName: String
    private let openedNotes: String
    private let openedPlayers: String
    private let now: () -> Timestamp
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "edit-recording")

    /// `timeZone` reads a take's day; `now` decides which dates are still to come.
    public init(
        store: CrosstuneStore, recording: Recording, timeZone: TimeZone = .current,
        now: @escaping () -> Timestamp = { .now }, analytics: AnalyticsClient = .noop
    ) {
        self.store = store
        self.analytics = analytics
        self.recording = recording
        self.now = now
        recordingID = recording.id
        name = recording.label ?? ""
        openedName = recording.label ?? ""
        date = RecordingDateDraft(recording: recording, timeZone: timeZone)
        notes = recording.notes ?? ""
        openedNotes = recording.notes ?? ""
        players = recording.players ?? ""
        openedPlayers = recording.players ?? ""
        place = recording.place
        hasUnnamedCoordinates = Self.unnamedCoordinates(recording)
    }

    /// Whether Clear has a place to clear: a named one, or coordinates with no name yet.
    public var canClearPlace: Bool { place != nil || hasUnnamedCoordinates }

    /// Reads the suggestions from the store. A failed read leaves them empty.
    public func load() async {
        let recordings = try? await store.read { db in try Recording.fetchAll(db) }
        guard let recordings else { return }
        playerOptions = RecordingSuggestions.players(recordings)
        recentPlaces = RecordingSuggestions.recentPlaces(recordings, excluding: recordingID)
    }

    /// Whether the sheet holds an edit a dismissal would lose.
    public var isEdited: Bool {
        name != openedName || date.isChanged || notes != openedNotes || players != openedPlayers || isPlaceChanged
    }

    private var isPlaceChanged: Bool {
        place.map(RecordingSuggestions.picked) != recording.place.map(RecordingSuggestions.picked)
            || hasUnnamedCoordinates != Self.unnamedCoordinates(recording)
    }

    private static func unnamedCoordinates(_ recording: Recording) -> Bool {
        recording.placeName == nil && recording.placeLat != nil && recording.placeLon != nil
    }

    public func setName(_ name: String) {
        self.name = name
        failure = nil
    }

    public func setNotes(_ notes: String) {
        self.notes = notes
        failure = nil
    }

    public func setPlayers(_ players: String) {
        self.players = players
        failure = nil
    }

    /// Sets the place and how it was picked.
    public func setPlace(_ place: RecordingPlace, method: PlaceMethod) {
        self.place = place
        placeMethod = method
        hasUnnamedCoordinates = false
        failure = nil
    }

    public func clearPlace() {
        place = nil
        placeMethod = nil
        hasUnnamedCoordinates = false
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

    /// Saves the trimmed name, and the notes, players, date, and place when they changed, in one
    /// write. Blank notes or players clear them. A field left alone is not written, so an edit
    /// synced while the sheet is open survives. True once the save lands; a date that cannot be
    /// stored writes nothing.
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
        let notes: Patch<String?> = notes == openedNotes ? .keep : .value(Self.blankToNil(notes))
        let players: Patch<String?> = players == openedPlayers ? .keep : .value(Self.blankToNil(players))
        let placeChanged = isPlaceChanged
        let newPlace = place.map(RecordingSuggestions.picked)
        do {
            try await store.write { writer in
                try writer.updateRecording(
                    recordingID, label: .value(trimmed.isEmpty ? nil : trimmed), notes: notes,
                    players: players, place: placeChanged ? .value(newPlace) : .keep, at: time)
                if let written {
                    try writer.updateRecordingDate(
                        recordingID, recordedAt: written.at, precision: written.precision, at: time)
                }
            }
            isSaved = true
            if trimmed != openedName { analytics.recordingRenamed(recording) }
            if placeChanged {
                if newPlace == nil {
                    analytics.recordingPlaceCleared(recording)
                } else if let placeMethod {
                    analytics.recordingPlaceSet(recording, method: placeMethod, replaced: recording.place != nil)
                }
            }
            return true
        } catch {
            Self.logger.warning("A recording edit failed: \(error)")
            failure = failureMessage(error)
            return false
        }
    }

    private static func blankToNil(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// A recording's name, the date it was recorded, its players, its place, and its notes, over
/// whatever screen asked. Reads the store from the environment.
public struct EditRecordingSheet: View {
    private let view: RecordingView

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
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
            .macSheetFrame(.form(minHeight: 560))
            .shellSheet()
        #endif
        .task {
            guard model == nil, let store else { return }
            let opened = EditRecordingModel(store: store, recording: view.recording, analytics: analytics)
            model = opened
            await opened.load()
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
    @Environment(\.placeSearch) private var placeSearch
    @FocusState private var focused: Field?
    /// Set once Name takes focus, so coming back from the place search leaves focus alone.
    @State private var focusedName = false

    private static let months = Array(1...12)

    var body: some View {
        Form {
            nameSection
            dateSection
            playersSection
            notesSection
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
        .onAppear {
            guard !focusedName else { return }
            focusedName = true
            focused = .name
        }
    }

    private var nameSection: some View {
        let name = Binding {
            model.name
        } set: {
            model.setName($0)
        }
        return Section {
            TextField(EditRecordingText.nameLabel, text: name, prompt: Text(EditRecordingText.placeholder))
                .contentMask()
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
                    .contentMask()
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

    private var playersSection: some View {
        Section {
            SuggestionField(
                EditRecordingText.players,
                value: Binding {
                    model.players
                } set: {
                    model.setPlayers($0)
                },
                suggestions: model.playerOptions, maxLength: Vocabulary.Limits.Recording.players)
            placeRow
            if model.canClearPlace {
                Button(EditRecordingText.clearPlace) { model.clearPlace() }
            }
        }
    }

    /// The place's name, pushing the place search where there is one.
    @ViewBuilder private var placeRow: some View {
        let shown = LabeledContent(EditRecordingText.place) {
            if let name = model.place?.name {
                Text(name)
                    .contentMask()
            }
        }
        if let placeSearch {
            NavigationLink {
                PlaceSearchView(
                    search: { placeSearch.init() }, recent: model.recentPlaces, current: model.place,
                    onPick: model.setPlace, onClear: model.clearPlace)
            } label: {
                shown
            }
        } else {
            shown
        }
    }

    private var notesSection: some View {
        let notes = Binding {
            model.notes
        } set: {
            model.setNotes($0)
        }
        return Section {
            TextField(
                EditRecordingText.notes, text: notes, prompt: Text(EditRecordingText.notesPlaceholder), axis: .vertical
            )
            .contentMask()
            .characterLimit(Vocabulary.Limits.Recording.notes, text: notes)
            .lineLimit(3...)
        } header: {
            Text(EditRecordingText.notes)
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
