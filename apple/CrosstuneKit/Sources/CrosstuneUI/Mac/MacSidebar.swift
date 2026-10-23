#if os(macOS)
    import CrosstuneStore
    import CrosstuneVocabulary
    import SwiftUI

    /// The Mac sidebar: the catalog with its statuses under it, Recordings, and Tuner, then the lists,
    /// each with a count, and the record capsule at its foot.
    struct MacSidebar: View {
        /// The shell's selection, whose setter turns a status row into the catalog's filter.
        @Binding var selection: SidebarItem?
        /// Nil until the first read.
        let lists: [ListSummary]?
        let counts: CatalogCounts?
        let canRecord: Bool
        let onRecord: @MainActor () -> Void
        let newList: () -> Void

        @Environment(\.listSheets) private var listSheets
        @State private var deleting: ListSummary?

        var body: some View {
            ScrollViewReader { proxy in
                list
                    // The shell rebuilds the sidebar as it moves to or from the Tuner's layout, so
                    // the chosen row is brought back into view, a hop later, once its rows exist.
                    .onAppear {
                        guard let target = selection.map(Self.scrollTarget) else { return }
                        Task { proxy.scrollTo(target) }
                    }
            }
        }

        /// The identity the sidebar's rows go by for `selection`: a list row is known by its
        /// list's id, every other row by the item itself.
        nonisolated static func scrollTarget(_ selection: SidebarItem) -> AnyHashable {
            if case .list(let id) = selection { return id }
            return selection
        }

        private var list: some View {
            List(selection: $selection) {
                Section {
                    ForEach(Self.destinationRows(statuses: Vocabulary.statuses), id: \.self) { item in
                        destinationRow(item)
                    }
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
            .background(Palette.surface)
            .statusRingOnFill()
            .safeAreaBar(edge: .bottom) {
                SidebarRecordButton(action: onRecord)
                    .disabled(!canRecord)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, SidebarRecordButton.rowInset)
                    .padding(.vertical, 12)
            }
            .confirmsListDelete($deleting)
        }

        /// The first section's rows, in order: the catalog with its statuses under it, then the
        /// destinations that are not the catalog.
        static func destinationRows(statuses: [String]) -> [SidebarItem] {
            [.catalog] + statuses.map(SidebarItem.status) + [.recordings, .tuner]
        }

        @ViewBuilder private func destinationRow(_ item: SidebarItem) -> some View {
            switch item {
            case .status(let status):
                row(item, StatusStyle.label(status), glyph: .status(status), count: counts?.byStatus[status])
            case .catalog:
                destinationRow(item, .catalog, count: counts?.catalog)
            case .recordings:
                destinationRow(item, .recordings, count: counts?.recordings)
            case .tuner:
                destinationRow(item, .tuner, count: nil)
            case .list:
                EmptyView()
            }
        }

        private func destinationRow(_ item: SidebarItem, _ destination: Destination, count: Int?) -> some View {
            row(item, destination.title, glyph: .symbol(destination.systemImage), count: count)
        }

        private var newListButton: some View {
            Button(SidebarItem.newList, systemImage: "plus", action: newList)
                .disabled(listSheets == nil)
        }

        private func row(
            _ item: SidebarItem, _ title: String, glyph: MacSidebarLabel.Glyph, count: Int?
        ) -> some View {
            MacSidebarLabel(title: title, glyph: glyph)
                .macRowSelected(selection == item)
                .badge(count.flatMap { $0 > 0 ? Text($0, format: .number).monospacedDigit() : nil })
                // Outermost: a tag under the badge leaves the row never drawn as selected.
                .tag(item)
        }
    }

    /// A sidebar row's glyph and name. A glyph is secondary ink at rest and white with the name
    /// on the key window's selection. A status's glyph keeps its status color at rest and turns
    /// white there too, through ``StatusGlyph``.
    struct MacSidebarLabel: View {
        enum Glyph: Equatable {
            case symbol(String)
            case status(String)
        }

        let title: String
        let glyph: Glyph

        /// Increased on the selected row of the key window, whose fill is the accent.
        @Environment(\.backgroundProminence) private var prominence

        /// What a Mac sidebar list adds above and below each row's content.
        nonisolated static let listRowPadding: CGFloat = 8

        /// A symbol glyph's color: secondary ink at rest, the label on an accent fill once the
        /// row's selection is emphasized.
        nonisolated static func symbolInk(emphasized: Bool) -> Palette.Token {
            emphasized ? .onAccentFill : .inkSecondary
        }

        var body: some View {
            Label {
                Text(title)
                    .font(MacStyle.body)
                    .lineLimit(1)
            } icon: {
                switch glyph {
                case .symbol(let name):
                    Image(systemName: name)
                        .foregroundStyle(
                            Self.symbolInk(emphasized: prominence == .increased) == .onAccentFill
                                ? Palette.onAccentFill : Palette.inkSecondary)
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
