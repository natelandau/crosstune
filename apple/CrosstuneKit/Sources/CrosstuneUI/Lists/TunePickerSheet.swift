import CrosstuneAnalytics
import CrosstuneStore
import SwiftUI

/// Searches the catalog and adds tunes to one list, several in one visit. Reads the store from
/// the environment.
public struct TunePickerSheet: View {
    public static let title = "Add tunes"
    public static let hint = "Search the catalog to add tunes."
    public static let done = "Done"

    /// A tune already in the list, as VoiceOver reads it: the whole row, then that it is in.
    static func takenLabel(_ entry: CatalogEntry, instruments: Set<String>) -> String {
        let row = TuneRowText(tune: entry.tune, userTune: entry.userTune, instruments: instruments)
        return "\(row.accessibilityLabel(position: nil)), \(TunePickerModel.inThisList)"
    }

    private let listID: String
    private let onCreate: (_ title: String) -> Void
    private let onLateFailure: @MainActor (String) -> Void

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @State private var model: TunePickerModel?

    /// - Parameters:
    ///   - onCreate: The musician chose to create a tune by this title; the sheet is closing.
    ///   - onLateFailure: A pick failed after the sheet closed.
    public init(
        listID: String, onCreate: @escaping (_ title: String) -> Void,
        onLateFailure: @escaping @MainActor (String) -> Void
    ) {
        self.listID = listID
        self.onCreate = onCreate
        self.onLateFailure = onLateFailure
    }

    public var body: some View {
        #if os(macOS)
            Group {
                if let model {
                    TunePickerContent(model: model, onCreate: onCreate)
                } else {
                    Color.clear.macSheetFrame(.picker)
                }
            }
            .task { makeModel() }
            .onDisappear { model?.close() }
            .shellSheet()
        #else
            phoneBody
        #endif
    }

    private func makeModel() {
        guard model == nil, let store else { return }
        model = TunePickerModel(store: store, listID: listID, analytics: analytics, onLateFailure: onLateFailure)
    }

    #if os(iOS)
        private var phoneBody: some View {
            NavigationStack {
                Group {
                    if let model {
                        TunePickerContent(model: model, onCreate: onCreate)
                    } else {
                        Color.clear
                    }
                }
                .navigationTitle(Self.title)
                .navigationBarTitleDisplayMode(.inline)
            }
            .task { makeModel() }
            .onDisappear { model?.close() }
            .shellSheet()
        }
    #endif
}

private struct TunePickerContent: View {
    @Bindable var model: TunePickerModel
    let onCreate: (_ title: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.spacing) private var spacing
    @FocusState private var searchFocused: Bool

    #if os(macOS)
        /// The search over a listing of the catalog A to Z, which the search narrows once typed.
        /// Done is not the default: Return belongs to the search, which adds its only match.
        var body: some View {
            MacSheet(
                title: TunePickerSheet.title, size: .picker, cancel: nil,
                primary: .init(TunePickerSheet.done, isDefault: false) { dismiss() },
                escape: { FilterSearchField.escape(clearing: $model.query) { dismiss() } }
            ) {
                VStack(spacing: 0) {
                    FilterSearchField(
                        prompt: CatalogScreen.searchPrompt, query: $model.query, isFocused: $searchFocused,
                        filterCount: nil,
                        onSubmit: submitSearch
                    )
                    .padding(.horizontal, MacStyle.sheetMargin)
                    .padding(.top, 4)
                    .padding(.bottom, 8)
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            if let failure = model.failure {
                                FailureText(failure)
                                    .padding(.horizontal, 8)
                            }
                            if model.isIdle {
                                if model.showsHint {
                                    Text(TunePickerSheet.hint)
                                        .font(MacStyle.secondary)
                                        .foregroundStyle(Palette.inkSecondary)
                                        .padding(.horizontal, 8)
                                }
                                ForEach(model.idleResults ?? []) { macRow($0) }
                            } else if let results = model.results {
                                ForEach(results.rows) { macRow($0) }
                                if let note = results.noTuneCalled {
                                    Text(note)
                                        .contentMask()
                                        .font(MacStyle.secondary)
                                        .foregroundStyle(Palette.inkSecondary)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                }
                                if let offer = results.outcome.offerLabel, let title = results.outcome.title {
                                    Button {
                                        create(title)
                                    } label: {
                                        HStack(spacing: 8) {
                                            MacPickGlyph(kind: .add)
                                            Text(offer)
                                                .contentMask()
                                        }
                                    }
                                    .buttonStyle(.macPickRow)
                                }
                            }
                        }
                        .padding(.horizontal, MacStyle.sheetMargin - 8)
                        .padding(.bottom, 12)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                }
            }
            .onAppear { searchFocused = true }
            // The screen under this sheet stands its Find down, so Command-F reaches this search.
            .focusedSceneValue(\.findAction, MenuAction { searchFocused = true })
        }

        @ViewBuilder private func macRow(_ row: TunePickerModel.Row) -> some View {
            if row.isTaken {
                // The check says the tune is in the list, so every row's key pill keeps the same
                // trailing slot; VoiceOver hears it in words.
                HStack(spacing: 8) {
                    MacPickGlyph(kind: .done)
                    TuneRow(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
                }
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, minHeight: MacPickRowStyle.minHeight, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(TunePickerSheet.takenLabel(row.entry, instruments: model.instruments))
            } else {
                Button {
                    // The field keeps focus, so the next tune can be typed straight away.
                    searchFocused = true
                    Task { await model.pick(row.entry) }
                } label: {
                    HStack(spacing: 8) {
                        MacPickGlyph(kind: .add)
                        TuneRow(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
                    }
                }
                .buttonStyle(.macPickRow)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(row.name)
                .accessibilityAddTraits(.isButton)
            }
        }
    #endif

    private func submitSearch() {
        Task {
            switch await model.submit() {
            case .nothing: searchFocused = true
            case .create(let title): create(title)
            case .dismissKeyboard: searchFocused = false
            }
        }
    }

    #if os(iOS)
        var body: some View {
            List {
                if let failure = model.failure {
                    Text(failure)
                        .font(.platform(.footnote))
                        .foregroundStyle(.red)
                }
                if model.isIdle {
                    if model.showsHint {
                        Text(TunePickerSheet.hint)
                            .font(.platform(.footnote))
                            .foregroundStyle(.inkSecondary)
                            .listRowSeparator(.hidden)
                    }
                    ForEach(model.idleResults ?? []) { pickerRow($0) }
                } else if let results = model.results {
                    ForEach(results.rows) { pickerRow($0) }
                    if let note = results.noTuneCalled {
                        Text(note)
                            .contentMask()
                            .font(.platform(.footnote))
                            .foregroundStyle(.inkSecondary)
                    }
                    if let offer = results.outcome.offerLabel, let title = results.outcome.title {
                        SearchOfferRow(label: offer) { create(title) }
                    }
                }
            }
            .listStyle(.plain)
            .paperGround()
            .searchable(text: $model.query, placement: Self.searchPlacement, prompt: CatalogScreen.searchPrompt)
            .searchFocused($searchFocused)
            .onSubmit(of: .search, submitSearch)
            .toolbar {
                ConfirmToolbarItem {
                    Button(TunePickerSheet.done) { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .onAppear { searchFocused = true }
            // The screen under this sheet stands its Find down, so Command-F reaches this search.
            .focusedSceneValue(\.findAction, MenuAction { searchFocused = true })
        }

        private static var searchPlacement: SearchFieldPlacement { .navigationBarDrawer(displayMode: .always) }

        private func pickerRow(_ row: TunePickerModel.Row) -> some View {
            Group {
                if row.isTaken {
                    taken(row)
                } else {
                    offered(row)
                }
            }
            .scaledRowInsets()
        }

        private func offered(_ row: TunePickerModel.Row) -> some View {
            Button {
                // The field keeps focus, so the next tune can be typed straight away.
                searchFocused = true
                Task { await model.pick(row.entry) }
            } label: {
                HStack(spacing: spacing(12)) {
                    Image(systemName: "plus.circle.fill")
                        .font(.platform(.title3))
                        .foregroundStyle(.tint)
                    TuneRow(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
                        .foregroundStyle(.primary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(row.name)
            .accessibilityAddTraits(.isButton)
        }

        private func taken(_ row: TunePickerModel.Row) -> some View {
            HStack(spacing: spacing(12)) {
                // Holds the add glyph's width, so every title in the results starts on one line.
                Image(systemName: "plus.circle.fill")
                    .font(.platform(.title3))
                    .hidden()
                TuneRow(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
                Spacer(minLength: 0)
                Text(TunePickerModel.inThisList)
                    .font(.platform(.footnote))
                    .foregroundStyle(.inkSecondary)
                    .fixedSize()
            }
            .accessibilityElement(children: .combine)
        }
    #endif

    private func create(_ title: String) {
        onCreate(title)
        dismiss()
    }
}
