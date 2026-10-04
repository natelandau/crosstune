import CrosstuneStore
import SwiftUI

/// A tune's written music on its screen: a row of page thumbnails that open the viewer, and in
/// edit mode a row per page to reorder and delete. The header's add control offers the ways this
/// device adds pages; the screen presents what it chooses.
struct NotationSection: View {
    static let thumbnailHeight: CGFloat = 120
    static let rowThumbnailHeight: CGFloat = 44

    let model: NotationModel
    let tuneID: String
    @Binding var adding: NotationAddChoice?
    @Binding var deleting: NotationPage?

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.spacing) private var spacing
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var editing = false

    var body: some View {
        let pages = model.pages
        let layout = model.layout
        Section {
            if layout.showsEmptyState {
                ContentUnavailableView {
                    Label(NotationCopy.emptyTitle, systemImage: TuneRowActions.notationSystemImage)
                } description: {
                    Text(NotationCopy.emptyHint)
                }
            } else if editing {
                ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                    editRow(page, index: index, count: pages.count)
                        .scaledRowInsets()
                }
                .onMove { indices, offset in
                    guard indices.count == 1, let from = indices.first else { return }
                    model.move(from: from, to: MovePlace.dropTarget(from: from, offset: offset))
                }
            } else {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: spacing(12)) {
                        ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                            tile(page, index: index)
                        }
                    }
                    .padding(.vertical, spacing(4))
                }
                .scrollIndicators(.hidden)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(NotationCopy.notation)
            }
        } header: {
            SectionTitle(NotationCopy.notation) {
                HStack(spacing: spacing(4)) {
                    if layout.showsEdit {
                        Button(editing ? NotationCopy.done : NotationCopy.edit) { editing.toggle() }
                            .font(.body)
                            .accessibilityLabel(editing ? NotationCopy.doneEditingNotation : NotationCopy.editNotation)
                    }
                    NotationAddMenu(isEnabled: layout.canAdd && !model.isAdding, choice: $adding)
                }
            }
            .onChange(of: layout.showsEdit) { _, shows in
                if !shows { editing = false }
            }
        } footer: {
            if let failure = model.failure {
                FailureText(failure)
            } else if let note = layout.limitNote {
                Text(note)
            }
        }
        .headerProminence(.increased)
    }

    private func tile(_ page: NotationPage, index: Int) -> some View {
        let status = NotationCopy.status(for: page)
        let width = Self.thumbnailHeight * page.aspectRatio
        return VStack(alignment: .leading, spacing: spacing(4)) {
            Button {
                actions.viewNotation?(tuneID, index)
            } label: {
                NotationThumbnail(page: page, index: index, height: Self.thumbnailHeight)
                    .clipShape(.rect(cornerRadius: 6))
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(actions.viewNotation == nil)
            .accessibilityLabel(NotationCopy.openPage(index))
            .accessibilityHint(status ?? "")
            if let status {
                Text(status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityHidden(true)
            }
        }
        // A note under a narrow page widens its column rather than standing one word to a line.
        .frame(width: status == nil ? width : max(width, 128), alignment: .leading)
    }

    private func editRow(_ page: NotationPage, index: Int, count: Int) -> some View {
        let status = NotationCopy.status(for: page)
        let reorderable = count > 1
        return HStack(spacing: spacing(12)) {
            NotationThumbnail(page: page, index: index, height: Self.rowThumbnailHeight)
                .clipShape(.rect(cornerRadius: 4))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: spacing.rowLineGap) {
                Text(NotationCopy.page(index))
                if let status {
                    Text(status)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(role: .destructive) {
                deleting = page
            } label: {
                Label(NotationCopy.deletePage(index), systemImage: "trash")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.red)
                    .frame(minWidth: minimumTapTarget)
                    .tapTarget()
            }
            .buttonStyle(.borderless)
            if reorderable {
                moveMenu(page, index: index)
                // Dragging works anywhere on the row; the grip only shows that it can.
                if !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: "line.3.horizontal")
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
            }
        }
        .moveDisabled(!reorderable)
    }

    /// The drag's visible and spoken equivalent, as a list row's move button is.
    private func moveMenu(_ page: NotationPage, index: Int) -> some View {
        Menu {
            Section(NotationCopy.movePage(index)) {
                ForEach(model.places(for: page), id: \.self) { place in
                    Button(place.label, systemImage: place.systemImage) { model.move(page, to: place) }
                }
            }
        } label: {
            Label(NotationCopy.reorderPage(index), systemImage: "arrow.up.arrow.down")
                .labelStyle(.iconOnly)
                .foregroundStyle(.tint)
                .frame(minWidth: minimumTapTarget)
                .tapTarget()
        }
        .menuIndicator(.hidden)
        .buttonStyle(.borderless)
    }
}
