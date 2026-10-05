#if os(macOS)
    import SwiftUI

    /// A content column's title at the top of its list, so it scrolls with the rows it names.
    /// The column's list carries ``SwiftUI/View/columnTitled(_:)``, which keeps the toolbar's own
    /// title hidden while this one shows.
    struct ColumnTitle: View {
        private let title: String

        @Environment(\.columnTitleReporter) private var reporter

        init(_ title: String) {
            self.title = title
        }

        var body: some View {
            Text(title)
                .font(MacStyle.columnTitle)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                // Gone once its lower half has scrolled under the pane bar, as the toolbar's
                // title is about to read in its place.
                .onScrollVisibilityChange(threshold: 0.5) { reporter?.report($0) }
                .onDisappear { reporter?.report(false) }
        }
    }

    /// Hands a column title's visibility to the list that shows it.
    struct ColumnTitleReporter {
        let report: @MainActor (Bool) -> Void
    }

    extension EnvironmentValues {
        @Entry var columnTitleReporter: ColumnTitleReporter?
    }

    extension View {
        /// Names this column `title` for the toolbar, the window menu, and Mission Control,
        /// showing it in the toolbar only while the list's ``ColumnTitle`` is scrolled away, so
        /// the title never reads twice. `alwaysShown` keeps it in the toolbar, for a title that
        /// says something the column title does not, such as a selection's count.
        /// `onTitleShows` hears each change in whether the column title is on screen, for
        /// controls that ride on the title's line and need a place once it scrolls away.
        func columnTitled(
            _ title: String, alwaysShown: Bool = false, onTitleShows: ((Bool) -> Void)? = nil
        ) -> some View {
            modifier(ColumnTitled(title: title, alwaysShown: alwaysShown, onTitleShows: onTitleShows))
        }
    }

    private struct ColumnTitled: ViewModifier {
        let title: String
        let alwaysShown: Bool
        let onTitleShows: ((Bool) -> Void)?

        @State private var titleShows = true

        func body(content: Content) -> some View {
            content
                .environment(
                    \.columnTitleReporter,
                    ColumnTitleReporter { shows in
                        titleShows = shows
                        onTitleShows?(shows)
                    }
                )
                .navigationTitle(title)
                .toolbar(removing: titleShows && !alwaysShown ? .title : nil)
        }
    }
#endif
