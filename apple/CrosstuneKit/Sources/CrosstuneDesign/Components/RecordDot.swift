import SwiftUI

/// The record color's dot, the glyph a button that starts a recording leads its words with.
package struct RecordDot: View {
    package init() {}

    package var body: some View {
        Circle()
            .fill(Palette.record)
            .frame(width: 10, height: 10)
    }
}
