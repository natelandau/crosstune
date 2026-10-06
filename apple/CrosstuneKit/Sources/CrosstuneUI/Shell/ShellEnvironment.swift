import CrosstuneCommands
import CrosstuneStore
import SwiftUI

extension EnvironmentValues {
    /// The signed-in musician's catalog, which every screen reads. Nil outside the shell.
    @Entry public var store: CrosstuneStore?
    /// The writes a screen makes against ``store``. Nil outside the shell.
    @Entry public var commands: CrosstuneCommands.Commands?
    /// The tune the split view's detail column shows, by id. Nil on iPhone, where a screen
    /// pushes the tune onto its own stack instead.
    @Entry public var detailTune: Binding<String?>?
    /// Whether a screen sits in either column of the iPad shell's split.
    @Entry var inPadSplit = false
    /// The tune a tab's screen pushes on iPhone, kept by the shell so a switch to the split view
    /// shows it in the detail column and a switch back pushes it again. Nil in the split view and
    /// on a screen pushed over the tab's own.
    @Entry var stackTune: Binding<String?>?
    /// The row a column's list keeps at its top, by id, nil at the very top. The iPad shell keeps
    /// one per destination, so every tab that shows that destination opens at the same place
    /// after a form change. Nil elsewhere.
    @Entry var scrollAnchor: Binding<String?>?
    /// Told when a row marked with ``SwiftUI/View/scrollAnchorRow(_:)`` comes into or out of view.
    @Entry var scrollRowVisibility: ScrollRowVisibility?
    /// Shows the Catalog at its root in this window, as from a stats value. Nil outside the
    /// shell, as in the Mac Settings window, which cannot switch the main window's destination.
    @Entry var openCatalogRoot: MenuAction?
    /// This window's identity for the shared player, so only the window that asks for the
    /// player in full shows it. Nil outside the shell.
    @Entry var playerWindow: UUID?
}

/// Told when a row comes into or out of view, by the row's id.
struct ScrollRowVisibility {
    private let report: @MainActor (String, Bool) -> Void

    init(_ report: @escaping @MainActor (String, Bool) -> Void) {
        self.report = report
    }

    @MainActor func callAsFunction(_ id: String, _ isVisible: Bool) {
        report(id, isVisible)
    }
}

extension View {
    /// Keeps this list at the shell's ``EnvironmentValues/scrollAnchor``, where there is one.
    /// `rows` are the ids of its rows in order, each marked with ``scrollAnchorRow(_:)``.
    func keepsScrollAnchor(rows: [String]) -> some View {
        modifier(KeepsScrollAnchor(rows: rows))
    }

    /// Marks this row as one a list can keep at its top, by the id its `ForEach` gives it.
    func scrollAnchorRow(_ id: String) -> some View {
        modifier(ScrollAnchorRow(id: id))
    }
}

private struct ScrollAnchorRow: ViewModifier {
    let id: String

    @Environment(\.scrollRowVisibility) private var report

    func body(content: Content) -> some View {
        content.onScrollVisibilityChange(threshold: 0.5) { report?(id, $0) }
    }
}

/// A list reports no scroll position of its own, so the anchor is the first of its rows in view,
/// and coming back scrolls that row to the top.
private struct KeepsScrollAnchor: ViewModifier {
    let rows: [String]

    @Environment(\.scrollAnchor) private var anchor

    func body(content: Content) -> some View {
        if let anchor {
            Kept(content: content, rows: rows, anchor: anchor)
        } else {
            content
        }
    }

    private struct Kept: View {
        let content: Content
        let rows: [String]
        @Binding var anchor: String?
        @State private var visible: VisibleRows
        /// Made once with `visible`, so the rows' environment does not change on every pass.
        @State private var report: ScrollRowVisibility
        /// Only the list on show writes its place: another tab's copy of it lays out too.
        @State private var isShown = false

        init(content: Content, rows: [String], anchor: Binding<String?>) {
            self.content = content
            self.rows = rows
            _anchor = anchor
            let visible = VisibleRows()
            _visible = State(initialValue: visible)
            _report = State(
                initialValue: ScrollRowVisibility { id, isVisible in
                    if isVisible { visible.ids.insert(id) } else { visible.ids.remove(id) }
                })
        }

        var body: some View {
            ScrollViewReader { proxy in
                content
                    .environment(\.scrollRowVisibility, report)
                    .onChange(of: visible.ids) {
                        guard isShown else { return }
                        let top = rows.first(where: visible.ids.contains)
                        // The first row in view at the very top leaves the header rows above it showing.
                        anchor = top == rows.first ? nil : top
                    }
                    .onAppear {
                        if let anchor { proxy.scrollTo(anchor, anchor: .top) }
                        isShown = true
                    }
                    .onDisappear { isShown = false }
            }
        }
    }
}

/// The rows in view, a reference so the one reporter made for a list keeps writing to it.
@MainActor @Observable
private final class VisibleRows {
    var ids: Set<String> = []
}
