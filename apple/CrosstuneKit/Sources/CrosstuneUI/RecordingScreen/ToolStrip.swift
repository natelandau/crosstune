import SwiftUI

/// A tool on the recording screen's strip.
enum RecordingTool: Hashable, CaseIterable {
    case trim
    case speed
    case pitch

    var label: String {
        switch self {
        case .trim: RecordingScreenText.trim
        case .speed: RecordingScreenText.speed
        case .pitch: RecordingScreenText.pitch
        }
    }

    var systemImage: String {
        switch self {
        case .trim: "scissors"
        case .speed: "gauge.with.dots.needle.50percent"
        case .pitch: "music.note"
        }
    }
}

/// One tool as the strip shows it.
struct ToolStripItem: Hashable {
    let tool: RecordingTool
    /// Shown only away from the tool's default, as "75%" under Speed.
    var value: String?
    /// Why the tool cannot be used now; the tool stays in reach and shows this.
    var blocker: String?
}

/// The recording screen's tools in one row that scrolls sideways once more tools than fit are
/// added. A tool that opens a panel shows whether it is open.
struct ToolStrip: View {
    let items: [ToolStripItem]
    let selected: RecordingTool?
    let onSelect: (RecordingTool) -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(items, id: \.tool) { item in
                    button(item)
                }
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -16)
    }

    private func button(_ item: ToolStripItem) -> some View {
        let chosen = selected == item.tool
        let detail = item.blocker ?? item.value
        return Button {
            onSelect(item.tool)
        } label: {
            VStack(spacing: 2) {
                Label(item.tool.label, systemImage: item.tool.systemImage)
                    .font(.subheadline)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .monospacedDigit()
                }
            }
            .foregroundStyle(chosen ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .padding(.horizontal, 12)
            .frame(minWidth: 88, minHeight: 56)
            .background(chosen ? AnyShapeStyle(.tint) : neutralFill(colorScheme), in: .rect(cornerRadius: 12))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(item.blocker != nil)
        .opacity(item.blocker != nil ? 0.5 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}
