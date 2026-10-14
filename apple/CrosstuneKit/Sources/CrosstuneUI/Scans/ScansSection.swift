import SwiftUI

/// A tune's scans on its page: the thumbnails' sizes, and how a thumbnail opens the viewer.
enum ScansSection {
    private static let compactThumbnailHeight: CGFloat = 120
    static let rowThumbnailHeight: CGFloat = 44

    /// The page's thumbnail height: taller at regular width on iOS, where the page has room.
    static func thumbnailHeight(regular: Bool) -> CGFloat {
        #if os(iOS)
            regular ? PadStyle.scanThumbnailHeight : compactThumbnailHeight
        #else
            compactThumbnailHeight
        #endif
    }

    /// Opens the viewer on the scan at `index`, logged as opened from the tune screen.
    @MainActor
    static func open(tuneID: String, index: Int, actions: TuneScreenActions) {
        actions.viewScans?(tuneID, index, .tune)
    }

    /// A thumbnail's tap: the viewer for a scan the plan opens, else the Plan sheet.
    @MainActor
    static func tap(opens: Bool, tuneID: String, index: Int, actions: TuneScreenActions, premium: PremiumPresenter?) {
        if opens {
            open(tuneID: tuneID, index: index, actions: actions)
        } else {
            _ = premium?.gate(.scans, from: .scan)
        }
    }

    /// Whether a thumbnail's tap has anything to do, so one with nothing is disabled.
    @MainActor
    static func tileActs(opens: Bool, actions: TuneScreenActions, premium: PremiumPresenter?) -> Bool {
        opens ? actions.viewScans != nil : premium != nil
    }

    /// Add on a tune whose scans do not open.
    @MainActor
    static func offerPremiumForAdd(_ premium: PremiumPresenter?) {
        _ = premium?.gate(.scans, from: .addScan)
    }
}

/// The Scans header's controls: Edit or Done once there is a scan to act on, then add.
struct ScanHeaderControls: View {
    let model: ScansModel
    @Binding var editing: Bool
    @Binding var adding: ScanAddChoice?

    @Environment(\.spacing) private var spacing
    @Environment(\.premium) private var premium

    var body: some View {
        let layout = model.layout
        HStack(spacing: spacing(4)) {
            if layout.showsEdit {
                Button(editing ? ScanCopy.done : ScanCopy.edit) { editing.toggle() }
                    .font(.body)
                    .accessibilityLabel(editing ? ScanCopy.doneEditingScans : ScanCopy.editScans)
            }
            ScanAddMenu(
                isEnabled: layout.canAdd && !model.isAdding && (!layout.gatesAdd || premium != nil),
                choice: $adding, onGate: layout.gatesAdd ? offerPremium : nil)
        }
        .onChange(of: layout.showsEdit) { _, shows in
            if !shows { editing = false }
        }
    }

    private func offerPremium() {
        ScansSection.offerPremiumForAdd(premium)
    }
}

/// The scans as thumbnails in lines that wrap, each opening the viewer, so the page scrolls only
/// up and down.
struct ScanStrip: View {
    let model: ScansModel
    let tuneID: String

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.premium) private var premium
    @Environment(\.scanZoom) private var scanZoom
    @Environment(\.spacing) private var spacing
    /// The split's columns report a compact width even on a wide iPad.
    @Environment(\.inPadSplit) private var inPadSplit

    var body: some View {
        let height = tileHeight
        let opens = model.opens
        FlowLayout(spacing: spacing(12), lineSpacing: spacing(12)) {
            ForEach(Array(model.scans.enumerated()), id: \.element.id) { index, scan in
                tile(scan, index: index, height: height, opens: opens)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(ScanCopy.scans)
    }

    private var tileHeight: CGFloat {
        #if os(iOS)
            ScansSection.thumbnailHeight(regular: inPadSplit)
        #else
            ScansSection.thumbnailHeight(regular: false)
        #endif
    }

    /// A scan the plan does not open stays in place, dimmed, and a tap offers Premium.
    private func tile(_ scan: Scan, index: Int, height: CGFloat, opens: Bool) -> some View {
        let status = ScanCopy.status(for: scan)
        let width = height * scan.aspectRatio
        return VStack(alignment: .leading, spacing: spacing(4)) {
            Button {
                ScansSection.tap(opens: opens, tuneID: tuneID, index: index, actions: actions, premium: premium)
            } label: {
                ScanThumbnail(scan: scan, index: index, height: height)
                    .clipShape(.rect(cornerRadius: 6))
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .zoomSource(id: ScanScreens.sourceID(tuneID: tuneID, index: index), in: scanZoom)
            .disabled(!ScansSection.tileActs(opens: opens, actions: actions, premium: premium))
            .accessibilityLabel(ScanCopy.thumbnailName(index, opens: opens))
            .accessibilityHint(status ?? "")
            if let status {
                Text(status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityHidden(true)
            }
        }
        .opacity(opens ? 1 : MediaRow.dimmedOpacity)
        // A note under a narrow scan widens its column rather than standing one word to a line.
        .frame(width: status == nil ? width : max(width, 128), alignment: .leading)
    }
}

/// A row per scan to reorder and delete, in edit mode. Scans the plan does not open only delete.
struct ScanEditRows: View {
    let model: ScansModel
    @Binding var deleting: Scan?

    @Environment(\.spacing) private var spacing

    var body: some View {
        let scans = model.scans
        let layout = model.layout
        ForEach(Array(scans.enumerated()), id: \.element.id) { index, scan in
            editRow(scan, index: index, count: scans.count, layout: layout)
        }
    }

    private func editRow(_ scan: Scan, index: Int, count: Int, layout: ScansSectionLayout) -> some View {
        let status = ScanCopy.status(for: scan)
        return HStack(spacing: spacing(12)) {
            ScanThumbnail(scan: scan, index: index, height: ScansSection.rowThumbnailHeight)
                .clipShape(.rect(cornerRadius: 4))
                .opacity(layout.dimsScans ? MediaRow.dimmedOpacity : 1)
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
            if count > 1 && layout.showsReorder {
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
