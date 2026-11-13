import CrosstuneDesign
import SwiftUI

/// The files an export has finished and the files it has to prepare.
struct ExportProgress: Equatable, Sendable {
    var done: Int
    var total: Int
}

/// An export's progress, with the step under way once it is known. With `progress` the bar fills
/// as files finish; without it, the view shows only that the export is under way.
struct ExportProgressView: View {
    let text: String?
    var progress: ExportProgress?

    var body: some View {
        // A nil value draws the indeterminate style, so the view keeps its identity once the
        // count is known.
        ProgressView(value: progress.map { Double($0.done) }, total: Double(progress?.total ?? 1)) { label }
            #if os(macOS)
                .progressViewStyle(.linear)
            #endif
    }

    @ViewBuilder private var label: some View {
        if let text {
            #if os(macOS)
                Text(text)
                    .font(MacStyle.secondary)
                    .foregroundStyle(Palette.textSecondary)
                    .monospacedDigit()
            #else
                Text(text)
            #endif
        }
    }
}
