import CrosstuneAnalytics
import Observation
import SwiftUI

#if os(macOS)
    import AppKit
#endif

/// A tune not made yet: the title typed on the new-tune draft. The title alone makes the tune,
/// once, by Return or by leaving the page, and a blank title makes nothing, so no untitled tune
/// is ever left behind.
@MainActor
@Observable
final class NewTuneDraft {
    /// Tune ids are UUIDs, so no tune's id starts with this.
    nonisolated private static let idPrefix = "new-tune-draft:"

    /// The draft's place where a tune's id would go, in the detail column or on a tab's stack.
    nonisolated static func id(source: ActionSource) -> String {
        idPrefix + source.rawValue
    }

    /// Where a draft at `tuneID` was opened from, or nil when `tuneID` is a tune's.
    nonisolated static func source(of tuneID: String?) -> ActionSource? {
        guard let tuneID, tuneID.hasPrefix(idPrefix) else { return nil }
        return ActionSource(rawValue: String(tuneID.dropFirst(idPrefix.count)))
    }

    /// The place once the draft's tune is made: the tune where the draft still shows, else
    /// wherever the musician went as the page went, which stands.
    nonisolated static func placeAfterCreate(shown: String?, draft: String, created: String) -> String? {
        shown == draft ? created : shown
    }

    /// The tune a draft made.
    struct Created: Equatable {
        let tuneID: String
        /// The title it was made with, trimmed.
        let title: String
        /// Whether Return made it, which opens its page with focus on the key tile. A tune made
        /// by leaving takes the draft's place too, but moves no focus.
        let byReturn: Bool
    }

    let source: ActionSource
    var title = ""
    /// The tune the draft made, nil until then.
    private(set) var created: Created?
    /// Told the tune the draft made, as it lands, however the draft ended.
    @ObservationIgnored var onCreated: (@MainActor (Created) -> Void)?

    /// The create under way. The Added banner refuses a second add from anywhere, but this draft
    /// waits that out (see `add`), so its own Return and leaving need their own guard to make
    /// one tune.
    @ObservationIgnored private var creating: Task<Created?, Never>?
    private let add: @MainActor (_ title: String, _ source: ActionSource) async -> String?

    /// - Parameter add: Makes the tune from its title and returns its id, nil when it could not.
    init(source: ActionSource, add: @escaping @MainActor (_ title: String, _ source: ActionSource) async -> String?) {
        self.source = source
        self.add = add
    }

    /// Return: makes the tune, whose page then replaces the draft. Nil when the title is blank,
    /// the tune is made or being made, or the create failed, which Return can try again.
    func submit() async -> Created? {
        guard creating == nil else { return nil }
        return await create(byReturn: true)
    }

    /// Leaving the page, by navigating away, closing the Mac window, quitting, or the iPhone app
    /// going to the background: makes the tune from a title, and nothing from a blank one. A
    /// create under way is waited out, and tried again if it failed, so the title is never lost.
    func leave() async -> Created? {
        while let running = creating {
            _ = await running.value
        }
        return await create(byReturn: false)
    }

    private func create(byReturn: Bool) async -> Created? {
        let typed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty, created == nil else { return nil }
        // The whole create, its outcome recorded, is one task, so whoever waits on it finds the
        // draft settled once it returns.
        let task = Task { () -> Created? in
            defer { creating = nil }
            guard let tuneID = await add(typed, source) else { return nil }
            let made = Created(tuneID: tuneID, title: typed, byReturn: byReturn)
            created = made
            onCreated?(made)
            return made
        }
        creating = task
        return await task.value
    }
}

/// The new-tune drafts open in this app, so quitting can make their tunes before the app goes.
@MainActor
public final class OpenDrafts {
    /// The app's, which every window's drafts join.
    public static let shared = OpenDrafts()

    /// How long a quit waits for drafts to land before it goes anyway.
    static let quitLimit: Duration = .seconds(5)

    /// Each open draft with how many pages show it now. A page reappearing before the last
    /// one's leave lands counts again, so that late leave never drops it.
    private var drafts: [ObjectIdentifier: (draft: NewTuneDraft, pages: Int)] = [:]
    private let quitDeadline: @MainActor () async -> Void

    /// - Parameter quitDeadline: Returns once a quit has waited long enough.
    init(quitDeadline: @escaping @MainActor () async -> Void = { try? await Task.sleep(for: OpenDrafts.quitLimit) }) {
        self.quitDeadline = quitDeadline
    }

    var isEmpty: Bool { drafts.isEmpty }

    /// The last quit's wait for its drafts, done once every draft has landed and the quit has
    /// replied, for tests.
    private(set) var quitting: Task<Void, Never>?

    /// The drafts open now, for tests.
    var open: [NewTuneDraft] { drafts.values.map(\.draft) }

    func opened(_ draft: NewTuneDraft) {
        let key = ObjectIdentifier(draft)
        drafts[key] = (draft, (drafts[key]?.pages ?? 0) + 1)
    }

    /// A page showing `draft` has gone. True once no page shows it.
    @discardableResult
    func closed(_ draft: NewTuneDraft) -> Bool {
        let key = ObjectIdentifier(draft)
        guard let entry = drafts[key] else { return true }
        guard entry.pages > 1 else {
            drafts[key] = nil
            return true
        }
        drafts[key] = (draft, entry.pages - 1)
        return false
    }

    /// Leaves every open draft, so each with a title makes its tune, and returns once all have
    /// landed.
    func leaveAll() async {
        for draft in open {
            _ = await draft.leave()
        }
    }

    /// For the Mac app's `applicationShouldTerminate`: true when the quit must wait for open
    /// drafts, in which case `reply` runs once, when their tunes have landed or the quit has
    /// waited long enough, whichever comes first.
    public func holdsQuit(reply: @escaping @MainActor () -> Void) -> Bool {
        guard !isEmpty else { return false }
        let answer = QuitAnswer(reply)
        let deadline = Task { [quitDeadline] in
            await quitDeadline()
            answer.give()
        }
        quitting = Task {
            await leaveAll()
            deadline.cancel()
            answer.give()
        }
        return true
    }
}

/// A quit's reply, given once by whichever of its waits ends first.
@MainActor
private final class QuitAnswer {
    private var reply: (@MainActor () -> Void)?

    init(_ reply: @escaping @MainActor () -> Void) {
        self.reply = reply
    }

    func give() {
        let reply = reply
        self.reply = nil
        reply?()
    }
}

extension EnvironmentValues {
    /// Where drafts register for the quit. Nil means the app's own.
    @Entry var openDrafts: OpenDrafts?
}

/// A draft's tune as the draft hands it over: the page that replaces the draft shows this
/// title in the draft's place while the tune reads.
struct HeldDraft: Equatable {
    let created: NewTuneDraft.Created
    /// The column's layout as the draft read it.
    let factsLayout: FactsLayout

    var tuneID: String { created.tuneID }
}

/// The page a new tune starts on: the tune page's band with a focused title field and nothing
/// else, since a tune not made yet has no facts, action buttons, or content to act on. The catalog's Add
/// button and the menu's New tune open it.
struct NewTuneScreen: View {
    nonisolated static let title = "New tune"

    let source: ActionSource
    /// Told the tune the draft made, before the draft's place moves to it.
    let onCreated: @MainActor (HeldDraft) -> Void

    @Environment(AddedTuneOffer.self) private var addedTune: AddedTuneOffer?

    var body: some View {
        if let addedTune {
            DraftPage(source: source, addedTune: addedTune, onCreated: onCreated)
        } else {
            // Loading is silence.
            Color.clear
        }
    }
}

private struct DraftPage: View {
    let onCreated: @MainActor (HeldDraft) -> Void

    @Environment(\.detailTune) private var detailTune
    @Environment(\.pushedTune) private var pushedTune
    @Environment(\.openDrafts) private var openDrafts
    #if os(iOS)
        @Environment(\.scenePhase) private var scenePhase
    #endif
    @State private var draft: NewTuneDraft
    @State private var factsLayout: FactsLayout?
    @FocusState private var focused: Bool

    init(source: ActionSource, addedTune: AddedTuneOffer, onCreated: @escaping @MainActor (HeldDraft) -> Void) {
        self.onCreated = onCreated
        // Held strongly, so a leave as the window closes still reaches the banner.
        _draft = State(
            initialValue: NewTuneDraft(source: source) { title, source in
                await addedTune.addAfterAnyRunning(title: title, source: source)
            })
    }

    var body: some View {
        NewTunePageFrame(factsLayout: $factsLayout) {
            // The heading the title becomes, unseen, gives the line its height and baseline, which
            // an empty field's placeholder would not, and the field lies over it.
            Text(draft.title.isEmpty ? " " : draft.title)
                .contentMask()
                .bandTitleType()
                .frame(maxWidth: .infinity, alignment: .leading)
                .hidden()
                .overlay(alignment: .topLeading) {
                    BandTitleField(text: $draft.title, focused: $focused, onCommit: submit, onCancel: {})
                }
        }
        .onAppear {
            draft.onCreated = handOver()
            drafts.opened(draft)
        }
        // After the push lands, since a field focused while its page is still sliding in keeps
        // the keyboard down.
        .task { focused = true }
        // Leaving the page by any way but Return; a plain loss of focus leaves the draft as it is.
        .onDisappear { close() }
        #if os(iOS)
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { leave() }
            }
        #else
            .onWindowClose { leave() }
        #endif
    }

    private var drafts: OpenDrafts { openDrafts ?? .shared }

    private func submit() {
        let draft = draft
        Task { _ = await draft.submit() }
    }

    /// Ends the draft, holding the quit until it lands. Everything it needs is taken now, since
    /// the view may be gone, as when its window closes, before the tune is made.
    private func leave() {
        let draft = draft
        Task { _ = await draft.leave() }
    }

    /// Leaves as the page goes, then lets the draft go once no page shows it, with the hand-over
    /// that holds this page.
    private func close() {
        let draft = draft
        let drafts = drafts
        Task {
            _ = await draft.leave()
            if drafts.closed(draft) { draft.onCreated = nil }
        }
    }

    /// What the draft does with its tune: where the draft still shows, the tune takes its place
    /// and the page that replaces it holds the title. Where the musician went elsewhere as the
    /// page went, that stands.
    private func handOver() -> @MainActor (NewTuneDraft.Created) -> Void {
        let onCreated = onCreated
        let page = self
        let draftID = NewTuneDraft.id(source: draft.source)
        return { created in
            let place: ShellValue<String?>? =
                page.detailTune
                ?? page.pushedTune.map { binding in
                    ShellValue {
                        binding.wrappedValue
                    } set: {
                        binding.wrappedValue = $0
                    }
                }
            guard let place,
                NewTuneDraft.placeAfterCreate(shown: place.value, draft: draftID, created: created.tuneID)
                    == created.tuneID
            else { return }
            // Read as the tune lands, since the column may have changed width meanwhile.
            onCreated(HeldDraft(created: created, factsLayout: page.factsLayout ?? .card))
            place.value = created.tuneID
        }
    }
}

/// The draft's title, held in the draft's place while the tune it made reads.
struct HeldDraftPage: View {
    let held: HeldDraft

    // periphery:ignore - read through its binding
    @State private var factsLayout: FactsLayout?

    init(held: HeldDraft) {
        self.held = held
        _factsLayout = State(initialValue: held.factsLayout)
    }

    var body: some View {
        NewTunePageFrame(factsLayout: $factsLayout) {
            Text(held.created.title)
                .contentMask()
                .bandTitleType()
        }
    }
}

/// The draft's page: the band alone, laid out and placed as on the tune page, with the key
/// tile's room and the rename button's room empty, so the title sits where the page puts it.
private struct NewTunePageFrame<Title: View>: View {
    @Binding var factsLayout: FactsLayout?
    @ViewBuilder let title: () -> Title

    var body: some View {
        ScrollView {
            TuneBandRow { size in
                Color.clear
                    .frame(width: size, height: size)
            } title: {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    title()
                    RenameButton(title: "", action: {})
                        .hidden()
                }
            }
            .tuneBandPlacement(factsLayout ?? .card)
            // Unseen until the column's width is read, so a wide column never shows the card's
            // placement first.
            .opacity(factsLayout == nil ? 0 : 1)
        }
        .readsFactsLayout(
            into: Binding {
                factsLayout ?? .card
            } set: {
                factsLayout = $0
            }
        )
        .paperGround()
        .navigationTitle(NewTuneScreen.title)
        #if os(macOS)
            // An empty bar keeps its height, so the band starts where the tune page's does.
            .paneBar {}
        #else
            .barTitle("", shown: false)
        #endif
    }
}

/// The menu's New tune, which opens the new-tune draft from every screen.
struct NewTuneCommand: ViewModifier {
    let open: @MainActor () -> Void

    @Environment(\.openSheets) private var openSheets
    @Environment(\.selecting) private var selecting
    @Environment(CatalogModel.self) private var catalog: CatalogModel?
    @Environment(\.playerWindow) private var window

    func body(content: Content) -> some View {
        content
            .focusedSceneValue(
                \.newTuneAction,
                canOpen
                    ? MenuAction(
                        id: ShellActionID.newTune(catalog: catalog.map(ObjectIdentifier.init), window: window), open)
                    : nil
            )
            #if DEBUG
                .opensForSample(.tuneNew, open)
            #endif
    }

    private var canOpen: Bool {
        MenuGates.newTune(sheetsOpen: openSheets?.isCovered == true, selecting: selecting?.isCovered == true)
    }
}

#if os(macOS)
    extension View {
        /// Runs `action` as this view's window closes.
        func onWindowClose(_ action: @escaping @MainActor () -> Void) -> some View {
            background(WindowCloseWatch(onClose: action))
        }
    }

    private struct WindowCloseWatch: NSViewRepresentable {
        let onClose: @MainActor () -> Void

        func makeNSView(context: Context) -> WatchView {
            WatchView(onClose: onClose)
        }

        func updateNSView(_ view: WatchView, context: Context) {
            view.onClose = onClose
        }

        final class WatchView: NSView {
            var onClose: @MainActor () -> Void
            private var observer: NSObjectProtocol?

            init(onClose: @escaping @MainActor () -> Void) {
                self.onClose = onClose
                super.init(frame: .zero)
            }

            @available(*, unavailable)
            required init?(coder: NSCoder) {
                fatalError("init(coder:) is not supported")
            }

            isolated deinit {
                if let observer { NotificationCenter.default.removeObserver(observer) }
            }

            override func viewDidMoveToWindow() {
                super.viewDidMoveToWindow()
                if let observer { NotificationCenter.default.removeObserver(observer) }
                observer = window.map { window in
                    NotificationCenter.default.addObserver(
                        forName: NSWindow.willCloseNotification, object: window, queue: .main
                    ) { [weak self] _ in
                        MainActor.assumeIsolated { self?.onClose() }
                    }
                }
            }
        }
    }
#endif
