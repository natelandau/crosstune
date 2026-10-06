import CrosstuneVocabulary
import SwiftUI

/// The catalog's status filter as a choice among All and each status: the iPhone title menu's
/// items, and the one write the Mac sidebar's status rows share.
enum StatusScope {
    /// The id of the Catalog choice, which is no status.
    static let allID = "all"

    struct Choice: Identifiable, Equatable {
        /// Nil is every status, the Catalog.
        let status: String?
        let label: String
        /// Nil until the counts are read.
        let count: Int?

        var id: String { status ?? StatusScope.allID }

        @MainActor var systemImage: String {
            status.map { StatusGlyph.symbol(for: $0) } ?? Destination.catalog.systemImage
        }
    }

    /// The Catalog, then each status, with the count beside each once `counts` is read.
    static func choices(_ counts: CatalogCounts?) -> [Choice] {
        [Choice(status: nil, label: Destination.catalog.title, count: counts?.catalog)]
            + Vocabulary.statuses.map {
                Choice(status: $0, label: StatusStyle.label($0), count: counts?.byStatus[$0])
            }
    }

    /// What the catalog's title reads: the Catalog for every status, else the status's label.
    static func title(_ status: String?) -> String {
        status.map(StatusStyle.label) ?? Destination.catalog.title
    }

    /// Sets the catalog's status filter, leaving every other filter as it is. A status already in
    /// force writes nothing.
    @MainActor
    static func choose(_ status: String?, in catalog: CatalogModel) {
        guard catalog.status != status else { return }
        catalog.updateFilters { $0.status = status }
    }
}

/// The catalog's title as a menu of its status choices, the current one checked.
struct StatusTitleMenu: View {
    let model: CatalogModel
    let counts: CatalogCounts?

    var body: some View {
        ForEach(StatusScope.choices(counts)) { choice in
            Button {
                StatusScope.choose(choice.status, in: model)
            } label: {
                Label {
                    Text(choice.count.map { "\(choice.label) \($0)" } ?? choice.label)
                } icon: {
                    Image(systemName: model.status == choice.status ? "checkmark" : choice.systemImage)
                }
            }
        }
    }
}
