import CrosstuneStore
import SwiftUI

/// A tune's scans on its screen: a row of scan thumbnails that open the viewer, and in
/// edit mode a row per scan to reorder and delete. The header's add control offers the ways this
/// device adds scans; the screen presents what it chooses. The Mac's tune page draws its own
/// section from the same thumbnails.
struct ScansSection {
    static let thumbnailHeight: CGFloat = 120
    static let rowThumbnailHeight: CGFloat = 44

    /// Opens the viewer on the scan at `index`, logged as opened from the tune screen.
    @MainActor
    static func open(tuneID: String, index: Int, actions: TuneScreenActions) {
        actions.viewScans?(tuneID, index, .tune)
    }

    #if os(iOS)
        let model: ScansModel
        let tuneID: String
        @Binding var adding: ScanAddChoice?
        @Binding var deleting: Scan?

        @State private var editing = false
    #endif
}

#if os(iOS)
    extension ScansSection: View {
        var body: some View {
            let layout = model.layout
            Section {
                if layout.showsEmptyState {
                    ContentUnavailableView {
                        Label(ScanCopy.emptyTitle, systemImage: TuneRowActions.scansSystemImage)
                    } description: {
                        Text(ScanCopy.emptyHint)
                    }
                } else if editing {
                    ScanEditRows(model: model, deleting: $deleting)
                } else {
                    ScanStrip(model: model, tuneID: tuneID)
                }
            } header: {
                SectionTitle(ScanCopy.scans) {
                    ScanHeaderControls(model: model, editing: $editing, adding: $adding)
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
    }
#endif

/// The Scans header's controls: Edit or Done once there is a scan to act on, then add.
struct ScanHeaderControls: View {
    let model: ScansModel
    @Binding var editing: Bool
    @Binding var adding: ScanAddChoice?

    @Environment(\.spacing) private var spacing

    var body: some View {
        let layout = model.layout
        HStack(spacing: spacing(4)) {
            if layout.showsEdit {
                Button(editing ? ScanCopy.done : ScanCopy.edit) { editing.toggle() }
                    .font(.body)
                    .accessibilityLabel(editing ? ScanCopy.doneEditingScans : ScanCopy.editScans)
            }
            ScanAddMenu(isEnabled: layout.canAdd && !model.isAdding, choice: $adding)
        }
        .onChange(of: layout.showsEdit) { _, shows in
            if !shows { editing = false }
        }
    }
}

/// The scans as a row of thumbnails, each opening the viewer. `wraps` lays them in lines that
/// wrap rather than one row that scrolls sideways, for a page a mouse scrolls only up and down.
struct ScanStrip: View {
    let model: ScansModel
    let tuneID: String
    var wraps = false

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.spacing) private var spacing

    var body: some View {
        Group {
            if wraps {
                FlowLayout(spacing: spacing(12), lineSpacing: spacing(12)) { tiles }
            } else {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: spacing(12)) { tiles }
                        .padding(.vertical, spacing(4))
                }
                .scrollIndicators(.hidden)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(ScanCopy.scans)
    }

    private var tiles: some View {
        ForEach(Array(model.scans.enumerated()), id: \.element.id) { index, scan in
            tile(scan, index: index)
        }
    }

    private func tile(_ scan: Scan, index: Int) -> some View {
        let status = ScanCopy.status(for: scan)
        let width = ScansSection.thumbnailHeight * scan.aspectRatio
        return VStack(alignment: .leading, spacing: spacing(4)) {
            Button {
                ScansSection.open(tuneID: tuneID, index: index, actions: actions)
            } label: {
                ScanThumbnail(scan: scan, index: index, height: ScansSection.thumbnailHeight)
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
}

/// A row per scan to reorder and delete, in edit mode.
struct ScanEditRows: View {
    let model: ScansModel
    @Binding var deleting: Scan?

    @Environment(\.spacing) private var spacing
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let scans = model.scans
        ForEach(Array(scans.enumerated()), id: \.element.id) { index, scan in
            editRow(scan, index: index, count: scans.count)
                .scaledRowInsets()
        }
        .onMove { indices, offset in
            guard indices.count == 1, let from = indices.first else { return }
            model.move(from: from, to: MovePlace.dropTarget(from: from, offset: offset))
        }
    }

    private func editRow(_ scan: Scan, index: Int, count: Int) -> some View {
        let status = ScanCopy.status(for: scan)
        let reorderable = count > 1
        return HStack(spacing: spacing(12)) {
            ScanThumbnail(scan: scan, index: index, height: ScansSection.rowThumbnailHeight)
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
            #if os(macOS)
                .help(ScanCopy.deleteScan(index))
            #endif
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
        #if os(macOS)
            .help(ScanCopy.reorderScan(index))
        #endif
    }
}
