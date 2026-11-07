import CrosstuneAnalytics
import CrosstuneDesign
import SwiftUI

/// One in-place edit of an attribute: the value the editor opened on, the draft typed or picked since,
/// and the one save it may make.
struct AttributeEditSession<Value: Equatable> {
    /// How an edit ends. Every ending saves the draft but Escape, so typed text is never thrown
    /// away silently.
    enum Ending: CaseIterable {
        case picked
        /// A click outside the popover.
        case dismissed
        case done
        case swipedDown
        /// The editor went away with no dismissal, as when the detail column swaps tunes.
        case unmounted
        case escaped

        var saves: Bool { self != .escaped }

        /// How the editor left when nothing ended it first: still presented means the page took
        /// it away rather than a dismissal.
        static func leaving(stillPresented: Bool, asSheet: Bool) -> Self {
            if stillPresented { return .unmounted }
            return asSheet ? .swipedDown : .dismissed
        }
    }

    var draft: Value
    /// The value the editor opened on, or the last one it saved while staying open.
    private(set) var stored: Value
    /// Set by the first ending, so the dismissal that follows a pick, Done, or Escape saves
    /// nothing more.
    private(set) var isEnded = false
    private let normalize: (Value) -> Value

    init(stored: Value, normalize: @escaping (Value) -> Value = { $0 }) {
        self.stored = stored
        self.normalize = normalize
        draft = stored
    }

    /// Ends the edit. The value to save, normalized; nil when the ending discards, the draft
    /// matches the stored value, or the edit has already ended.
    mutating func end(_ how: Ending) -> Value? {
        guard !isEnded else { return nil }
        isEnded = true
        guard how.saves else { return nil }
        let value = normalize(draft)
        return value == normalize(stored) ? nil : value
    }

    /// Saves `value` with the editor left open, for a choice that writes while the rest of the
    /// attribute is still being set. The value to save, normalized; nil when it matches the stored
    /// value or the edit has ended. Either way it becomes the stored value, so a later ending
    /// compares against what was saved, and changing it back saves again.
    mutating func save(_ value: Value) -> Value? {
        guard !isEnded else { return nil }
        draft = value
        let normalized = normalize(value)
        defer { stored = value }
        return normalized == normalize(stored) ? nil : normalized
    }

    /// Ends the edit, taking `picked` as the draft when given, and hands a value to save to
    /// `commit`. The editor ends every way through here, so a later ending commits nothing.
    mutating func end(_ how: Ending, picked: Value? = nil, commit: (Value) -> Void) {
        if let picked { draft = picked }
        if let value = end(how) { commit(value) }
    }
}

extension AttributeEditSession where Value == String {
    /// A typed attribute, compared and saved after the trim the tune form applies.
    static func text(_ stored: String) -> Self {
        Self(stored: stored) { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    }
}

/// Which attribute row's editor is open. A key names the row's owner and the layout too, so a row
/// on another tune or recording, or the same attribute drawn in the other layout, never takes the
/// editor.
struct AttributesOpenState: Equatable {
    struct Key: Hashable {
        let owner: String
        let layout: AttributesLayout
        let id: AnyHashable
    }

    private var open: Key?

    func isPresented(_ key: Key) -> Bool { open == key }

    /// Whether `key`'s editor is open, for a binding that opens and closes it.
    subscript(key: Key) -> Bool {
        get { isPresented(key) }
        set { set(key, shown: newValue) }
    }

    /// Opens `key`'s editor, or closes it; closing another row leaves the open one alone.
    mutating func set(_ key: Key, shown: Bool) {
        if shown {
            open = key
        } else if open == key {
            open = nil
        }
    }

    /// Closes the editor when the attributes show another owner or another layout, so a return to
    /// the owner or the layout never reopens it.
    mutating func keep(owner: String, layout: AttributesLayout) {
        guard let open, open.owner != owner || open.layout != layout else { return }
        self.open = nil
    }
}

/// How an attribute's editor shows: a popover at the row, or a sheet where the window is compact.
enum AttributeEditorPresentation {
    /// A compact width takes the sheet, and so does a compact height, which only a phone in
    /// landscape has, so a phone takes the sheet even at a regular width.
    static func presentsAsSheet(compactWidth: Bool, compactHeight: Bool) -> Bool {
        compactWidth || compactHeight
    }
}

/// What an editor's body works with: the draft, the focus its first field takes, and the ways
/// it ends the edit.
struct AttributeEditorControls<Value: Equatable> {
    let draft: Binding<Value>
    /// Bind the first field's focus to it, so the field takes focus as the editor opens.
    let firstField: FocusState<Bool>.Binding
    fileprivate let finish: (_ how: AttributeEditSession<Value>.Ending, _ picked: Value?) -> Void
    fileprivate let stay: (Value) -> Void

    /// Saves `value` and closes, for a choice from a closed vocabulary or a suggestion.
    func pick(_ value: Value) { finish(.picked, value) }

    /// Saves `value` and leaves the editor open, for a choice such as a key or a capo
    /// instrument's tuning, where more of the attribute is still to set.
    func save(_ value: Value) { stay(value) }

    /// Saves the draft and closes, for Enter in a text field.
    func done() { finish(.done, nil) }
}

extension View {
    /// Edits one attribute in place: a popover at this view on the Mac and in a regular-width iPad
    /// column, a part-height sheet with Done on the iPhone and in a compact iPad column. Every
    /// way it closes saves the draft (a pick, Enter, Done, a click outside, a swipe down, the
    /// window losing focus, or the editor going away with the page); only Escape, in the popover
    /// or the sheet, discards it.
    ///
    /// - Parameters:
    ///   - label: The attribute's label: the sheet's title and the popover's accessible name.
    ///   - session: The edit to start each time the editor opens. A size-class change while it
    ///     is open saves the draft as `.unmounted` and reopens on this value, so build it from
    ///     the model's current stored value rather than one captured earlier.
    ///   - onCommit: Runs at most once per opening, with the normalized value when it changed.
    func attributeEditor<Value: Equatable, Body: View>(
        isPresented: Binding<Bool>,
        anchor: PopoverAttachmentAnchor = .rect(.bounds),
        label: String,
        session: AttributeEditSession<Value>,
        onCommit: @escaping (Value) -> Void,
        @ViewBuilder content: @escaping (AttributeEditorControls<Value>) -> Body
    ) -> some View {
        modifier(
            AttributeEditorPresenter(
                isPresented: isPresented, anchor: anchor, label: label, session: session, onCommit: onCommit,
                editorBody: content))
    }
}

private struct AttributeEditorPresenter<Value: Equatable, Body: View>: ViewModifier {
    @Binding var isPresented: Bool
    let anchor: PopoverAttachmentAnchor
    let label: String
    let session: AttributeEditSession<Value>
    let onCommit: (Value) -> Void
    let editorBody: (AttributeEditorControls<Value>) -> Body

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        @Environment(\.verticalSizeClass) private var verticalSizeClass
        private var asSheet: Bool {
            AttributeEditorPresentation.presentsAsSheet(
                compactWidth: sizeClass == .compact, compactHeight: verticalSizeClass == .compact)
        }
    #else
        private var asSheet: Bool { false }
    #endif

    func body(content: Content) -> some View {
        // Both presentations stay attached, gated by `asSheet`, so the row keeps its identity as the
        // column changes size class.
        content
            .popover(isPresented: shown(!asSheet), attachmentAnchor: anchor, arrowEdge: PageStyle.popoverArrowEdge) {
                AttributeEditorSurface(
                    style: .popover, isPresented: $isPresented, label: label, session: session, onCommit: onCommit,
                    editorBody: editorBody
                )
                .presentationCompactAdaptation(.popover)
            }
            .sheet(isPresented: shown(asSheet)) {
                AttributeEditorSurface(
                    style: .sheet, isPresented: $isPresented, label: label, session: session, onCommit: onCommit,
                    editorBody: editorBody)
            }
    }

    private func shown(_ here: Bool) -> Binding<Bool> {
        Binding {
            here && isPresented
        } set: {
            if here { isPresented = $0 }
        }
    }
}

/// The editor's root, which holds the session for one opening. A fresh opening builds a fresh
/// surface, so each opening commits at most once.
private struct AttributeEditorSurface<Value: Equatable, Body: View>: View {
    enum Style {
        case popover
        case sheet
    }

    let style: Style
    @Binding var isPresented: Bool
    let label: String
    let onCommit: (Value) -> Void
    let editorBody: (AttributeEditorControls<Value>) -> Body

    @State private var session: AttributeEditSession<Value>
    @FocusState private var firstFieldFocused: Bool

    init(
        style: Style, isPresented: Binding<Bool>, label: String, session: AttributeEditSession<Value>,
        onCommit: @escaping (Value) -> Void, editorBody: @escaping (AttributeEditorControls<Value>) -> Body
    ) {
        self.style = style
        _isPresented = isPresented
        self.label = label
        self.onCommit = onCommit
        self.editorBody = editorBody
        _session = State(initialValue: session)
    }

    var body: some View {
        surface
            .defaultFocus($firstFieldFocused, true)
            .onAppear { firstFieldFocused = true }
            // Every way the editor leaves ends here, the explicit endings included; those have
            // already ended the session, so this one saves only a draft nothing else ended.
            .onDisappear {
                session.end(.leaving(stillPresented: isPresented, asSheet: style == .sheet), commit: onCommit)
            }
            .onKeyPress(.escape, phases: .down) { _ in
                finish(.escaped)
                return .handled
            }
            #if os(macOS)
                // Escape can reach the window as its cancel command rather than as a key press.
                .onExitCommand { finish(.escaped) }
            #endif
    }

    @ViewBuilder private var surface: some View {
        switch style {
        case .popover:
            editor
                .padding(Self.padding)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(label)
        case .sheet:
            NavigationStack {
                sheetContent
                    .navigationTitle(label)
                    #if os(iOS)
                        .navigationBarTitleDisplayMode(.inline)
                    #endif
                    .toolbar {
                        ConfirmToolbarItem {
                            Button(AttributeCopy.done) { finish(.done) }
                        }
                    }
            }
            .partHeightSheet()
        }
    }

    /// On the Mac a sheet sizes to its content, which a scroll view would collapse.
    @ViewBuilder private var sheetContent: some View {
        #if os(macOS)
            editor.padding(Self.padding)
        #else
            ScrollView { editor.padding(Self.padding) }
        #endif
    }

    private var editor: some View {
        editorBody(
            AttributeEditorControls(
                draft: $session.draft, firstField: $firstFieldFocused, finish: finish, stay: stay)
        )
        .contentMask()
    }

    #if os(macOS)
        private static var padding: CGFloat { 12 }
    #else
        private static var padding: CGFloat { 14 }
    #endif

    private func stay(_ value: Value) {
        if let saved = session.save(value) { onCommit(saved) }
    }

    /// Ends the edit and closes; the disappearance that follows finds the session ended.
    private func finish(_ how: AttributeEditSession<Value>.Ending, picked: Value? = nil) {
        session.end(how, picked: picked, commit: onCommit)
        isPresented = false
    }
}
