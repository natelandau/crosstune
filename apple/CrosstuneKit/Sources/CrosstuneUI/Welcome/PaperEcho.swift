import SwiftUI

/// The folded tune list a player keeps in the case, with a small phone over it showing the same
/// tunes sorted by key, in the proportions of the web sign-in picture. Decorative: the headline
/// says the same thing in words. Fixed in size, so the welcome screen drops it at the
/// accessibility text sizes rather than let it crowd the words.
struct PaperEcho: View {
    /// One em of the web picture; every length below is a multiple of it.
    var unit: CGFloat = 12

    private struct Entry: Hashable {
        var text: String
        var note: String?
        var struck = false
    }

    /// The site's paper list, line for line, so the app and crosstune.app tell one story.
    private static let paper: [Entry] = [
        Entry(text: "A: Cluck Old Hen"),
        Entry(text: "Sally Goodin"),
        Entry(text: "Kitchen Girl", struck: true),
        Entry(text: "Breaking Up Xmas", note: "learn!"),
        Entry(text: "D: Soldier's Joy"),
        Entry(text: "Forked Deer"),
        Entry(text: "Bonaparte's", note: "DDAD"),
        Entry(text: "G: Sandy River Belle"),
        Entry(text: "", note: "ask Ann for recording"),
    ]

    private static let groups: [(key: String, rows: [String])] = [
        ("A", ["known", "known", "learning"]),
        ("D", ["known", "known", "learning"]),
    ]

    private static let clay = Color(.sRGB, red: 0x9F / 255, green: 0x70 / 255, blue: 0x65 / 255)

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack(alignment: .topLeading) {
            paperSheet
                .rotationEffect(.degrees(-6))
                .offset(x: 0.5 * unit, y: 0.6 * unit)
            // Over the paper's right margin only, clear of its longest line.
            phone
                .offset(x: 14.6 * unit, y: 4.4 * unit)
        }
        .frame(width: 22.4 * unit, height: 17 * unit, alignment: .topLeading)
        // Pinned so the key pills inside keep the drawing's proportions at every text size.
        .dynamicTypeSize(.large)
        .accessibilityHidden(true)
    }

    // MARK: The paper

    private var isDark: Bool { colorScheme == .dark }

    private var paperFill: Color { isDark ? Color(white: 0.11) : .white }

    private var paperEdge: Color { isDark ? Color(white: 0.24) : Color(white: 0.84) }

    private var paperRule: Color {
        isDark
            ? Color(.sRGB, red: 0.24, green: 0.27, blue: 0.33)
            : Color(.sRGB, red: 0.81, green: 0.84, blue: 0.90)
    }

    private var paperSheet: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Self.paper, id: \.self) { entry in
                paperLine(entry)
                    .padding(.bottom, 0.25 * unit)
                    .frame(height: 1.4 * unit, alignment: .bottomLeading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(paperRule).frame(height: 1)
                    }
            }
        }
        .padding(.vertical, 0.7 * unit)
        .padding(.horizontal, 1 * unit)
        .frame(width: 14.8 * unit, height: 14.6 * unit, alignment: .topLeading)
        .background(paperFill)
        .overlay {
            Path { path in
                path.move(to: .zero)
                path.addLine(to: CGPoint(x: 14.8 * unit, y: 0))
            }
            .stroke(paperEdge, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            .frame(height: 1)
        }
        .border(paperEdge, width: 1)
        .shadow(color: .black.opacity(0.22), radius: 0.8 * unit, y: 0.6 * unit)
    }

    private func paperLine(_ entry: Entry) -> some View {
        HStack(spacing: 0.3 * unit) {
            if !entry.text.isEmpty {
                Text(entry.text)
                    .strikethrough(entry.struck, color: Self.clay)
                    .foregroundStyle(.secondary)
            }
            if let note = entry.note {
                Text(note).foregroundStyle(Self.clay)
            }
        }
        .font(.system(size: unit))
        .lineLimit(1)
        .fixedSize()
    }

    // MARK: The phone

    private var phoneBody: Color {
        isDark ? Color(white: 0.25) : Color(.sRGB, red: 0x2D / 255, green: 0x31 / 255, blue: 0x42 / 255)
    }

    private var phone: some View {
        let bezel = 0.3 * unit
        let screen = CGSize(width: 7.6 * unit - 2 * bezel, height: 12 * unit - 2 * bezel)
        // Drawn at twice the size and halved, so the key pills keep their real proportions.
        return
            app
            .frame(width: screen.width * 2, height: screen.height * 2, alignment: .top)
            .scaleEffect(0.5, anchor: .topLeading)
            .frame(width: screen.width, height: screen.height, alignment: .topLeading)
            .background(isDark ? Color.black : Color.white)
            .clipShape(.rect(cornerRadius: 1 * unit))
            .padding(bezel)
            .background(phoneBody, in: .rect(cornerRadius: 1.3 * unit))
            .shadow(color: .black.opacity(0.3), radius: 1 * unit, y: 0.8 * unit)
    }

    private var app: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule()
                .fill(.fill.tertiary)
                .frame(width: 5 * unit, height: 1 * unit)
                .padding(.bottom, 0.6 * unit)
            ForEach(Self.groups, id: \.key) { group in
                KeyPill(group.key, size: .compact)
                    .padding(.top, 0.6 * unit)
                    .padding(.bottom, 0.2 * unit)
                ForEach(Array(group.rows.enumerated()), id: \.offset) { _, status in
                    row(status)
                }
            }
        }
        .padding(.top, 1.6 * unit)
        .padding(.horizontal, 0.9 * unit)
    }

    private func row(_ status: String) -> some View {
        HStack(spacing: 0.6 * unit) {
            Circle()
                .fill(dotColor(status))
                .frame(width: 0.8 * unit, height: 0.8 * unit)
            Capsule()
                .fill(.fill.tertiary)
                .frame(height: 0.6 * unit)
            Circle()
                .fill(.fill.tertiary)
                .frame(width: 1.3 * unit, height: 1.3 * unit)
        }
        .padding(.vertical, 0.6 * unit)
        .overlay(alignment: .bottom) {
            Rectangle().fill(.separator).frame(height: 1)
        }
    }

    private func dotColor(_ status: String) -> Color {
        if case .filled(let color) = StatusStyle.dot(status) { return color }
        return .secondary
    }
}

#Preview("Paper echo") {
    PaperEcho()
        .padding()
}
