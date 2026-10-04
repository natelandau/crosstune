import CrosstuneStore
import SwiftUI

/// A tune's scans on its screen: a row of scan thumbnails that open the viewer, and in
/// edit mode a row per scan to reorder and delete. The header's add control offers the ways this
/// device adds scans; the screen presents what it chooses.
struct ScansSection: View {
    static let thumbnailHeight: CGFloat = 120
    static let rowThumbnailHeight: CGFloat = 44

    /// Opens the viewer on the scan at `index`, logged as opened from the tune screen.
    @MainActor
    static func open(tuneID: String, index: Int, actions: TuneScreenActions) {
        actions.viewScans?(tuneID, index, .tune)
    }

    let model: ScansModel
    let tuneID: String
    @Binding var adding: ScanAddChoice?
    @Binding var deleting: Scan?

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.spacing) private var spacing
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var editing = false

    var body: some View {
        let scans = model.scans
        let layout = model.layout
        Section {
            if layout.showsEmptyState {
                ContentUnavailableView {
                    Label(ScanCopy.emptyTitle, systemImage: TuneRowActions.scansSystemImage)
                } description: {
                    Text(ScanCopy.emptyHint)
                }
            } else if editing {
                ForEach(Array(scans.enumerated()), id: \.element.id) { index, scan in
                    editRow(scan, index: index, count: scans.count)
                        .scaledRowInsets()
                }
                .onMove { indices, offset in
                    guard indices.count == 1, let from = indices.first else { return }
                    model.move(from: from, to: MovePlace.dropTarget(from: from, offset: offset))
                }
            } else {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: spacing(12)) {
                        ForEach(Array(scans.enumerated()), id: \.element.id) { index, scan in
                            tile(scan, index: index)
                        }
                    }
                    .padding(.vertical, spacing(4))
                }
                .scrollIndicators(.hidden)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(ScanCopy.scans)
            }
        } header: {
            SectionTitle(ScanCopy.scans) {
                HStack(spacing: spacing(4)) {
                    if layout.showsEdit {
                        Button(editing ? ScanCopy.done : ScanCopy.edit) { editing.toggle() }
                            .font(.body)
                            .accessibilityLabel(editing ? ScanCopy.doneEditingScans : ScanCopy.editScans)
                    }
                    ScanAddMenu(isEnabled: layout.canAdd && !model.isAdding, choice: $adding)
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

    private func tile(_ scan: Scan, index: Int) -> some View {
        let status = ScanCopy.status(for: scan)
        let width = Self.thumbnailHeight * scan.aspectRatio
        return VStack(alignment: .leading, spacing: spacing(4)) {
            Button {
                Self.open(tuneID: tuneID, index: index, actions: actions)
            } label: {
                ScanThumbnail(scan: scan, index: index, height: Self.thumbnailHeight)
                    .clipShape(.rect(cornerRadius: 6))
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(actions.viewScans == nil)
            .accessibilityLabel(ScanCopy.openScan(index))
            .accessibilityHint(status ?? "")
            if let status {
                Text(status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityHidden(true)
            }
        }
        // A note under a narrow scan widens its column rather than standing one word to a line.
        .frame(width: status == nil ? width : max(width, 128), alignment: .leading)
    }

    private func editRow(_ scan: Scan, index: Int, count: Int) -> some View {
        let status = ScanCopy.status(for: scan)
        let reorderable = count > 1
        return HStack(spacing: spacing(12)) {
            ScanThumbnail(scan: scan, index: index, height: Self.rowThumbnailHeight)
                .clipShape(.rect(cornerRadius: 4))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: spacing.rowLineGap) {
                Text(ScanCopy.scan(index))
                if let status {
                    Text(status)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(role: .destructive) {
                deleting = scan
            } label: {
                Label(ScanCopy.deleteScan(index), systemImage: "trash")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.red)
                    .frame(minWidth: minimumTapTarget)
                    .tapTarget()
            }
            .buttonStyle(.borderless)
            if reorderable {
                moveMenu(scan, index: index)
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
    private func moveMenu(_ scan: Scan, index: Int) -> some View {
        Menu {
            Section(ScanCopy.moveScan(index)) {
                ForEach(model.places(for: scan), id: \.self) { place in
                    Button(place.label, systemImage: place.systemImage) { model.move(scan, to: place) }
                }
            }
        } label: {
            Label(ScanCopy.reorderScan(index), systemImage: "arrow.up.arrow.down")
                .labelStyle(.iconOnly)
                .foregroundStyle(.tint)
                .frame(minWidth: minimumTapTarget)
                .tapTarget()
        }
        .menuIndicator(.hidden)
        .buttonStyle(.borderless)
    }
}
