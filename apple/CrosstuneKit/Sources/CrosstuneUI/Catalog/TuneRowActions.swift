import SwiftUI

/// The verbs a tune row offers, on every screen that offers them.
public enum TuneRowActions {
    public static let edit = "Edit"
    public static let archive = "Archive"
    public static let unarchive = "Unarchive"
    public static let select = "Select"
    public static let editSystemImage = "square.and.pencil"

    public static func archiveLabel(archived: Bool) -> String {
        archived ? unarchive : archive
    }

    public static func archiveSystemImage(archived: Bool) -> String {
        archived ? "archivebox.fill" : "archivebox"
    }
}

extension View {
    /// Gives a catalog row its actions: Edit and Archive as trailing swipe actions and as context
    /// menu items, the menu with a preview of the tune. `onSelect` adds Select to the menu, which
    /// enters selection with this row. A row that is selecting has none of them.
    @ViewBuilder
    func catalogRowActions(
        _ entry: CatalogEntry, instruments: Set<String>, isSelecting: Bool = false, onEdit: @escaping () -> Void,
        onArchive: @escaping () -> Void, onSelect: (() -> Void)? = nil
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
                }
                .contextMenu {
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

    var body: some View {
        let text = TuneRowText(tune: entry.tune, userTune: entry.userTune, instruments: instruments)
        VStack(alignment: .leading, spacing: 12) {
            Text(entry.tune.title)
                .font(.title3.weight(.semibold))
            FlowLayout {
                if let key = text.key {
                    KeyPill(key.key, suffix: key.suffix)
                }
                StatusDot(text.status)
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
