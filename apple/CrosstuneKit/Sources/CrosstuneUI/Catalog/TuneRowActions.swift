import SwiftUI

/// The verbs a tune row offers, on every screen that offers them.
public enum TuneRowActions {
    public static let edit = "Edit"
    public static let archive = "Archive"
    public static let unarchive = "Unarchive"
    public static let select = "Select"
    public static let editSystemImage = "square.and.pencil"
    public static let scans = ScanCopy.scans
    public static let scansSystemImage = "music.quarternote.3"

    public static func archiveLabel(archived: Bool) -> String {
        archived ? unarchive : archive
    }

    public static func archiveSystemImage(archived: Bool) -> String {
        archived ? "archivebox.fill" : "archivebox"
    }

    /// The row's Scans action, which opens the viewer at the first scan, or nil when the tune
    /// has no live scan to show.
    static func scansAction(
        tuneID: String, tunesWithScans: Set<String>, open: @escaping @MainActor (String) -> Void
    ) -> (@MainActor () -> Void)? {
        tunesWithScans.contains(tuneID) ? { @MainActor in open(tuneID) } : nil
    }

    /// The row's Scans action from what the shell supplies, nil outside it. `origin` is where
    /// the look at the scans is logged as opened from.
    @MainActor
    static func scansAction(
        tuneID: String, tunesWithScans: ScanTunes?, origin: ScanViewOrigin, actions: TuneScreenActions
    ) -> (@MainActor () -> Void)? {
        guard let tunesWithScans, let view = actions.viewScans else { return nil }
        return scansAction(tuneID: tuneID, tunesWithScans: tunesWithScans.ids) { view($0, 0, origin) }
    }
}

/// The Scans action as a row's swipe action or menu item.
struct ScansRowAction: View {
    let action: @MainActor () -> Void

    var body: some View {
        Button(TuneRowActions.scans, systemImage: TuneRowActions.scansSystemImage, action: action)
            .tint(.indigo)
    }
}

extension View {
    /// Gives a catalog row its actions: Edit and Archive as trailing swipe actions and as context
    /// menu items, the menu with a preview of the tune. `onScans` adds Scans to both, for a
    /// tune with scans. `onSelect` adds Select to the menu, which enters selection with this row.
    /// A row that is selecting has none of them.
    @ViewBuilder
    func catalogRowActions(
        _ entry: CatalogEntry, instruments: Set<String>, isSelecting: Bool = false, onEdit: @escaping () -> Void,
        onArchive: @escaping () -> Void, onScans: (@MainActor () -> Void)? = nil, onSelect: (() -> Void)? = nil
    ) -> some View {
        let archived = entry.isArchived
        if isSelecting {
            self
        } else {
            self
                // A long swipe only reveals the actions: SwiftUI's full swipe would run the edge action,
                // and no swipe acts on its own.
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    // The first action sits at the trailing edge, so Edit reads first from the left.
                    Button(
                        TuneRowActions.archiveLabel(archived: archived),
                        systemImage: TuneRowActions.archiveSystemImage(archived: archived), action: onArchive
                    )
                    .tint(.orange)
                    Button(TuneRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: onEdit)
                        .tint(.gray)
                    if let onScans { ScansRowAction(action: onScans) }
                }
                .contextMenu {
                    if let onScans { ScansRowAction(action: onScans) }
                    Button(TuneRowActions.edit, systemImage: TuneRowActions.editSystemImage, action: onEdit)
                    Button(
                        TuneRowActions.archiveLabel(archived: archived),
                        systemImage: TuneRowActions.archiveSystemImage(archived: archived), action: onArchive)
                    if let onSelect {
                        Divider()
                        Button(TuneRowActions.select, systemImage: "checkmark.circle", action: onSelect)
                    }
                } preview: {
                    TunePreview(entry: entry, instruments: instruments)
                }
        }
    }
}

/// A tune at a glance, for a context menu's preview: its title and every facet it holds.
struct TunePreview: View {
    let entry: CatalogEntry
    let instruments: Set<String>

    @Environment(\.spacing) private var spacing

    var body: some View {
        let text = TuneRowText(tune: entry.tune, userTune: entry.userTune, instruments: instruments)
        VStack(alignment: .leading, spacing: spacing(12)) {
            Text(entry.tune.title)
                .font(.title3.weight(.semibold))
            FlowLayout {
                if let key = text.key {
                    KeyPill(key.key, suffix: key.suffix)
                }
                HStack(spacing: 6) {
                    // The word beside it names the status.
                    StatusGlyph(text.status).accessibilityHidden(true)
                    Text(StatusStyle.label(text.status)).lineLimit(1)
                }
                .fixedSize()
                ForEach(Array(details.enumerated()), id: \.offset) { Text($0.element) }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(width: 320, alignment: .leading)
    }

    private var details: [String] {
        let tune = entry.tune
        var parts = [tune.tuneType, tune.genre, tune.composer].compactMap { $0 }
        if let tunings = TuningText.row(tune.tunings, instruments: instruments) { parts.append(tunings) }
        if entry.isArchived { parts.append(TuneRowText.archived) }
        return parts
    }
}
