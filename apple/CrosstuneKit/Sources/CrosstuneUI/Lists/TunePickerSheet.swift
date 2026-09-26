import CrosstuneStore
import SwiftUI

/// Searches the catalog and adds tunes to one list, several in one visit. Reads the store from
/// the environment.
public struct TunePickerSheet: View {
    public static let title = "Add tunes"
    public static let hint = "Search the catalog to add tunes."
    public static let done = "Done"

    private let listID: String
    private let onCreate: (_ title: String) -> Void
    private let onLateFailure: @MainActor (String) -> Void

    @Environment(\.store) private var store
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
        NavigationStack {
            Group {
                if let model {
                    TunePickerContent(model: model, onCreate: onCreate)
                } else {
                    Color.clear
                }
            }
            .navigationTitle(Self.title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 480, minHeight: 480, idealHeight: 560)
        #endif
        .task {
            guard model == nil, let store else { return }
            model = TunePickerModel(store: store, listID: listID, onLateFailure: onLateFailure)
        }
        .onDisappear { model?.close() }
        .shellSheet()
    }
}

private struct TunePickerContent: View {
    @Bindable var model: TunePickerModel
    let onCreate: (_ title: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var searchFocused: Bool

    var body: some View {
        List {
            if let failure = model.failure {
                Text(failure)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            if model.isIdle {
                Text(TunePickerSheet.hint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowSeparator(.hidden)
            }
            if let results = model.results {
                ForEach(results.rows) { row in
                    if row.isTaken {
                        taken(row)
                    } else {
                        offered(row)
                    }
                }
                if let note = results.noTuneCalled {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let offer = results.outcome.offerLabel, let title = results.outcome.title {
                    SearchOfferRow(label: offer) { create(title) }
                }
            }
        }
        .listStyle(.plain)
        .searchable(text: $model.query, placement: Self.searchPlacement, prompt: CatalogScreen.searchPrompt)
        .searchFocused($searchFocused)
        .onSubmit(of: .search) {
            Task {
                switch await model.submit() {
                case .nothing: searchFocused = true
                case .create(let title): create(title)
                case .dismissKeyboard: searchFocused = false
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(TunePickerSheet.done) { dismiss() }
                    .fontWeight(.semibold)
            }
        }
        .onAppear { searchFocused = true }
        #if os(iOS)
            // The screen under this sheet stands its Find down, so Command-F reaches this search.
            .focusedSceneValue(\.findAction, MenuAction { searchFocused = true })
        #endif
    }

    private static var searchPlacement: SearchFieldPlacement {
        #if os(iOS)
            .navigationBarDrawer(displayMode: .always)
        #else
            .automatic
        #endif
    }

    private func offered(_ row: TunePickerModel.Row) -> some View {
        Button {
            // The field keeps focus, so the next tune can be typed straight away.
            searchFocused = true
            Task { await model.pick(row.entry) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "plus.circle.fill")
                    .font(.title3)
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
        HStack(spacing: 12) {
            // Holds the add glyph's width, so every title in the results starts on one line.
            Image(systemName: "plus.circle.fill")
                .font(.title3)
                .hidden()
            TuneRow(tune: row.entry.tune, userTune: row.entry.userTune, instruments: model.instruments)
            Spacer(minLength: 0)
            Text(TunePickerModel.inThisList)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize()
        }
        .accessibilityElement(children: .combine)
    }

    private func create(_ title: String) {
        onCreate(title)
        dismiss()
    }
}
