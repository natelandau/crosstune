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
                .tracking(MacStyle.columnTitleTracking)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.bottom, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                // Gone once its lower half has scrolled under the pane bar, as the toolbar's
                // title is about to read in its place.
                .onScrollVisibilityChange(threshold: 0.5) { reporter?.report($0) }
                .onDisappear { reporter?.report(false) }
        }
    }

    extension View {
        /// Sets this title's first baseline on ``MacStyle/columnTitleBaseline`` below the pane
        /// bar, for a bold title of `size` points at the top of `container`. The row or page
        /// holding it adds no top inset of its own.
        func columnTitleBaseline(
            _ container: MacStyle.TitleContainer, size: CGFloat = MacStyle.columnTitleSize
        ) -> some View {
            padding(.top, MacStyle.titleTop(size: size, container: container))
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
        /// the title never reads twice.
        func columnTitled(_ title: String) -> some View {
            modifier(ColumnTitled(title: title))
        }
    }

    private struct ColumnTitled: ViewModifier {
        let title: String

        @State private var titleShows = true

        func body(content: Content) -> some View {
            content
                .environment(
                    \.columnTitleReporter,
                    ColumnTitleReporter { titleShows = $0 }
                )
                .navigationTitle(title)
                .toolbar(removing: titleShows ? .title : nil)
        }
    }
#endif
