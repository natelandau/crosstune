import CrosstuneAnalytics
import CrosstuneDesign
import CrosstuneRecording
import CrosstuneStore
import SwiftUI

/// The words the location editor shows.
public enum PlaceSearchText {
    public static let findAPlace = "Find a place or address"
    public static let useCurrentLocation = "Use current location"
    public static let dropAPin = "Can’t find it? Drop a pin on the map"
    public static let current = "Current"
    public static let nearby = "Nearby"
    public static let saved = "Saved locations"
    public static let nameThisLocation = "Name this location…"
    public static let renameThisLocation = "Rename this location"
    public static let openInMaps = "Open in Maps"
    public static let recent = "Recent locations"
    public static let pickFailed = "Couldn’t find that location. Try another."
    public static let noCurrentLocation = "Couldn’t find your location."
    public static let clearPlace = "Clear location"

    /// A location row's accessible name, `Use <name>, <detail>`, the action first as the web's
    /// `pickLocationName` says it.
    public static func pick(_ name: String, detail: String?) -> String {
        guard let detail, !detail.isEmpty else { return "Use \(name)" }
        return "Use \(name), \(detail)"
    }
}

/// The Location row's editor, a sheet on every platform: a search for a new place first, then
/// Use current location, a map of the place, the place with its actions, and the places nearby,
/// saved, and recent. Picks stay staged while it shows. Every dismissal writes the staged place
/// but Escape and Cancel, which write nothing.
struct LocationEditor: View {
    #if os(macOS)
        static let macSize = MacSheetSize(minHeight: 600, idealHeight: 690)
    #endif

    let recordingID: String
    /// Takes why the write failed, once the editor has gone.
    let onFailure: @MainActor (String) -> Void

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(\.placeSearch) private var placeSearch
    @Environment(\.nearbySearch) private var nearbySearch
    @Environment(\.locationAccess) private var locationAccess
    @Environment(\.locationProvider) private var locationProvider
    @Environment(\.dismiss) private var dismiss
    @State private var model: LocationEditorModel?

    var body: some View {
        Group {
            if let model {
                LocationEditorPage(model: model, onCancel: cancel, onDone: { dismiss() })
            } else {
                // Loading is silence.
                Color.clear
            }
        }
        #if os(macOS)
            .macSheetFrame(Self.macSize)
        #endif
        .shellSheet()
        .onKeyPress(.escape, phases: .down) { _ in
            cancel()
            return .handled
        }
        .task { await open() }
        .onDisappear(perform: leave)
    }

    private func open() async {
        guard model == nil, let store else { return }
        guard let placeSearch else {
            // Every app shell sets the place search, so the editor never opens without one;
            // should it, it closes rather than stand blank with no way out.
            assertionFailure("The location editor opened with no place search")
            dismiss()
            return
        }
        guard
            let opened = await LocationEditorModel.open(
                recordingID: recordingID, store: store, placeSearch: placeSearch, nearbySearch: nearbySearch,
                locationAccess: locationAccess, device: locationProvider, analytics: analytics)
        else {
            dismiss()
            return
        }
        model = opened
        await opened.start()
    }

    private func cancel() {
        model?.discard()
        dismiss()
    }

    private func leave() {
        guard let model else { return }
        let onFailure = onFailure
        Task {
            if let failure = await model.leave() { onFailure(failure) }
        }
    }
}

/// The location editor's content over its model.
private struct LocationEditorPage: View {
    let model: LocationEditorModel
    let onCancel: @MainActor () -> Void
    let onDone: () -> Void

    /// Taller than the recording page's map, since the editor is about the place.
    private static let mapHeight: CGFloat = 240

    @State private var naming = false
    @State private var renaming = false
    /// Set while the pin map shows in place of the editor.
    @State private var droppingPin = false
    /// Where the pin map opens, taken as it is asked for, since a pin ends the search it was
    /// taken from.
    @State private var pinStart: Coordinate?
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            #if os(macOS)
                if droppingPin { pinMap } else { page }
            #else
                page
            #endif
        }
        .sheet(isPresented: $naming) {
            NameLocationSheet(
                candidates: model.namingCandidates, onPick: { _ = model.pickCandidate($0) },
                onName: { _ = model.name($0) })
        }
        .sheet(isPresented: $renaming) {
            RenameLocationSheet(
                current: model.edit.linkedPlace?.name ?? "", onRename: { await model.renameLinked($0) })
        }
        .task(id: model.query) { await model.refresh() }
        .onAppear {
            // With no place to show, the search is the editor's first thing.
            if !model.edit.canClearPlace { focused = true }
        }
    }

    private var isBusy: Bool { model.picking != nil || model.isLocating }

    #if os(macOS)
        /// Escape empties a search that holds text before it cancels the editor.
        private func escape() {
            @Bindable var model = model
            FilterSearchField.escape(clearing: $model.query) { onCancel() }
        }
    #endif

    private var searchField: some View {
        @Bindable var model = model
        #if os(macOS)
            return FilterSearchField(
                prompt: PlaceSearchText.findAPlace, query: $model.query, isFocused: $focused)
        #else
            return TextField(
                PlaceSearchText.findAPlace, text: $model.query, prompt: Text(PlaceSearchText.findAPlace)
            )
            .contentMask()
            .autocorrectionDisabled()
            .focused($focused)
        #endif
    }

    private var currentLocationRow: some View {
        Button {
            model.startUsingCurrentLocation()
        } label: {
            HStack(spacing: 8) {
                Label(PlaceSearchText.useCurrentLocation, systemImage: "location")
                Spacer(minLength: 0)
                if model.isLocating {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.formPickRow)
        .disabled(model.isCurrentLocationOff || isBusy)
    }

    private var listPicker: some View {
        @Bindable var model = model
        return PaneTabs(
            selection: $model.list,
            tabs: LocationList.allCases.map { PaneTab($0, title: $0.title, systemImage: $0.systemImage) },
            title: RecordingPageCopy.location)
    }

    @ViewBuilder private var listRows: some View {
        switch model.list {
        case .nearby: ForEach(model.nearby, id: \.self, content: nearbyButton)
        case .saved: ForEach(model.edit.savedPlaces, id: \.id) { savedButton($0, distance: nil) }
        case .recent: ForEach(model.edit.recentPlaces, id: \.self, content: recentButton)
        }
    }

    /// A row that stages a location, with a mark when it is the recording's now.
    private func locationButton(
        name: String, address: String?, distance: String? = nil, isCurrent: Bool, pick: @escaping () -> Bool
    ) -> some View {
        Button {
            _ = pick()
        } label: {
            LocationRow(name: name, address: address, distance: distance, isCurrent: isCurrent)
        }
        .buttonStyle(.formPickRow)
        #if !os(macOS)
            // The row's name keeps its text color rather than the form's accent.
            .foregroundStyle(.textPrimary)
        #endif
        .disabled(isBusy)
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }

    private func nearbyButton(_ entry: NearbyEntry) -> some View {
        let isCurrent = if case .saved(let place) = entry.row { model.isLinked(place) } else { false }
        return locationButton(
            name: entry.row.name, address: entry.row.address, distance: entry.distance, isCurrent: isCurrent
        ) {
            model.pickNearby(entry.row)
        }
    }

    private func savedButton(_ place: SavedPlace, distance: String?) -> some View {
        locationButton(
            name: place.name, address: place.address, distance: distance, isCurrent: model.isLinked(place)
        ) {
            model.pickSaved(place)
        }
    }

    private func recentButton(_ place: RecordingPlace) -> some View {
        locationButton(name: place.name, address: nil, isCurrent: model.isCurrent(place)) {
            model.pickRecent(place)
        }
    }

    private func resultButton(_ completion: PlaceCompletion) -> some View {
        let distance = model.distance(to: model.point(of: completion))
        return Button {
            model.startPick(completion)
        } label: {
            HStack(spacing: 8) {
                #if os(macOS)
                    MacPickGlyph(kind: .none)
                #endif
                VStack(alignment: .leading, spacing: LocationRow.lineSpacing) {
                    Text(completion.title)
                        .contentMask()
                    if !completion.subtitle.isEmpty {
                        Text(completion.subtitle)
                            .contentMask()
                            .font(.platform(.body, mac: .secondary))
                            .foregroundStyle(.textSecondary)
                    }
                }
                #if os(macOS)
                    .padding(.vertical, 4)
                #endif
                Spacer(minLength: 0)
                if model.picking == completion {
                    ProgressView()
                        .controlSize(.small)
                } else if let distance {
                    Text(distance)
                        .contentMask()
                        .font(.platform(.body, mac: .secondary))
                        .foregroundStyle(.textSecondary)
                        .monospacedDigit()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(PlaceSearchText.pick(completion.title, detail: completion.subtitle))
            .accessibilityValue(distance ?? "")
        }
        .buttonStyle(.formPickRow)
        #if !os(macOS)
            .foregroundStyle(.textPrimary)
        #endif
        .disabled(isBusy)
    }

    private var pinMap: some View {
        DropPinView(
            start: pinStart,
            onUse: { pin in
                if model.usePin(pin) { droppingPin = false }
            },
            onBack: { droppingPin = false }, onCancel: onCancel)
    }

    private var dropPinButton: some View {
        Button {
            pinStart = model.pinStart
            droppingPin = true
        } label: {
            Label(PlaceSearchText.dropAPin, systemImage: "pin")
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.formPickRow)
        .disabled(isBusy)
    }

    /// The search's matching saved locations, each with how far it lies.
    private func savedMatchButton(_ place: SavedPlace) -> some View {
        savedButton(place, distance: model.distance(to: place.point))
    }

    /// The place now: its name, and the address under it when there is one.
    @ViewBuilder private var currentPlace: some View {
        if let current = model.edit.place {
            VStack(alignment: .leading, spacing: LocationRow.lineSpacing) {
                Text(current.name)
                    .contentMask()
                    #if os(macOS)
                        .font(MacStyle.body)
                        .foregroundStyle(Palette.textPrimary)
                    #endif
                if let address = model.edit.placeAddress {
                    Text(address)
                        .contentMask()
                        #if os(macOS)
                            .font(MacStyle.secondary)
                            .foregroundStyle(Palette.textSecondary)
                        #else
                            .foregroundStyle(.textSecondary)
                        #endif
                }
            }
            #if os(macOS)
                .lineLimit(1)
                .padding(.vertical, 4)
            #endif
        }
    }

    private var nameLocationButton: some View {
        Button(PlaceSearchText.nameThisLocation) { naming = true }
            .disabled(isBusy)
    }

    private var renameLocationButton: some View {
        Button(PlaceSearchText.renameThisLocation) { renaming = true }
            .disabled(isBusy)
    }

    private var openInMapsButton: some View {
        Button(PlaceSearchText.openInMaps) { model.openInMaps() }
    }

    private var clearPlaceButton: some View {
        Button(PlaceSearchText.clearPlace, role: .destructive) { _ = model.clear() }
            .disabled(isBusy)
    }

    #if os(macOS)
        /// Drawn on a sheet's scaffold, with Cancel in the cancel slot so Escape discards. Done is
        /// not the default, so Return in the search never closes the editor.
        private var page: some View {
            MacSheet(
                title: RecordingPageCopy.location, size: LocationEditor.macSize,
                cancel: .cancel(TuneFormSheet.cancel) { onCancel() },
                primary: .init(AttributeCopy.done, isDefault: false) { onDone() },
                escape: escape,
                // With no place to show, the search is the editor's first thing.
                openingFocus: model.edit.canClearPlace ? .anchor : .firstField
            ) {
                MacFormScroll {
                    VStack(alignment: .leading, spacing: 6) {
                        searchField
                        if let failure = model.failure { FailureText(failure) }
                    }
                    if model.showsResults {
                        macResults
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            currentLocationRow
                            MacLocationAccessNote()
                        }
                        if let coordinate = model.edit.placeCoordinate {
                            LocationMap(coordinate: coordinate, accuracyM: coordinate.accuracyM, height: Self.mapHeight)
                                .clipShape(.rect(cornerRadius: MacForm.cardRadius))
                        }
                        if model.edit.canClearPlace {
                            macCurrentSection
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            listPicker
                            VStack(alignment: .leading, spacing: 2) {
                                listRows
                            }
                        }
                    }
                }
            }
        }

        private var macResults: some View {
            let completions = model.completions
            let savedMatches = model.savedMatches
            return VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                if !completions.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(completions, id: \.self, content: resultButton)
                    }
                }
                if !savedMatches.isEmpty {
                    MacFormSection(PlaceSearchText.saved, card: false) {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(savedMatches, id: \.id, content: savedMatchButton)
                        }
                    }
                }
                dropPinButton
            }
        }

        /// The place now, then its actions on a row of their own.
        private var macCurrentSection: some View {
            MacFormSection(PlaceSearchText.current) {
                currentPlace
                HStack(spacing: 8) {
                    if model.edit.canRenamePlace {
                        renameLocationButton
                            .buttonStyle(.mac(.secondary, size: .small))
                    } else if model.edit.canNamePlace {
                        nameLocationButton
                            .buttonStyle(.mac(.secondary, size: .small))
                    }
                    if model.edit.mapsPoint != nil {
                        openInMapsButton
                            .buttonStyle(.mac(.secondary, size: .small))
                    }
                    Spacer(minLength: 8)
                    clearPlaceButton
                        .buttonStyle(.mac(.plain, size: .small))
                }
            }
        }
    #else
        private var page: some View {
            NavigationStack {
                GroupedForm {
                    Section {
                        searchField
                    } footer: {
                        if let failure = model.failure {
                            Text(failure)
                                .foregroundStyle(Palette.danger)
                        }
                    }
                    if model.showsResults {
                        results
                    } else {
                        Section {
                            currentLocationRow
                        }
                        LocationAccessSection()
                        if let coordinate = model.edit.placeCoordinate {
                            Section {
                                LocationMap(
                                    coordinate: coordinate, accuracyM: coordinate.accuracyM, height: Self.mapHeight
                                )
                                .listRowInsets(EdgeInsets())
                            }
                        }
                        if model.edit.canClearPlace {
                            currentSection
                        }
                        Section {
                            listRows
                        } header: {
                            listPicker
                                .textCase(nil)
                                .padding(.bottom, 4)
                        }
                    }
                }
                .navigationTitle(RecordingPageCopy.location)
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(isPresented: $droppingPin) { pinMap }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(TuneFormSheet.cancel, action: onCancel)
                    }
                    ConfirmToolbarItem {
                        Button(AttributeCopy.done, action: onDone)
                    }
                }
            }
        }

        @ViewBuilder private var results: some View {
            let completions = model.completions
            let savedMatches = model.savedMatches
            if !completions.isEmpty {
                Section {
                    ForEach(completions, id: \.self, content: resultButton)
                }
            }
            if !savedMatches.isEmpty {
                Section(PlaceSearchText.saved) {
                    ForEach(savedMatches, id: \.id, content: savedMatchButton)
                }
            }
            Section {
                dropPinButton
            }
        }

        private var currentSection: some View {
            Section(PlaceSearchText.current) {
                currentPlace
                if model.edit.canRenamePlace {
                    renameLocationButton
                } else if model.edit.canNamePlace {
                    nameLocationButton
                }
                if model.edit.mapsPoint != nil { openInMapsButton }
                clearPlaceButton
            }
        }
    #endif
}

/// A location to pick: its name, the address under it when there is one, how far it lies when
/// known, and a mark when it is the recording's now. On the Mac the mark leads in a picker's glyph
/// slot; on iPhone and iPad a checkmark trails.
struct LocationRow: View {
    let name: String
    let address: String?
    var distance: String?
    let isCurrent: Bool

    /// The gap between a name and its address: tight on the Mac's small type, the stack's own on
    /// iPhone and iPad.
    static var lineSpacing: CGFloat? {
        #if os(macOS)
            1
        #else
            nil
        #endif
    }

    var body: some View {
        HStack(spacing: 8) {
            #if os(macOS)
                MacPickGlyph(kind: isCurrent ? .done : .none)
            #endif
            VStack(alignment: .leading, spacing: Self.lineSpacing) {
                Text(name)
                    .contentMask()
                if let address {
                    Text(address)
                        .contentMask()
                        .font(.platform(.body, mac: .secondary))
                        .foregroundStyle(.textSecondary)
                }
            }
            #if os(macOS)
                .lineLimit(1)
                .padding(.vertical, address == nil ? 0 : 4)
            #endif
            Spacer(minLength: 0)
            if let distance {
                Text(distance)
                    .contentMask()
                    .font(.platform(.body, mac: .secondary))
                    .foregroundStyle(.textSecondary)
                    .monospacedDigit()
            }
            SelectionMark(.single(isChosen: isCurrent))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(PlaceSearchText.pick(name, detail: address))
        .accessibilityValue(distance ?? "")
    }
}
