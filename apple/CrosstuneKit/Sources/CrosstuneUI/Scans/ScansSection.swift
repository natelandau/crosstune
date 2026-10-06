import CrosstuneStore
import SwiftUI

/// A tune's scans on its page: the thumbnails' sizes, and how a thumbnail opens the viewer.
enum ScansSection {
    static let thumbnailHeight: CGFloat = 120
    static let rowThumbnailHeight: CGFloat = 44

    /// Opens the viewer on the scan at `index`, logged as opened from the tune screen.
    @MainActor
    static func open(tuneID: String, index: Int, actions: TuneScreenActions) {
        actions.viewScans?(tuneID, index, .tune)
    }
}

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

/// The scans as thumbnails in lines that wrap, each opening the viewer, so the page scrolls only
/// up and down.
struct ScanStrip: View {
    let model: ScansModel
    let tuneID: String

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.scanZoom) private var scanZoom
    @Environment(\.spacing) private var spacing

    var body: some View {
        FlowLayout(spacing: spacing(12), lineSpacing: spacing(12)) { tiles }
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
            .zoomSource(id: ScanScreens.sourceID(tuneID: tuneID, index: index), in: scanZoom)
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

    var body: some View {
        let scans = model.scans
        ForEach(Array(scans.enumerated()), id: \.element.id) { index, scan in
            editRow(scan, index: index, count: scans.count)
        }
    }

    private func editRow(_ scan: Scan, index: Int, count: Int) -> some View {
        let status = ScanCopy.status(for: scan)
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
            if count > 1 {
                moveMenu(scan, index: index)
            }
        }
    }

    /// Moves the scan to another place in the order, the one way to reorder scans.
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
