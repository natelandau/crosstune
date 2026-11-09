import SwiftUI

/// A tune's status as an SF symbol shape.
public struct StatusGlyph: View {
    private let status: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(_ status: String) {
        self.status = status
        #if !os(macOS)
            _settled = State(initialValue: status)
        #endif
    }

    public var body: some View {
        #if os(macOS)
            glyph(for: status)
        #else
            phoneBody
        #endif
    }

    private func glyph(for status: String) -> some View {
        let label = StatusStyle.label(status)

        return Image(systemName: Self.symbol(for: status))
            .font(PageStyle.body)
            .foregroundStyle(StatusGlyphStyle(status: status))
            .help(label)
            .accessibilityLabel(label)
            .contentTransition(
                reduceMotion ? .identity : .symbolEffect(.replace)
            )
            // A content transition plays only inside an animated change.
            .animation(reduceMotion ? nil : .default, value: StatusStyle.normalized(status))
    }

    /// Whether a change draws the arc closed before the glyph fills: only progress to known.
    nonisolated package static func drawsOnChange(from old: String, to new: String) -> Bool {
        StatusStyle.normalized(new) == "known" && StatusStyle.normalized(old) != "known"
    }

    #if !os(macOS)
        /// The last status drawn in full. While it differs from `status` and the change draws,
        /// the glyph keeps showing it under the closing arc.
        @State private var settled: String
        @State private var arc = 0.0
        @State private var drawing: Task<Void, Never>?

        private var isDrawing: Bool {
            guard !reduceMotion else { return false }
            return Self.drawsOnChange(from: settled, to: status)
        }

        private var phoneBody: some View {
            glyph(for: isDrawing ? settled : status)
                // Mounted at rest, so the arc's first change animates from its drawn start.
                .overlay {
                    Circle()
                        .trim(from: 0, to: arc)
                        .stroke(StatusGlyphStyle(status: status), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .padding(1.5)
                        .opacity(isDrawing ? 1 : 0)
                }
                // A row that settled on appear starts no work.
                .onAppear(perform: settle)
                .onChange(of: status) { settle() }
                .onDisappear {
                    drawing?.cancel()
                    drawing = nil
                }
        }

        /// Shows `status`, drawing the arc closed first when the change draws. A newer change
        /// cancels the draw in flight and takes over.
        private func settle() {
            drawing?.cancel()
            drawing = nil
            guard settled != status else { return }
            guard isDrawing else {
                settled = status
                arc = 0
                return
            }
            arc = 0
            withAnimation(Motion.draw) { arc = 1 }
            drawing = Task {
                do { try await Task.sleep(for: Motion.drawDuration) } catch { return }
                settled = status
                arc = 0
            }
        }
    #endif

    /// The SF symbol name for a status.
    public static func symbol(for status: String) -> String {
        switch StatusStyle.normalized(status) {
        case "known":
            "checkmark.circle.fill"
        case "learning":
            "circle.lefthalf.filled"
        default:
            "circle"
        }
    }
}

/// How a status glyph draws: its status color, darkened for the ring where it sits on a fill,
/// and white on an emphasized accent selection, where green, orange, and the ring's gray each
/// fall under 3:1. The check, the half fill, and the ring still carry the status.
package struct StatusGlyphStyle: ShapeStyle {
    package let status: String

    package init(status: String) {
        self.status = status
    }

    package enum Coloring: Equatable {
        case onAccentFill
        case status(Color)
        case ring(UnknownRing.Placement)
    }

    package func resolve(in environment: EnvironmentValues) -> Color {
        switch Self.coloring(status, in: environment) {
        case .onAccentFill: Palette.color(.onAccentFill)
        case .status(let color): color
        case .ring(let placement): Palette.color(hex: UnknownRing.hex(placement, scheme: environment.colorScheme))
        }
    }

    package static func coloring(_ status: String, in environment: EnvironmentValues) -> Coloring {
        if environment.backgroundProminence == .increased { return .onAccentFill }
        switch StatusStyle.dot(status) {
        case .filled(let color): return .status(color)
        case .ring: return .ring(UnknownRing.placement(in: environment))
        }
    }
}
