import SwiftUI

/// A tool on the recording screen's strip.
enum RecordingTool: Hashable, CaseIterable {
    case trim
    case practice

    var label: String {
        switch self {
        case .trim: RecordingScreenText.trim
        case .practice: PracticeText.practice
        }
    }

    var systemImage: String {
        switch self {
        case .trim: "scissors"
        case .practice: "repeat"
        }
    }
}

/// One tool as the strip shows it.
struct ToolStripItem: Hashable {
    let tool: RecordingTool
    /// Shown only away from the tool's default, as "75% · +2" under Practice.
    var value: String?
    /// Why the tool cannot be used now; the tool stays in reach and shows this.
    var blocker: String?

    /// The recording screen's tools: Trim, and Practice with the speed and pitch away from
    /// their defaults.
    static func recordingScreen(
        trimBlocker: String?, practiceBlocker: String?, speedPercent: Int, pitchCents: Int
    ) -> [ToolStripItem] {
        [
            ToolStripItem(tool: .trim, blocker: trimBlocker),
            ToolStripItem(
                tool: .practice,
                value: RecordingScreenText.practiceBadge(speedPercent: speedPercent, pitchCents: pitchCents),
                blocker: practiceBlocker),
        ]
    }
}

/// The recording screen's tools in one row that scrolls sideways once more tools than fit are
/// added. Each opens its own screen.
struct ToolStrip: View {
    let items: [ToolStripItem]
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
            .foregroundStyle(.primary)
            .padding(.horizontal, 12)
            .frame(minWidth: 88, minHeight: 56)
            .background(neutralFill(colorScheme), in: .rect(cornerRadius: 12))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(item.blocker != nil)
        .opacity(item.blocker != nil ? 0.5 : 1)
        .accessibilityElement(children: .combine)
    }
}
