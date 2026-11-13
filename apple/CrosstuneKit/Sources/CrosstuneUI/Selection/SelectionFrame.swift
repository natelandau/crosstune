import CrosstuneDesign
import CrosstuneStore
import SwiftUI

#if os(iOS)
    /// What a screen hands the selection frame as its actions on iOS: the bar's buttons and
    /// menus, in order. The frame lays them out and colors them, so every screen's bar matches.
    typealias SelectionActionsContent = View
#else
    /// What a screen hands the selection frame as its actions: the Mac bar's Actions menu items.
    protocol SelectionActionsContent {
        var menuItems: [MacSelectionMenuItem] { get }
    }

    extension Array: SelectionActionsContent where Element == MacSelectionMenuItem {
        var menuItems: [MacSelectionMenuItem] { self }
    }
#endif

extension View {
    /// The selection mode every screen of selectable rows shares: on iOS, Select All and Done and
    /// the bottom bar that holds `actions`; on the Mac, the selection bar with Select all, an
    /// Actions menu of `actions`, and Done. Then the failure line, the undo banner, and
    /// VoiceOver's focus and count. `visibleIDs` are the rows in screen order; `title` counts
    /// the selection in the screen's own noun. The frame makes `runner` for the store and hands
    /// it the window's undo manager, and nothing shows until it is made.
    func selectionFrame<Runner: BulkActionRunner, Actions: SelectionActionsContent>(
        _ selection: Binding<TuneSelection>, visibleIDs: [String], title: @escaping (Int) -> String,
        runner: Binding<Runner?>, focusedRow: AccessibilityFocusState<String?>.Binding,
        actions: @escaping (Runner) -> Actions
    ) -> some View {
        modifier(
            SelectionFrame(
                selection: selection, visibleIDs: visibleIDs, title: title, runner: runner, focusedRow: focusedRow,
                actions: actions))
    }
}

private struct SelectionFrame<Runner: BulkActionRunner, Actions: SelectionActionsContent>: ViewModifier {
    @Binding var selection: TuneSelection
    let visibleIDs: [String]
    let title: (Int) -> String
    @Binding var runner: Runner?
    let focusedRow: AccessibilityFocusState<String?>.Binding
    let actions: (Runner) -> Actions

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(\.undoManager) private var undoManager
    @Environment(\.spacing) private var spacing

    func body(content: Content) -> some View {
        content
            #if os(iOS)
                .toolbar {
                    if selection.isActive, let runner { toolbar(runner) }
                }
            #else
                // The screen's list shows the bar in place of its filter row.
                .environment(\.selectionBar, selection.isActive ? runner.map { AnyView(selectionBar($0)) } : nil)
                .background {
                    // Escape ends the mode even with the bar and its Done scrolled out of the list.
                    if selection.isActive {
                        Button(TuneSelection.done) { selection.exit() }
                        .keyboardShortcut(.cancelAction)
                        .hidden()
                        .frame(width: 0, height: 0)
                        .accessibilityHidden(true)
                    }
                }
            #endif
            #if os(iOS)
                .environment(\.editMode, .constant(selection.isActive ? .active : .inactive))
                .toolbarVisibility(selection.isActive ? .hidden : .automatic, for: .tabBar)
                // A solid bar in the tab bar's place: the system toolbar draws its items in its
                // own muted style, which the rows beneath it wash out.
                .safeAreaBar(edge: .bottom, spacing: 0) {
                    if selection.isActive, let runner { SelectionActionBar { actions(runner) } }
                }
                // A screen wearing the selection toolbar shows no back button.
                .navigationBarBackButtonHidden(selection.isActive)
            #endif
            .safeAreaInset(edge: .top, spacing: 0) {
                if let failure = runner?.failure {
                    Text(failure)
                        .font(.platform(.footnote))
                        .foregroundStyle(Palette.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.vertical, spacing.stackGap)
                }
            }
            // Rows read the screen's order from here, for a checkbox, a click, and a Shift-click range.
            .environment(\.selectionVisibleIDs, selection.isActive ? visibleIDs : [])
            // The selection's action bar takes the tab bar's place, record slot and all.
            .claimsSelection(selection.isActive)
            .onChange(of: selection.isActive) { _, active in
                modeChanged(active)
            }
            .onChange(of: visibleIDs) { _, visible in
                selection.prune(visible: visible)
            }
            // Leaving the screen ends the mode.
            .onDisappear {
                selection.exit()
            }
            .undoBanner(undoBanner)
            .task(id: store.map(ObjectIdentifier.init)) {
                guard let store else { return }
                runner = Runner(store: store, analytics: analytics)
                runner?.undoManager = undoManager
            }
            .onChange(of: undoManager) { runner?.undoManager = undoManager }
    }

    private var undoBanner: Binding<UndoBannerItem?> {
        Binding {
            runner?.undoBannerItem
        } set: {
            runner?.undoBannerItem = $0
        }
    }

    #if os(iOS)
        @ToolbarContentBuilder private func toolbar(_ runner: Runner) -> some ToolbarContent {
            ToolbarItem(placement: .topBarLeading) {
                let allSelected = selection.allSelected(visible: visibleIDs)
                Button(allSelected ? TuneSelection.deselectAll : TuneSelection.selectAll) {
                    toggleAll()
                }
                // Command-A selects all and never clears, so it leaves with Deselect All.
                .keyboardShortcut(allSelected ? nil : KeyboardShortcut("a"))
            }
            ConfirmToolbarItem {
                Button(TuneSelection.done) { selection.exit() }
                    // Escape leaves the mode.
                    .keyboardShortcut(.cancelAction)
            }
        }
    #else
        private func selectionBar(_ runner: Runner) -> some View {
            MacSelectionBar(
                count: selection.ids.count, allSelected: selection.allSelected(visible: visibleIDs),
                canSelectAll: !visibleIDs.isEmpty, onSelectAll: toggleAll, items: actions(runner).menuItems,
                isPending: runner.isPending, onDone: { selection.exit() })
        }
    #endif

    private func modeChanged(_ active: Bool) {
        if active {
            focusedRow.wrappedValue = selection.origin ?? visibleIDs.first
            // A row entry is heard through the focus move and the row's selected trait; one from
            // the toolbar has no row to speak for it.
            if selection.origin == nil { announceCount() }
        } else {
            // VoiceOver returns to the row the mode was entered from, when it still shows.
            if let origin = selection.origin, visibleIDs.contains(origin) { focusedRow.wrappedValue = origin }
        }
    }

    /// Select all and Deselect all change rows the musician is not on, so the count is said.
    private func toggleAll() {
        selection.toggleAll(visible: visibleIDs)
        announceCount()
    }

    private func announceCount() {
        AccessibilityNotification.Announcement(title(selection.ids.count)).post()
    }
}

/// The delete question a selection asks, read when Delete is pressed.
protocol SelectionDeleteQuestion: Identifiable {
    var title: String { get }
    var message: String { get }
}

extension BulkDeleteQuestion: SelectionDeleteQuestion {}
extension RecordingBulkDeleteQuestion: SelectionDeleteQuestion {}

extension View {
    /// Asks `question` before deleting the selected rows, then runs `delete`. Put it on the
    /// control that offers Delete, so the question points at it.
    func confirmsSelectionDelete<Question: SelectionDeleteQuestion>(
        _ question: Binding<Question?>, button: String, delete: @escaping @MainActor (Question) async -> Void
    ) -> some View {
        self
            .coversShell(question.wrappedValue != nil)
            .confirmationDialog(
                question.wrappedValue?.title ?? "", item: question, titleVisibility: .visible
            ) { question in
                Button(button, role: .destructive) {
                    Task { await delete(question) }
                }
            } message: { question in
                Text(question.message)
            }
    }
}

/// The selected rows an open sheet works over, fixed as it opens.
struct SelectedRows<Row: Identifiable>: Identifiable where Row.ID == String {
    let rows: [Row]
    var id: [String] { rows.map(\.id) }
}

#if os(iOS)
    /// The selection's actions on iOS, spread evenly across a bar on `surface` with a rule on
    /// top, in the place the tab bar leaves.
    struct SelectionActionBar<Actions: View>: View {
        @ViewBuilder let actions: Actions

        @Environment(\.spacing) private var spacing

        var body: some View {
            // Top-aligned, so an action showing its glyph alone keeps its glyph in line.
            HStack(alignment: .top, spacing: 0) {
                ForEach(subviews: actions) { action in
                    action.frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.selectionAction)
            .padding(.vertical, spacing.stackGap)
            .background(Palette.surface, ignoresSafeAreaEdges: .bottom)
            .overlay(alignment: .top) {
                Palette.border.frame(height: 1)
            }
        }
    }

    /// An action in the selection's bar: its glyph above its words.
    struct SelectionActionLabel: View {
        let title: String
        let systemImage: String

        @Environment(\.spacing) private var spacing

        private static let glyphHeight: CGFloat = 26

        init(_ title: String, systemImage: String) {
            self.title = title
            self.systemImage = systemImage
        }

        var body: some View {
            // The glyph alone where the words do not fit: a narrow split-view column, or a large
            // text size.
            ViewThatFits(in: .horizontal) {
                VStack(spacing: spacing.rowLineGap) {
                    glyph
                    Text(title)
                        .font(.platform(.caption))
                        .lineLimit(1)
                        .fixedSize()
                }
                glyph
            }
            // The tap area is the label's, so the label fills its share of the bar.
            .frame(maxWidth: .infinity, minHeight: minimumTapTarget)
            .contentShape(.rect)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(title)
        }

        private var glyph: some View {
            Image(systemName: systemImage)
                .font(.platform(.title3))
                // One height for every glyph, so the words below line up across the bar.
                .frame(height: spacing(Self.glyphHeight))
        }
    }
#endif

extension EnvironmentValues {
    /// The selectable rows of the screen in selection mode, in screen order.
    @Entry var selectionVisibleIDs: [String] = []
}
