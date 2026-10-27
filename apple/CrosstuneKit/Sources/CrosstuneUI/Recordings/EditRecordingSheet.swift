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
    public static let place = "Location"
    public static let clearPlace = "Clear location"
    /// The Mac's heading over players and location, and the location row's value with none set.
    public static let details = "Details"
    public static let noPlace = "None"

    /// `Recorded at <time>`: the exact time of a recording, which its date parts cannot show.
    public static func recordedAtNote(
        _ at: Timestamp, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> String {
        "Recorded at \(at.date.formatted(Date.FormatStyle(time: .shortened, locale: locale, timeZone: timeZone)))"
    }
}

/// A location picked on the location page, held until Save.
enum StagedPlace: Sendable {
    /// No location, coordinates and all.
    case cleared
    /// A place used before, or one set by hand, linked to no saved location.
    case place(RecordingPlace)
    /// A search result, with the saved location it makes when it is a venue or a street address.
    case search(RecordingPlace, saving: SavedPlaceDraft?)
    /// A saved location that exists already, linked over the place picked before it, whose point
    /// the recording moves to, or over the recording's own point when `over` is nil. `saving` is the search
    /// result's own saved location, made should the linked one go.
    case link(SavedPlace, over: RecordingPlace?, saving: SavedPlaceDraft? = nil)
    /// A saved location made on Save and then linked, with how it came to be, over the place
    /// picked before it as for ``link(_:over:)``.
    case create(SavedPlaceDraft, made: SavedLocationMethod, over: RecordingPlace?)

    /// The place picked here whose point the recording moves to, nil when it keeps its own.
    var pending: RecordingPlace? {
        switch self {
        case .place(let place), .search(let place, _): place
        case .link(_, let over, _), .create(_, _, let over): over
        case .cleared: nil
        }
    }

    /// How the saved location this pick makes came to be, nil when it makes none.
    var made: SavedLocationMethod? {
        switch self {
        case .search(_, let saving): saving == nil ? nil : .search
        case .create(_, let made, _): made
        case .cleared, .place, .link: nil
        }
    }
}

/// The Edit sheet's state: the typed name, the date recorded, the notes, players, and location,
/// and the one save they make. A blank name clears the recording's own name, so it goes back to
/// being named for its tune or its date. The date is written only when its parts changed, and the
/// location only when it changed, so a location left alone keeps its captured accuracy. A
/// location picked here, and any saved location the pick makes, is written only on Save.
@MainActor
@Observable
public final class EditRecordingModel {
    public let recordingID: String
    public private(set) var name: String
    public private(set) var date: RecordingDateDraft
    public private(set) var notes: String
    public private(set) var players: String
    /// The location picked or cleared here, nil while the recording's own is kept.
    private var stagedPick: StagedPlace?
    /// How the location was picked, nil until one is or once it is cleared.
    public private(set) var placeMethod: PlaceMethod?
    /// The recording as stored, followed so a name or a link that syncs in while the sheet is
    /// open shows.
    private let stored: LiveQuery<Recording?>
    /// The live saved locations, followed so a rename on another device shows; nil until read.
    private let saved: LiveQuery<[SavedPlace]?>
    /// The players on the musician's recordings, to suggest; empty until ``load()``.
    public private(set) var playerOptions: [String] = []
    /// The places on the musician's recordings, this one's included, most recent first; empty
    /// until ``load()``.
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

    /// `timeZone` reads a recording's day; `now` decides which dates are still to come.
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
        let id = recording.id
        stored = LiveQuery(store, initial: recording) { db in try Recording.fetchOne(db, key: id) }
        saved = LiveQuery(store, initial: nil) { db in try SavedPlace.fetchAll(db).filter { $0.deletedAt == nil } }
    }

    /// The recording as it is in the store, or as opened once it is gone.
    private var current: Recording { stored.value ?? recording }

    private var savedByID: [String: SavedPlace] {
        Dictionary((saved.value ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }

    /// The live saved locations, by name.
    public var savedPlaces: [SavedPlace] {
        (saved.value ?? []).sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /// The pick held for Save. A link to a saved location deleted meanwhile falls back to the
    /// place it was picked over, with the location that search pick makes, or to no pick, so the
    /// recording's own location shows and saves.
    private var staged: StagedPlace? {
        if fellBack, case .link(_, let over, let saving) = stagedPick {
            return over.map { .search($0, saving: saving) }
        }
        return stagedPick
    }

    /// Whether the staged link names a saved location deleted meanwhile.
    private var fellBack: Bool {
        guard case .link(let place, _, _) = stagedPick, let live = saved.value else { return false }
        return !live.contains(where: { $0.id == place.id })
    }

    /// Where the recording will be once saved, with the fix's accuracy: the point picked here, else its
    /// own.
    private var recordingPoint: Coordinate? {
        if let pending = staged?.pending { return pending.coordinate }
        guard let lat = current.placeLat, let lon = current.placeLon else { return nil }
        return Coordinate(lat: lat, lon: lon, accuracyM: current.placeAccuracyM)
    }

    /// The saved location the recording is linked to, as stored or as picked here, read live.
    public var linkedPlace: SavedPlace? {
        switch staged {
        case nil: current.placeID.flatMap { savedByID[$0] }
        case .link(let place, _, _): savedByID[place.id] ?? place
        case .cleared, .place, .search, .create: nil
        }
    }

    /// The location to show and save: its name and the point it marks. A linked recording
    /// shows its saved location's name, read once the saved locations are, so its own name never
    /// flashes first.
    public var place: RecordingPlace? {
        switch staged {
        case nil:
            guard let point = recordingPoint, current.placeID == nil || saved.value != nil,
                let name = shownPlaceName(current, places: savedByID)
            else { return nil }
            return RecordingPlace(name: name, coordinate: point)
        case .cleared:
            return nil
        case .place(let place), .search(let place, _):
            return place
        case .link(let place, _, _):
            let live = linkedPlace ?? place
            return RecordingPlace(
                name: live.name, coordinate: recordingPoint ?? Coordinate(lat: live.lat, lon: live.lon))
        case .create(let draft, _, _):
            return RecordingPlace(
                name: draft.name, coordinate: recordingPoint ?? Coordinate(lat: draft.lat, lon: draft.lon))
        }
    }

    /// The line under the location's name: a saved location's address, when it says more than
    /// the name does.
    public var placeAddress: String? {
        let address: String? =
            switch staged {
            case nil, .link: linkedPlace?.address
            case .create(let draft, _, _): draft.address
            case .cleared, .place, .search: nil
            }
        return address == place?.name ? nil : address
    }

    /// The point the map shows, with the recording's accuracy, named or not. Nil with no location.
    public var placeCoordinate: Coordinate? {
        switch staged {
        case nil: recordingPoint
        case .cleared: nil
        case .place(let place), .search(let place, _): place.coordinate
        case .link(let place, _, _): recordingPoint ?? Coordinate(lat: place.lat, lon: place.lon)
        case .create(let draft, _, _): recordingPoint ?? Coordinate(lat: draft.lat, lon: draft.lon)
        }
    }

    /// Where Open in Maps goes: the saved location's own point when the recording is linked to
    /// one, else the recording's.
    public var mapsPoint: Coordinate? {
        if let linked = linkedPlace { return Coordinate(lat: linked.lat, lon: linked.lon) }
        if case .create(let draft, _, _) = staged { return Coordinate(lat: draft.lat, lon: draft.lon) }
        return placeCoordinate.map { Coordinate(lat: $0.lat, lon: $0.lon) }
    }

    /// Whether Clear has a location to clear: a named one, or coordinates with no name yet.
    public var canClearPlace: Bool { placeCoordinate != nil }

    /// Whether the point is precise enough to save under a typed name, so a vague fix never
    /// becomes a saved location that pulls in its neighbors.
    public var canNamePlace: Bool { placeCoordinate.map { PlaceDistances.isPrecise(accuracyM: $0.accuracyM) } ?? false }

    /// Reads the suggestions from the store. A failed read leaves them empty.
    public func load() async {
        let read = try? await store.read { db in (try Recording.fetchAll(db), try SavedPlace.fetchAll(db)) }
        guard let (recordings, places) = read else { return }
        playerOptions = RecordingSuggestions.players(recordings)
        let byID = Dictionary(places.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        recentPlaces = RecordingSuggestions.recentPlaces(recordings, saved: byID)
    }

    /// Whether the sheet holds an edit a dismissal would lose.
    public var isEdited: Bool {
        name != openedName || date.isChanged || notes != openedNotes || players != openedPlayers || isPlaceChanged
    }

    private var isPlaceChanged: Bool {
        guard let staged else { return false }
        let stored = current
        switch staged {
        case .cleared:
            return stored.placeLat != nil || stored.placeLon != nil || stored.placeName != nil
        case .place(let place):
            return stored.placeID != nil
                || stored.place.map(RecordingSuggestions.picked) != RecordingSuggestions.picked(place)
        case .link(let place, let over, _):
            return over != nil || stored.placeID != place.id
        case .search, .create:
            return true
        }
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

    /// Sets a place used before, or one given by hand, and how it was picked.
    public func setPlace(_ place: RecordingPlace, method: PlaceMethod) {
        stage(.place(place), method: method)
    }

    /// Sets a search result, which saves its venue or street address as a location on Save. A
    /// location saved already is linked rather than saved twice.
    public func pickSearch(_ picked: PickedPlace) {
        if let saving = picked.saving, let existing = SavedPlace.existing(for: saving, in: saved.value ?? []) {
            stage(.link(existing, over: picked.place, saving: saving), method: .search)
        } else {
            stage(.search(picked.place, saving: picked.saving), method: .search)
        }
    }

    /// Links a place near the recording. A venue not yet saved is saved at its own point on Save, and
    /// the recording keeps its own coordinates.
    func pickNearby(_ row: NearbyRow) {
        switch row {
        case .saved(let place): stage(.link(place, over: staged?.pending), method: .nearby)
        case .venue(let venue): stage(.create(venue.draft, made: .nearby, over: staged?.pending), method: .nearby)
        }
    }

    /// Links a saved location. From the saved list the recording keeps its own coordinates; while
    /// naming, it moves to the point picked here, as the name would.
    public func pickSaved(_ place: SavedPlace, whileNaming: Bool = false) {
        stage(.link(place, over: whileNaming ? staged?.pending : nil), method: .saved)
    }

    /// Saves `name` as a new location at the recording's own point on Save, with the recording's own street
    /// address under it, and links this recording alone. A name that trims to nothing does nothing.
    public func nameLocation(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let point = placeCoordinate else { return }
        let street = streetLine
        let draft = SavedPlaceDraft(
            name: trimmed, address: street == trimmed ? nil : street, lat: point.lat, lon: point.lon,
            applePlaceID: nil)
        stage(.create(draft, made: .custom, over: staged?.pending), method: .saved)
    }

    /// The street address line of where the recording will be, nil when it is not known: a name the
    /// server gave the recording's own fix, or the address of the saved location or search result
    /// picked. A name picked by hand, such as `Venue, street, town`, is not one.
    private var streetLine: String? {
        switch staged {
        case nil:
            let origin = current.placeOrigin.flatMap(PlaceOrigin.init(rawValue:))
            if origin == .device || origin == .file, let own = current.placeName { return own }
            return linkedPlace?.address
        case .search(let place, let saving):
            // A street address result saves under its own address line, with no address under it.
            return saving.flatMap { $0.address ?? ($0.name == place.name ? $0.name : nil) }
        case .link(let place, _, _):
            return (linkedPlace ?? place).address
        case .create(let draft, _, _):
            return draft.address
        case .cleared, .place:
            return nil
        }
    }

    public func clearPlace() {
        stagedPick = .cleared
        placeMethod = nil
        failure = nil
    }

    private func stage(_ place: StagedPlace, method: PlaceMethod) {
        stagedPick = place
        placeMethod = method
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

    /// Saves the trimmed name, and the notes, players, date, and location when they changed, in
    /// one write, with any saved location the picked location makes. Blank notes or players clear
    /// them. A field left alone is not written, so an edit synced while the sheet is open
    /// survives. True once the save lands; a date that cannot be stored writes nothing.
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
        let staged = isPlaceChanged ? staged : nil
        // A link fallen back writes the search pick under it, so the event names that.
        let method: PlaceMethod? = fellBack && staged != nil ? .search : placeMethod
        let replaced = current.place != nil || current.placeID != nil
        let handPlace: Patch<RecordingPlace?> =
            switch staged {
            case .cleared: .value(nil)
            case .place(let place): .value(RecordingSuggestions.picked(place))
            case nil, .search, .link, .create: .keep
            }
        do {
            let created = try await store.write { writer in
                try writer.updateRecording(
                    recordingID, label: .value(trimmed.isEmpty ? nil : trimmed), notes: notes,
                    players: players, place: handPlace, at: time)
                if let written {
                    try writer.updateRecordingDate(
                        recordingID, recordedAt: written.at, precision: written.precision, at: time)
                }
                return try Self.link(recordingID, to: staged, method: method, in: writer, at: time)
            }
            isSaved = true
            if trimmed != openedName { analytics.recordingRenamed(recording) }
            if let staged {
                if case .cleared = staged {
                    analytics.recordingPlaceCleared(recording)
                } else if let method {
                    analytics.recordingPlaceSet(recording, method: method, replaced: replaced)
                }
                if created, let made = staged.made { analytics.savedLocationCreated(made) }
            }
            return true
        } catch {
            Self.logger.warning("A recording edit failed: \(error)")
            failure = failureMessage(error)
            return false
        }
    }

    /// Writes a pick that links a saved location, making the location first when the pick does.
    /// True when it made one. A location saved already, by ``SavedPlace/existing(for:in:)``, is
    /// linked rather than saved twice, checked here since the saved locations may have changed, or
    /// not been read, since the pick.
    nonisolated private static func link(
        _ recordingID: String, to staged: StagedPlace?, method: PlaceMethod?, in writer: StoreWriter,
        at time: Timestamp
    ) throws -> Bool {
        func linked(_ place: SavedPlace, over: RecordingPlace?) -> PlacePick {
            // A link over a place picked here moves the recording to that place's point, as a search
            // pick does; otherwise the recording keeps its own.
            if let over { return .search(RecordingSuggestions.picked(over), savedPlaceID: place.id) }
            return method == .nearby ? .nearby(place) : .saved(place)
        }
        func create(_ draft: SavedPlaceDraft) throws -> SavedPlace {
            try writer.createSavedPlace(
                name: draft.name, lat: draft.lat, lon: draft.lon, address: draft.address,
                applePlaceID: draft.applePlaceID, at: time)
        }
        func savedAlready(_ draft: SavedPlaceDraft) throws -> SavedPlace? {
            SavedPlace.existing(for: draft, in: try SavedPlace.fetchAll(writer.db))
        }
        switch staged {
        case .search(let place, let saving):
            let existing = try saving.flatMap(savedAlready)
            let made = existing == nil ? try saving.map(create) : nil
            try writer.setRecordingPlace(
                recordingID, pick: .search(RecordingSuggestions.picked(place), savedPlaceID: (existing ?? made)?.id),
                at: time)
            return made != nil
        case .link(let place, let over, _):
            try writer.setRecordingPlace(recordingID, pick: linked(place, over: over), at: time)
            return false
        case .create(let draft, _, let over):
            let saved = try savedAlready(draft)
            try writer.setRecordingPlace(recordingID, pick: linked(try saved ?? create(draft), over: over), at: time)
            return saved == nil
        case nil, .cleared, .place:
            return false
        }
    }

    private static func blankToNil(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// A page the edit sheet can open on, instead of its form.
public enum EditRecordingPage: Hashable, Sendable {
    case location
}

/// A recording's name, the date it was recorded, its players, its place, and its notes, over
/// whatever screen asked. Reads the store from the environment.
public struct EditRecordingSheet: View {
    private let view: RecordingView
    /// The page pushed once the sheet has loaded, nil to open on the form.
    let initialPage: EditRecordingPage?

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @State private var model: EditRecordingModel?
    @State private var path: [EditRecordingPage] = []
    #if DEBUG
        @Environment(\.sampleScreen) private var sampleScreen
    #endif

    public init(view: RecordingView, initialPage: EditRecordingPage? = nil) {
        self.view = view
        self.initialPage = initialPage
    }

    private var openingPage: EditRecordingPage? {
        #if DEBUG
            if initialPage == nil, sampleScreen == .editLocation { return .location }
        #endif
        return initialPage
    }

    #if os(macOS)
        /// Fixed, so pushing the location page keeps the sheet's size.
        static let macSize = MacSheetSize(minHeight: 600, idealHeight: 690)
    #endif

    public var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let model {
                    EditRecordingForm(model: model)
                } else {
                    Color.clear
                }
            }
            #if os(iOS)
                .navigationTitle(EditRecordingText.title)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        #if os(iOS)
            // Full height at once, so Date recorded stays above the keyboard.
            .presentationDetents([.large])
            .shellSheet()
        #else
            .macSheetFrame(Self.macSize)
            .shellSheet()
        #endif
        .task {
            guard model == nil, let store else { return }
            let opened = EditRecordingModel(store: store, recording: view.recording, analytics: analytics)
            model = opened
            // Pushed once the form, which owns the page's destination, is on screen.
            if let page = openingPage { path = [page] }
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
    @Environment(\.nearbySearch) private var nearbySearch
    @Environment(\.locale) private var locale
    @Environment(\.analytics) private var analytics
    @FocusState private var focused: Field?
    /// Set once Name takes focus, so coming back from the location page leaves focus alone.
    @State private var focusedName = false

    private static let months = Array(1...12)

    /// A month's name in the form's locale. The draft holds Gregorian month numbers, so the
    /// names come from that calendar whatever calendar the device uses.
    private func monthName(_ month: Int) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        return calendar.standaloneMonthSymbols[month - 1]
    }

    var body: some View {
        #if os(macOS)
            MacSheet(
                title: EditRecordingText.title, size: EditRecordingSheet.macSize,
                cancel: .cancel(TuneFormSheet.cancel, isEnabled: !model.isSaving) { dismiss() },
                primary: .init(ListNameSheet.save, isEnabled: !model.isSaving && !model.isSaved, action: save)
            ) {
                MacFormScroll {
                    macNameSection
                    macDateSection
                    macDetailsSection
                    macNotesSection
                }
            }
            // The location page pushes in its own scaffold, so the stack draws no bar of its own.
            .toolbar(.hidden)
            .navigationDestination(for: EditRecordingPage.self) { _ in
                if let placeSearch {
                    PlaceSearchView(
                        edit: model, search: { placeSearch.init() }, nearby: nearbySearch, analytics: analytics)
                }
            }
            .interactiveDismissDisabled(model.isEdited || model.isSaving)
            .onAppear(perform: focusNameOnce)
        #else
            GroupedForm {
                nameSection
                dateSection
                playersSection
                notesSection
            }
            .navigationDestination(for: EditRecordingPage.self) { _ in
                if let placeSearch {
                    PlaceSearchView(
                        edit: model, search: { placeSearch.init() }, nearby: nearbySearch, analytics: analytics)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(TuneFormSheet.cancel) { dismiss() }
                        .disabled(model.isSaving)
                }
                ConfirmToolbarItem {
                    Button(ListNameSheet.save, action: save)
                        .fontWeight(.semibold)
                        .disabled(model.isSaving || model.isSaved)
                }
            }
            .interactiveDismissDisabled(model.isEdited || model.isSaving)
            .onAppear(perform: focusNameOnce)
        #endif
    }

    private func focusNameOnce() {
        guard !focusedName else { return }
        focusedName = true
        focused = .name
    }

    private var nameBinding: Binding<String> {
        Binding {
            model.name
        } set: {
            model.setName($0)
        }
    }

    private var nameField: some View {
        TextField(EditRecordingText.nameLabel, text: nameBinding, prompt: Text(EditRecordingText.placeholder))
            .contentMask()
            #if os(macOS)
                .labelsHidden()
                .textFieldStyle(.macField)
            #endif
            .characterLimit(Vocabulary.Limits.Recording.label, text: nameBinding)
            .focused($focused, equals: .name)
            .submitLabel(.done)
            .onSubmit(save)
    }

    private var yearField: some View {
        let year = Binding {
            model.date.year
        } set: {
            model.setYear($0)
        }
        return TextField(EditRecordingText.year, text: year, prompt: Text(TuneFieldLabels.notSet))
            .contentMask()
            #if os(macOS)
                .labelsHidden()
                .textFieldStyle(.macField)
            #else
                .multilineTextAlignment(.trailing)
                .keyboardType(.numberPad)
            #endif
            .focused($focused, equals: .year)
            .submitLabel(.done)
            .onSubmit(save)
    }

    private var playersField: some View {
        SuggestionField(
            EditRecordingText.players,
            value: Binding {
                model.players
            } set: {
                model.setPlayers($0)
            },
            suggestions: model.playerOptions, maxLength: Vocabulary.Limits.Recording.players)
    }

    #if os(macOS)
        private var macNameSection: some View {
            MacFormSection(EditRecordingText.nameHeader, card: false) {
                VStack(alignment: .leading, spacing: 6) {
                    nameField
                    if let failure = model.failure { FailureText(failure) }
                }
            }
        }

        private var macDateSection: some View {
            let date = model.date
            return VStack(alignment: .leading, spacing: 6) {
                MacFormSection(
                    EditRecordingText.dateHeader,
                    subtitle: model.dateFailure == nil
                        ? date.keptTime.map { EditRecordingText.recordedAtNote($0) } : nil
                ) {
                    MacFormRow(EditRecordingText.year) {
                        yearField
                            // Four digits, so the year reads as one value with the month and day.
                            .frame(width: Self.yearWidth)
                    }
                    MacPopUp(
                        EditRecordingText.month,
                        selection: Binding {
                            date.month
                        } set: {
                            model.setMonth($0)
                        },
                        options: [nil] + Self.months.map(Optional.some),
                        label: { $0.map(monthName) ?? EditRecordingText.any }
                    )
                    .disabled(!date.isMonthEnabled)
                    MacPopUp(
                        EditRecordingText.day,
                        selection: Binding {
                            date.day
                        } set: {
                            model.setDay($0)
                        },
                        options: [nil] + Array(stride(from: 1, through: date.dayCount, by: 1)).map(Optional.some),
                        label: { $0.map(String.init) ?? EditRecordingText.any }
                    )
                    .disabled(!date.isDayEnabled)
                } accessory: {
                    Button(EditRecordingText.clearDate) { model.clearDate() }
                        .buttonStyle(.mac(.plain, size: .small))
                        .disabled(date.isEmpty)
                }
                if let dateFailure = model.dateFailure {
                    FailureText(dateFailure)
                        .padding(.horizontal, MacForm.rowInset)
                }
            }
        }

        static let yearWidth: CGFloat = 80

        private var macDetailsSection: some View {
            MacFormSection(EditRecordingText.details) {
                playersField
                placeRow
            }
        }

        private var macNotesSection: some View {
            let notes = Binding {
                model.notes
            } set: {
                model.setNotes($0)
            }
            return MacFormSection(EditRecordingText.notes, card: false) {
                MacTextArea(
                    EditRecordingText.notes, text: notes, placeholder: EditRecordingText.notesPlaceholder, minLines: 3,
                    maxLines: 8
                )
                .characterLimit(Vocabulary.Limits.Recording.notes, text: notes)
            }
        }
    #endif

    #if os(iOS)
        private var nameSection: some View {
            Section {
                nameField
            } header: {
                Text(EditRecordingText.nameHeader)
            } footer: {
                if let failure = model.failure {
                    Text(failure)
                        .foregroundStyle(Palette.danger)
                }
            }
        }

        private var dateSection: some View {
            let date = model.date
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
                LabeledContent(EditRecordingText.year) { yearField }
                Picker(EditRecordingText.month, selection: month) {
                    Text(EditRecordingText.any).tag(Int?.none)
                    ForEach(Self.months, id: \.self) { choice in
                        Text(monthName(choice)).tag(Int?.some(choice))
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
                        .foregroundStyle(Palette.danger)
                } else if let time = date.keptTime {
                    Text(EditRecordingText.recordedAtNote(time))
                }
            }
        }

        private var playersSection: some View {
            Section {
                playersField
                placeRow
                if model.canClearPlace {
                    Button(EditRecordingText.clearPlace) { model.clearPlace() }
                }
            }
        }
    #endif

    /// The location's name, pushing the location page where there is one. On the Mac the row
    /// says None with no location, and Clear sits on it.
    @ViewBuilder private var placeRow: some View {
        #if os(macOS)
            let shown = LabeledContent(EditRecordingText.place) {
                HStack(spacing: 8) {
                    Text(model.place?.name ?? EditRecordingText.noPlace)
                        .contentMask()
                        .foregroundStyle(model.place == nil ? Palette.textSecondary : Palette.textPrimary)
                        .lineLimit(1)
                    if placeSearch != nil {
                        Image(systemName: "chevron.right")
                            .font(MacStyle.rowChevron)
                            .foregroundStyle(Palette.textSecondary)
                            .accessibilityHidden(true)
                    }
                }
                // A field's inset, so the place starts where the fields' text does.
                .padding(.leading, MacFieldStyle.horizontalInset)
            }
        #else
            let shown = LabeledContent(EditRecordingText.place) {
                Text(model.place?.name ?? TuneFieldLabels.notSet)
                    .contentMask()
            }
        #endif
        if placeSearch != nil {
            NavigationLink(value: EditRecordingPage.location) {
                shown
                    #if os(macOS)
                        .contentShape(.rect)
                    #endif
            }
            #if os(macOS)
                .buttonStyle(.plain)
            #endif
        } else {
            shown
        }
        #if os(macOS)
            if model.canClearPlace {
                Button(EditRecordingText.clearPlace) { model.clearPlace() }
                    .buttonStyle(.mac(.plain, size: .small))
            }
        #endif
    }

    #if os(iOS)
        private var notesSection: some View {
            let notes = Binding {
                model.notes
            } set: {
                model.setNotes($0)
            }
            return Section {
                TextField(
                    EditRecordingText.notes, text: notes, prompt: Text(EditRecordingText.notesPlaceholder),
                    axis: .vertical
                )
                .contentMask()
                .characterLimit(Vocabulary.Limits.Recording.notes, text: notes)
                .lineLimit(3...)
            } header: {
                Text(EditRecordingText.notes)
            }
        }
    #endif

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
