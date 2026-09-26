import SwiftUI

/// What New tune does on the screen in front: the list a new tune is filed in, and what happens
/// once it is saved, such as opening it.
struct NewTuneContext {
    var listID: String?
    var onSaved: (@MainActor (_ tuneID: String) -> Void)?
}

/// A screen's New tune context, held by reference so the screen can refresh it as it redraws
/// and New tune always reads the latest.
@MainActor
final class NewTuneContextBox {
    var context: NewTuneContext

    init(_ context: NewTuneContext = NewTuneContext()) {
        self.context = context
    }
}

/// The New tune contexts of the screens on show, the latest in front. A screen arriving can
/// register before the one it replaces leaves, so each is kept by its own id.
@MainActor
@Observable
final class NewTuneContexts {
    private var registered: [(id: UUID, box: NewTuneContextBox)] = []

    /// The context of the screen most recently shown, if any screen registered one.
    var current: NewTuneContext? { registered.last?.box.context }

    func register(_ box: NewTuneContextBox, id: UUID) {
        unregister(id)
        registered.append((id, box))
    }

    func unregister(_ id: UUID) {
        registered.removeAll { $0.id == id }
    }
}

extension EnvironmentValues {
    /// Supplied by the shell; nil outside it.
    @Entry var newTuneContexts: NewTuneContexts?
}

extension View {
    /// Tells the menu's New tune what to do while this screen shows: file the tune in `listID`,
    /// and call `onSaved` with the new tune's id.
    func newTuneContext(listID: String? = nil, onSaved: (@MainActor (String) -> Void)? = nil) -> some View {
        modifier(RegistersNewTuneContext(context: NewTuneContext(listID: listID, onSaved: onSaved)))
    }
}

private struct RegistersNewTuneContext: ViewModifier {
    let context: NewTuneContext

    @Environment(\.newTuneContexts) private var contexts
    @State private var id = UUID()
    @State private var box = NewTuneContextBox()

    func body(content: Content) -> some View {
        // Refreshed on every redraw, so a saved tune reaches the screen as it is now. The box is
        // not observed, so writing it here starts no update.
        box.context = context
        return
            content
            .onAppear { contexts?.register(box, id: id) }
            .onDisappear { contexts?.unregister(id) }
    }
}

/// The tune form the menu's New tune opens, presented once over the whole shell, so it works
/// from every screen. The screen in front says which list the tune lands in.
struct TuneFormSheets: ViewModifier {
    @State private var contexts = NewTuneContexts()
    @State private var request: Request?
    @Environment(\.openSheets) private var openSheets
    @Environment(\.selecting) private var selecting
    @Environment(CatalogModel.self) private var catalog: CatalogModel?

    private struct Request: Identifiable {
        let id = UUID()
        let context: NewTuneContext
    }

    func body(content: Content) -> some View {
        content
            .environment(\.newTuneContexts, contexts)
            .focusedSceneValue(\.newTuneAction, canOpen ? MenuAction(open) : nil)
            .sheet(item: $request) { request in
                TuneFormSheet(target: .new(title: nil, listID: request.context.listID)) { tuneID in
                    request.context.onSaved?(tuneID)
                }
            }
    }

    private var canOpen: Bool {
        MenuGates.newTune(sheetsOpen: openSheets?.isCovered == true, selecting: selecting?.isCovered == true)
    }

    private func open() {
        // Opening the form clears the catalog's search, wherever it opens from.
        _ = catalog?.newTune()
        request = Request(context: contexts.current ?? NewTuneContext())
    }
}
