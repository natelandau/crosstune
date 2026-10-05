#if os(macOS)
    import CrosstuneStore
    import CrosstuneVocabulary
    import SwiftUI

    /// The Mac sidebar: the catalog with its statuses under it and Recordings, then the lists,
    /// each with a count, and the record capsule at its foot.
    struct MacSidebar: View {
        /// The shell's selection, whose setter turns a status row into the catalog's filter.
        @Binding var selection: SidebarItem?
        /// Nil until the first read.
        let lists: [ListSummary]?
        let counts: SidebarCounts?
        let canRecord: Bool
        let onRecord: @MainActor () -> Void
        let newList: () -> Void

        @Environment(\.listSheets) private var listSheets
        @Environment(\.colorScheme) private var scheme
        @State private var deleting: ListSummary?

        var body: some View {
            List(selection: $selection) {
                Section {
                    row(
                        .catalog, Destination.catalog.title, glyph: .symbol(Destination.catalog.systemImage),
                        count: counts?.catalog)
                    ForEach(Vocabulary.statuses, id: \.self) { status in
                        row(
                            .status(status), StatusStyle.label(status), glyph: .status(status),
                            count: counts?.byStatus[status])
                    }
                    row(
                        .recordings, Destination.recordings.title,
                        glyph: .symbol(Destination.recordings.systemImage), count: counts?.recordings)
                }
                Section {
                    ForEach(lists ?? []) { list in
                        row(
                            .list(id: list.id), list.name, glyph: .symbol(Destination.lists.systemImage),
                            count: list.count
                        )
                        .listRowActions(
                            onEdit: { listSheets?.name(.rename(listID: list.id, name: list.name)) },
                            onDelete: { deleting = list })
                    }
                } header: {
                    SidebarSectionHeader(Destination.lists.title, add: SidebarItem.newList, onAdd: newList)
                        .disabled(listSheets == nil)
                        .contextMenu { newListButton }
                }
            }
            // Right-clicking the sidebar's empty space starts a list; a list row keeps its own menu.
            .contextMenu(forSelectionType: SidebarItem.self) { items in
                if items.isEmpty { newListButton }
            }
            .environment(\.defaultMinListRowHeight, MacStyle.sidebarRowHeight)
            .scrollContentBackground(.hidden)
            .background(MacStyle.sidebarTint(scheme))
            .safeAreaBar(edge: .bottom) {
                SidebarRecordButton(action: onRecord)
                    .disabled(!canRecord)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
            .confirmsListDelete($deleting)
        }

        private var newListButton: some View {
            Button(SidebarItem.newList, systemImage: "plus", action: newList)
                .disabled(listSheets == nil)
        }

        private func row(
            _ item: SidebarItem, _ title: String, glyph: MacSidebarLabel.Glyph, count: Int?
        ) -> some View {
            MacSidebarLabel(title: title, glyph: glyph, isSelected: selection == item)
                .badge(count ?? 0)
                // Outermost: a tag under the badge leaves the row never drawn as selected.
                .tag(item)
        }
    }

    /// A sidebar row's glyph and name. The selected row's glyph turns coral, except a status's,
    /// whose color is its meaning.
    struct MacSidebarLabel: View {
        enum Glyph: Equatable {
            case symbol(String)
            case status(String)
        }

        let title: String
        let glyph: Glyph
        let isSelected: Bool

        /// What a Mac sidebar list adds above and below each row's content.
        nonisolated static let listRowPadding: CGFloat = 8

        var body: some View {
            Label {
                Text(title)
                    .font(MacStyle.body)
                    .lineLimit(1)
            } icon: {
                switch glyph {
                case .symbol(let name):
                    Image(systemName: name)
                        .foregroundStyle(isSelected ? AnyShapeStyle(MacStyle.coral) : AnyShapeStyle(.tint))
                case .status(let status):
                    // The row's name already says the status.
                    StatusGlyph(status)
                        .accessibilityHidden(true)
                }
            }
            .padding(.leading, glyph.isStatus ? MacStyle.sidebarStatusIndent : 0)
            .frame(minHeight: MacStyle.sidebarRowHeight - Self.listRowPadding)
        }
    }

    extension MacSidebarLabel.Glyph {
        var isStatus: Bool {
            if case .status = self { return true }
            return false
        }
    }
#endif
