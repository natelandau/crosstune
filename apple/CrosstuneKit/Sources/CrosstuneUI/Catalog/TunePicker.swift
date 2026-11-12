import CrosstuneDesign
import CrosstuneStore
import Observation
import SwiftUI

/// One row a tune picker shows.
public struct TunePickerRow: Identifiable, Equatable {
    public enum State: Equatable {
        case open
        /// Already where the picker puts tunes: shown, marked, and inert, so the picker never
        /// hides a tune.
        case taken
        /// A single picker's current choice.
        case chosen
    }

    public let entry: CatalogEntry
    public let state: State
    /// What a pick does, said before the row, such as "Add".
    let action: String
    let instruments: Set<String>

    public var id: String { entry.id }
    /// The row's spoken name when it can be picked. Built when read, so a long idle catalog
    /// spells out only the rows on screen.
    public var name: String { TunePickerText.openLabel(action, entry, instruments: instruments) }
    public var isTaken: Bool { state == .taken }
}

/// What a tune picker's search shows for the current query.
public struct TunePickerResults: Equatable {
    public let rows: [TunePickerRow]
    /// Every match, beyond the rows shown.
    public let matches: [CatalogEntry]
    public let outcome: SearchOutcome

    /// `No tune called "query"`, when nothing carries the typed title.
    public var noTuneCalled: String? {
        guard matches.isEmpty, case .create(let title, false, _) = outcome else { return nil }
        return CatalogScreen.noTuneCalled(title)
    }
}

/// What Return in a tune picker's search did, or asks the sheet to do.
public enum TunePickerSubmit: Equatable {
    case nothing
    /// The only match was picked.
    case picked
    case create(title: String)
    case dismissKeyboard
}

/// Whether a picker adds several tunes in one visit or picks one and closes.
enum TunePickerSelection {
    case many
    case one
}

/// The state behind a ``TunePicker``: a search over the whole catalog, archived tunes included,
/// and what a pick, a create, or Return does with it.
@MainActor
protocol TunePickerSource: AnyObject, Observable {
    var query: String { get set }
    var isIdle: Bool { get }
    /// Nil until the catalog is read.
    var results: TunePickerResults? { get }
    /// The whole catalog A to Z while the search is empty; empty once something is typed.
    var idleResults: [TunePickerRow]? { get }
    var instruments: Set<String> { get }
    /// The last pick's failure while the sheet is open.
    var failure: String? { get }
    /// Whether the idle picker has nothing to list, so the sheet says what it is for.
    var showsHint: Bool { get }
    func pick(_ entry: CatalogEntry) async
    func create(_ title: String) async
    func submit() async -> TunePickerSubmit
}

/// Finds a tune in the catalog: a search over every tune A to Z, narrowed as the musician types,
/// with an offer to create a tune by the typed title. Every picker of tunes draws this, so they
/// look and search alike. A `.many` picker stays open for the next pick; a `.one` picker closes
/// on its pick. `header` shows above the results, for actions on the current choice.
struct TunePicker<Model: TunePickerSource, Header: View>: View {
    let title: String
    let selection: TunePickerSelection
    let model: Model?
    let header: Header

    init(title: String, selection: TunePickerSelection, model: Model?, @ViewBuilder header: () -> Header) {
        self.title = title
        self.selection = selection
        self.model = model
        self.header = header()
    }

    var body: some View {
        #if os(macOS)
            if let model {
                TunePickerContent(title: title, selection: selection, model: model, header: header)
            } else {
                Color.clear.macSheetFrame(.picker)
            }
        #else
            NavigationStack {
                Group {
                    if let model {
                        TunePickerContent(title: title, selection: selection, model: model, header: header)
                    } else {
                        Color.clear
                    }
                }
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
            }
        #endif
    }
}

extension TunePicker where Header == EmptyView {
    init(title: String, selection: TunePickerSelection, model: Model?) {
        self.init(title: title, selection: selection, model: model) { EmptyView() }
    }
}

/// The words every tune picker shows.
enum TunePickerText {
    static let hint = "Search the catalog to add tunes."
    static let done = "Done"

    /// A row that can be picked, as VoiceOver reads it: the action, then the whole row, so two
    /// tunes with one title still sound apart.
    static func openLabel(_ action: String, _ entry: CatalogEntry, instruments: Set<String>) -> String {
        let row = TuneRowText(tune: entry.tune, userTune: entry.userTune, instruments: instruments)
        return "\(action) \(row.accessibilityLabel(position: nil))"
    }

    /// A tune already taken, as VoiceOver reads it: the whole row, then that it is taken.
    @MainActor static func takenLabel(_ entry: CatalogEntry, instruments: Set<String>) -> String {
        let row = TuneRowText(tune: entry.tune, userTune: entry.userTune, instruments: instruments)
        return "\(row.accessibilityLabel(position: nil)), \(TunePickerModel.inThisList)"
    }
}

private struct TunePickerContent<Model: TunePickerSource, Header: View>: View {
    let title: String
    let selection: TunePickerSelection
    @Bindable var model: Model
    let header: Header

    @Environment(\.dismiss) private var dismiss
    @Environment(\.spacing) private var spacing
    @FocusState private var searchFocused: Bool

    #if os(macOS)
        /// The search over a listing of the catalog A to Z, which the search narrows once typed.
        /// Done is not the default: Return belongs to the search, which picks its only match.
        var body: some View {
            MacSheet(
                title: title, size: .picker, cancel: nil,
                primary: .init(TunePickerText.done, isDefault: false) { dismiss() },
                escape: { FilterSearchField.escape(clearing: $model.query) { dismiss() } },
                openingFocus: .firstField
            ) {
                VStack(spacing: 0) {
                    FilterSearchField(
                        prompt: CatalogScreen.searchPrompt, query: $model.query, isFocused: $searchFocused,
                        onSubmit: submitSearch
                    )
                    .padding(.horizontal, MacStyle.sheetMargin)
                    .padding(.top, 4)
                    .padding(.bottom, 8)
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            header
                                .padding(.horizontal, MacRowStyle.labelInset)
                            if let failure = model.failure {
                                FailureText(failure)
                                    .padding(.horizontal, MacRowStyle.labelInset)
                            }
                            if model.isIdle {
                                if model.showsHint {
                                    Text(TunePickerText.hint)
                                        .font(MacStyle.secondary)
                                        .foregroundStyle(Palette.textSecondary)
                                        .padding(.horizontal, MacRowStyle.labelInset)
                                }
                                ForEach(model.idleResults ?? []) { macRow($0) }
                            } else if let results = model.results {
                                ForEach(results.rows) { macRow($0) }
                                if let note = results.noTuneCalled {
                                    Text(note)
                                        .contentMask()
                                        .font(MacStyle.secondary)
                                        .foregroundStyle(Palette.textSecondary)
                                        .padding(.horizontal, MacRowStyle.labelInset)
                                        .padding(.vertical, 4)
                                }
                                if let label = results.outcome.addTypedTitleLabel, let title = results.outcome.title {
                                    Button {
                                        create(title)
                                    } label: {
                                        HStack(spacing: 8) {
                                            MacPickGlyph(kind: .add)
                                            Text(label)
                                                .contentMask()
                                        }
                                    }
                                    .buttonStyle(.macRow)
                                }
                            }
                        }
                        .padding(.horizontal, MacStyle.sheetMargin - MacRowStyle.labelInset)
                        .padding(.bottom, 12)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                }
            }
            .onAppear { searchFocused = true }
            // The screen under this sheet disables its Find, so Command-F reaches this search.
            .focusedSceneValue(\.findAction, MenuAction { searchFocused = true })
        }

        private func macRow(_ row: TunePickerRow) -> some View {
            // A stack around the branches, so every row has one shape and the stack identifies
            // rows by id.
            VStack(spacing: 0) { macRowContent(row) }
        }

        @ViewBuilder private func macRowContent(_ row: TunePickerRow) -> some View {
            if row.isTaken {
                // The check says the tune is taken, so every row's key pill keeps the same
                // trailing slot; VoiceOver hears it in words.
                HStack(spacing: 8) {
                    MacPickGlyph(kind: .done)
                    TuneRow(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
                }
                .padding(.horizontal, MacRowStyle.labelInset)
                .frame(maxWidth: .infinity, minHeight: MacControl.rowMinHeight, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(TunePickerText.takenLabel(row.entry, instruments: model.instruments))
            } else {
                Button {
                    pick(row)
                } label: {
                    HStack(spacing: 8) {
                        MacPickGlyph(kind: macGlyph(row))
                        TuneRow(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
                    }
                }
                .buttonStyle(.macRow)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(row.name)
                .accessibilityAddTraits(row.state == .chosen ? [.isButton, .isSelected] : .isButton)
            }
        }

        private func macGlyph(_ row: TunePickerRow) -> MacPickGlyph.Kind {
            switch (selection, row.state) {
            case (_, .chosen), (_, .taken): .done
            case (.many, .open): .add
            case (.one, .open): .addOnHighlight
            }
        }
    #else
        var body: some View {
            List {
                header
                if let failure = model.failure {
                    Text(failure)
                        .font(.platform(.footnote))
                        .foregroundStyle(Palette.danger)
                }
                if model.isIdle {
                    if model.showsHint {
                        Text(TunePickerText.hint)
                            .font(.platform(.footnote))
                            .foregroundStyle(.textSecondary)
                            .listRowSeparator(.hidden)
                    }
                    ForEach(model.idleResults ?? []) { pickerRow($0) }
                } else if let results = model.results {
                    ForEach(results.rows) { pickerRow($0) }
                    if let note = results.noTuneCalled {
                        Text(note)
                            .contentMask()
                            .font(.platform(.footnote))
                            .foregroundStyle(.textSecondary)
                    }
                    if let label = results.outcome.addTypedTitleLabel, let title = results.outcome.title {
                        AddTypedTitleRow(label: label) { create(title) }
                    }
                }
            }
            .listStyle(.plain)
            .pageBackground()
            .searchable(
                text: $model.query, placement: .navigationBarDrawer(displayMode: .always),
                prompt: CatalogScreen.searchPrompt
            )
            .textEntry(.search)
            .searchFocused($searchFocused)
            .onSubmit(of: .search, submitSearch)
            .scrollDismissesKeyboard(.immediately)
            .toolbar {
                ConfirmToolbarItem {
                    Button(TunePickerText.done) { dismiss() }
                }
            }
            // The screen under this sheet disables its Find, so Command-F reaches this search.
            .focusedSceneValue(\.findAction, MenuAction { searchFocused = true })
        }

        private func pickerRow(_ row: TunePickerRow) -> some View {
            // A stack, not a Group, so every row has one shape and the list identifies rows by id.
            VStack(alignment: .leading, spacing: 0) {
                if row.isTaken {
                    taken(row)
                } else {
                    offered(row)
                }
            }
            .scaledRowInsets()
        }

        private func offered(_ row: TunePickerRow) -> some View {
            Button {
                pick(row)
            } label: {
                HStack(spacing: spacing(12)) {
                    if selection == .many {
                        addGlyph
                    }
                    TuneRow(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
                        .foregroundStyle(.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if selection == .one {
                        SelectionMark(.single(isChosen: row.state == .chosen))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            // The automatic style takes the list's row highlight.
            .buttonStyle(.automatic)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(row.name)
            .accessibilityAddTraits(row.state == .chosen ? [.isButton, .isSelected] : .isButton)
        }

        private func taken(_ row: TunePickerRow) -> some View {
            HStack(spacing: spacing(12)) {
                // Holds the add glyph's width, so every title in the results starts on one line.
                addGlyph.hidden()
                TuneRow(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
                Spacer(minLength: 0)
                Text(TunePickerModel.inThisList)
                    .font(.platform(.footnote))
                    .foregroundStyle(.textSecondary)
                    .fixedSize()
            }
            .accessibilityElement(children: .combine)
        }

        private var addGlyph: some View {
            Image(systemName: "plus.circle.fill")
                .font(.platform(.title3))
                .foregroundStyle(Palette.accent)
        }
    #endif

    private func pick(_ row: TunePickerRow) {
        switch selection {
        case .many:
            #if os(macOS)
                // The field keeps focus, so the next tune can be typed straight away.
                searchFocused = true
            #endif
        case .one:
            dismiss()
        }
        Task { await model.pick(row.entry) }
    }

    private func submitSearch() {
        Task {
            switch await model.submit() {
            case .nothing: searchFocused = true
            case .picked:
                if selection == .one { dismiss() } else { searchFocused = true }
            case .create(let title):
                searchFocused = true
                create(title)
            case .dismissKeyboard: searchFocused = false
            }
        }
    }

    /// A `.many` picker creates and stays, since a musician often adds several tunes to a set
    /// list in a row; a `.one` picker closes on it as on a pick.
    private func create(_ title: String) {
        switch selection {
        case .many:
            #if os(macOS)
                searchFocused = true
            #endif
        case .one:
            dismiss()
        }
        Task { await model.create(title) }
    }
}
