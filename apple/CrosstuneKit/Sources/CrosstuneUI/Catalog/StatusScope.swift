import CrosstuneVocabulary
import SwiftUI

/// The catalog's status filter as a choice among Any and each status: the filter row's status
/// items, and the one write the Mac and iPad sidebars' status rows share.
enum StatusScope {
    /// The id of the Any choice, which is no status.
    static let allID = "all"

    struct Choice: Identifiable, Equatable {
        /// Nil is every status.
        let status: String?
        let label: String
        /// Nil until the counts are read.
        let count: Int?

        var id: String { status ?? StatusScope.allID }

        @MainActor var systemImage: String {
            status.map { StatusGlyph.symbol(for: $0) } ?? Destination.catalog.systemImage
        }
    }

    /// Any, then each status, with the count beside each once `counts` is read.
    static func choices(_ counts: CatalogCounts?) -> [Choice] {
        [Choice(status: nil, label: CatalogFilterSheet.any, count: counts?.catalog)]
            + Vocabulary.statuses.map {
                Choice(status: $0, label: StatusStyle.label($0), count: counts?.byStatus[$0])
            }
    }

    /// Sets the catalog's status filter, leaving every other filter as it is. A status already in
    /// force writes nothing.
    @MainActor
    static func choose(_ status: String?, in catalog: CatalogModel) {
        guard catalog.status != status else { return }
        catalog.updateFilters { $0.status = status }
    }
}
