import CrosstuneVocabulary
import SwiftUI

/// The top of a tune's page, on the page ground: the key tile in the key's color, the title in
/// the page title role with the tune's other names, Archived when it is, and the verb row. The
/// title renames in place, and the tile opens the key editor.
struct TuneBand: View {
    /// The title's control, named with the title it renames.
    static let rename = "Rename"
    /// The key tile of a tune with no key.
    nonisolated static let addKey = "Add key"

    let model: TuneModel
    let detail: TuneDetail
    /// More's items the screen carries out; nil leaves More off the title's row.
    var more: TuneMoreHandlers?
    /// Opens the lyrics reader; nil leaves Lyrics out of the verbs.
    var onReadLyrics: (() -> Void)?
    /// Hears whether the title is on screen as the page scrolls.
    let onTitleShows: (Bool) -> Void

    @Environment(\.tunePageLeaving) private var leaving
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    /// What the key tile shows.
    enum KeyTileFace: Equatable {
        /// The key and its mode, when the mode is one worth naming.
        case key(String, mode: String?)
        case empty
    }

    nonisolated static func keyTile(_ detail: TuneDetail) -> KeyTileFace {
        guard let keyMode = KeyModeText(key: detail.tune.key, modes: detail.tune.modes) else { return .empty }
        let mode = detail.tune.modes.first.flatMap { KeyModeText.isNamed($0) ? $0 : nil }
        return .key(keyMode.key, mode: mode)
    }

    nonisolated static func keyTileLabel(_ face: KeyTileFace) -> String {
        switch face {
        case .key(let key, let mode): "\(TuneRowText.keyPrefix), \(key)\(mode.map { " \($0)" } ?? "")"
        case .empty: addKey
        }
    }

    /// The tile is smaller beside a phone's title, which has less room to share.
    nonisolated static func keyTileSize(compact: Bool) -> CGFloat {
        compact ? 54 : 64
    }

    /// The title a rename saves: trimmed, and nil when that leaves it empty or unchanged, so an
    /// emptied title restores the stored one.
    nonisolated static func renamed(_ draft: String, from stored: String) -> String? {
        let next = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return next.isEmpty || next == stored ? nil : next
    }

    /// How a rename ends: saved by Return, leaving the field, or the page going, or cancelled
    /// by Escape.
    enum RenameEnd {
        case commit, cancel
    }

    /// The title a rename's end saves, or nil to keep the stored one.
    nonisolated static func renameResult(_ end: RenameEnd, draft: String, stored: String) -> String? {
        end == .commit ? renamed(draft, from: stored) : nil
    }

    private var compact: Bool {
        #if os(iOS)
            sizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TuneBandRow { size in
                KeyTile(model: model, detail: detail, size: size)
            } title: {
                HStack(alignment: .top, spacing: 8) {
                    BandTitle(model: model, title: detail.tune.title, onTitleShows: onTitleShows)
                    if let more, !compact {
                        Spacer(minLength: 0)
                        moreMenu(more)
                    }
                }
                if let alternateTitles = detail.alternateTitles {
                    Text(alternateTitles)
                        .contentMask()
                        .font(PageStyle.secondary)
                        .foregroundStyle(.inkSecondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if detail.isArchived {
                    ArchivedCapsule()
                }
            }
            if let failure = model.failure(at: .screen) {
                FailureText(failure)
            }
            TuneVerbs(detail: detail, playFirst: detail.playFirst, onReadLyrics: onReadLyrics)
                .frame(maxWidth: compact ? .infinity : Self.verbRowMaxWidth, alignment: .leading)
        }
    }

    /// More, centered on the title's first line however many lines the title takes.
    private func moreMenu(_ more: TuneMoreHandlers) -> some View {
        Text(verbatim: " ")
            .bandTitleType()
            .hidden()
            .overlay {
                TuneMoreMenu(model: model, detail: detail, onEditAll: more.editAll, onDelete: more.delete)
                    .menuIndicator(.hidden)
                    .menuStyle(.button)
                    .buttonStyle(PageControlStyle())
                    .fixedSize()
                    .disabled(leaving)
            }
    }

    /// Beside a wide page's content the verbs keep a button's width rather than stretching.
    private static let verbRowMaxWidth: CGFloat = 520
}

/// The band's first line: the key tile's slot with the title beside it. The new-tune draft lays
/// its title out in the same line, so the title stays put as the draft becomes the tune's page.
struct TuneBandRow<Tile: View, Title: View>: View {
    @ViewBuilder let tile: (_ size: CGFloat) -> Tile
    @ViewBuilder let title: () -> Title

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        HStack(alignment: Self.tileAlignment, spacing: 16) {
            tile(TuneBand.keyTileSize(compact: compact))
            VStack(alignment: .leading, spacing: 4) {
                title()
            }
        }
        #if os(macOS)
            .columnTitleBaseline(.page, size: MacStyle.pageTitleSize)
        #endif
    }

    private var compact: Bool {
        #if os(iOS)
            sizeClass == .compact
        #else
            false
        #endif
    }

    #if os(macOS)
        /// Top, so the title's first baseline sits on the column baseline every pane shares,
        /// whatever the tile's height.
        private static var tileAlignment: VerticalAlignment { .top }
    #else
        private static var tileAlignment: VerticalAlignment { .center }
    #endif
}

/// The key as a tile in its pill's colors, or a dashed "+ Key" with none, which opens the key
/// editor anchored on itself.
private struct KeyTile: View {
    let model: TuneModel
    let detail: TuneDetail
    let size: CGFloat

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.focusesKeyTile) private var focusesKeyTile
    @State private var editing = false
    @FocusState private var focused: Bool
    @AccessibilityFocusState private var accessibilityFocused: Bool

    var body: some View {
        let face = TuneBand.keyTile(detail)
        let shape = RoundedRectangle(cornerRadius: size / 4, style: .continuous)
        Button {
            editing = true
        } label: {
            label(face)
                .frame(width: size, height: size)
                .background(background(face), in: shape)
                .overlay {
                    if face == .empty {
                        shape.strokeBorder(
                            Color.primary.opacity(0.25), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                    }
                }
                .contentShape(shape)
        }
        .buttonStyle(KeyTileStyle())
        .accessibilityLabel(TuneBand.keyTileLabel(face))
        // The tile's type does not grow with the text size, so a long press shows it enlarged.
        .accessibilityShowsLargeContentViewer()
        .focused($focused)
        .accessibilityFocused($accessibilityFocused)
        .onAppear {
            guard focusesKeyTile else { return }
            focused = true
            accessibilityFocused = true
        }
        .factEditor(for: .key, detail: detail, isPresented: $editing, label: TuneFieldLabels.key, write: model.write)
    }

    @ViewBuilder private func label(_ face: TuneBand.KeyTileFace) -> some View {
        switch face {
        case .key(let key, let mode):
            VStack(spacing: 0) {
                Text(key)
                    .font(.system(size: size * 0.4, weight: .bold))
                    .tracking(-0.5)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if let mode {
                    Text(mode)
                        .font(.system(size: size * 0.18, weight: .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .padding(.horizontal, 4)
            .foregroundStyle(ink(key))
        case .empty:
            HStack(spacing: 2) {
                Image(systemName: "plus")
                    .font(PageStyle.secondary.weight(.semibold))
                Text(TuneFieldLabels.key)
                    .font(PageStyle.secondary.weight(.medium))
            }
            .lineLimit(1)
            .foregroundStyle(.inkSecondary)
            // The tile's size is fixed, so larger type would wrap the label inside it.
            .dynamicTypeSize(...DynamicTypeSize.large)
        }
    }

    private func swatch(_ key: String) -> KeyColor.Swatch? {
        KeyColor.pitchClass(key).map { KeyColor.swatch(pitchClass: $0, scheme: colorScheme, chosen: false) }
    }

    private func background(_ face: TuneBand.KeyTileFace) -> AnyShapeStyle {
        guard case .key(let key, _) = face else { return AnyShapeStyle(.clear) }
        // A key this build cannot read keeps the tile with the neutral fill rather than a hue.
        return swatch(key).map { AnyShapeStyle($0.background.color) } ?? AnyShapeStyle(Palette.field)
    }

    private func ink(_ key: String) -> AnyShapeStyle {
        swatch(key).map { AnyShapeStyle($0.ink.color) } ?? AnyShapeStyle(.primary)
    }
}

private struct KeyTileStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// The page title, selectable. A tap or click on it turns it into a field, as does the Rename
/// button beside it, which shows on hover or keyboard focus on the Mac and always on touch. Return or leaving
/// saves, Escape restores, and an emptied title restores the stored one rather than saving.
private struct BandTitle: View {
    let model: TuneModel
    let title: String
    let onTitleShows: (Bool) -> Void

    @Environment(\.tunePageLeaving) private var leaving
    /// The title being typed, or nil while it is not being renamed.
    @State private var draft: String?
    @State private var isHovered = false
    @FocusState private var fieldFocused: Bool
    #if os(macOS)
        @FocusState private var renameFocused: Bool
    #endif

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            ZStack(alignment: .topLeading) {
                // Kept under the field, so the bar's watch on the title holds while renaming.
                Text(title)
                    .contentMask()
                    .bandTitleType()
                    .textSelection(.enabled)
                    .accessibilityAddTraits(.isHeader)
                    .onScrollVisibilityChange(threshold: 0.5, onTitleShows)
                    .opacity(draft == nil ? 1 : 0)
                    .onTapGesture { start() }
                if draft != nil {
                    BandTitleField(text: draftText, focused: $fieldFocused, onCommit: { finish(.commit) }) {
                        finish(.cancel)
                    }
                    .onAppear { fieldFocused = true }
                }
            }
            // Absent while the page swaps tunes, since a rename would land on the tune being left.
            if draft == nil, !leaving {
                RenameButton(title: title, action: start)
                    #if os(macOS)
                        // A pointer finds it on the title and the keyboard by focus; touch has no
                        // hover, so it always shows there.
                        .focused($renameFocused)
                        .opacity(isHovered || renameFocused ? 1 : 0.001)
                    #endif
            }
        }
        .onHover { isHovered = $0 }
        .onChange(of: fieldFocused) { _, focused in
            if !focused { finish(.commit) }
        }
        // A rename open as the page goes saves what was typed.
        .onDisappear { finish(.commit) }
    }

    private var draftText: Binding<String> {
        Binding {
            draft ?? ""
        } set: {
            draft = $0
        }
    }

    private func start() {
        guard draft == nil, !leaving else { return }
        draft = title
    }

    private func finish(_ end: TuneBand.RenameEnd) {
        guard let typed = draft else { return }
        draft = nil
        guard let next = TuneBand.renameResult(end, draft: typed, stored: title) else { return }
        model.write { $0.title = next }
    }
}

/// The band's title as a field: the page title's type, wrapping as the heading does, one line
/// however it is typed. Return commits, as does a newline pasted or typed, and Escape cancels.
struct BandTitleField: View {
    let text: Binding<String>
    let focused: FocusState<Bool>.Binding
    let onCommit: () -> Void
    let onCancel: () -> Void

    var body: some View {
        // Vertical, so a long title wraps as the heading it covers does.
        TextField(TuneFieldLabels.title, text: oneLine, axis: .vertical)
            .contentMask()
            .textFieldStyle(.plain)
            .font(PageStyle.pageTitle)
            .tracking(PageStyle.pageTitleTracking)
            .characterLimit(Vocabulary.Limits.Tune.title, text: oneLine)
            .focused(focused)
            .submitLabel(.done)
            .onSubmit(onCommit)
            #if os(macOS)
                .onExitCommand(perform: onCancel)
            #else
                .onKeyPress(.escape) {
                    onCancel()
                    return .handled
                }
            #endif
    }

    /// The text with every newline taken out, since a wrapping field types Return as one; a
    /// newline commits.
    private var oneLine: Binding<String> {
        Binding {
            text.wrappedValue
        } set: { typed in
            guard typed.contains(where: \.isNewline) else {
                text.wrappedValue = typed
                return
            }
            text.wrappedValue = typed.filter { !$0.isNewline }
            onCommit()
        }
    }
}

/// The pencil beside the band's title that turns it into a field.
struct RenameButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(TuneBand.rename, systemImage: "pencil")
                .labelStyle(.iconOnly)
        }
        .buttonStyle(PageControlStyle())
        .accessibilityLabel("\(TuneBand.rename) \(title)")
        #if os(macOS)
            .help(TuneBand.rename)
        #endif
    }
}

extension View {
    /// The band title's type and wrapping, shared by the heading and whatever stands in its place.
    func bandTitleType() -> some View {
        font(PageStyle.pageTitle)
            .tracking(PageStyle.pageTitleTracking)
            .fixedSize(horizontal: false, vertical: true)
    }
}

extension EnvironmentValues {
    /// True on a page that replaces the new-tune draft its tune was made on by Return, whose
    /// key tile then takes focus.
    @Entry var focusesKeyTile = false
}

/// Archived, beside the title: a state the musician chose, so neutral rather than a warning.
private struct ArchivedCapsule: View {
    var body: some View {
        #if os(macOS)
            Text(TuneRowText.archived)
                .macChip(state: .rest, hueInk: Palette.inkSecondary, size: .row)
        #else
            Text(TuneRowText.archived)
                .font(PageStyle.secondary.weight(.medium))
                .foregroundStyle(.inkSecondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(Palette.field, in: .capsule)
        #endif
    }
}
