import SwiftUI

/// The size a button is drawn at.
package enum ButtonSize: Equatable, Sendable {
    case compact, regular, large, text
}

/// The drawn sizes and corner radii every iPhone control reads.
package enum ControlMetrics {
    package static let compactHeight: CGFloat = 32
    package static let regularHeight: CGFloat = 40
    package static let largeHeight: CGFloat = 50
    package static let rowHeight: CGFloat = 44
    package static let tabHeight: CGFloat = 52
    package static let featureDiameter: CGFloat = 72
    /// The play disc of a transport in a bar.
    package static let inlinePlayDiameter: CGFloat = 32
    package static let recordDiameter: CGFloat = 80
    package static let containerRadius: CGFloat = 12
    /// How far a text button draws its words in from its sides at the default text size.
    package static let textButtonInset: CGFloat = 12
    /// How far a touch moves before it drags a handle or a span rather than tapping.
    package static let dragThreshold: Double = 8
    package static let pressedOpacity: Double = 0.6
    /// The pressed dim of a tile, such as the key tile.
    package static let tilePressedOpacity: Double = 0.7
    package static let disabledSurfaceOpacity: Double = 0.5

    /// Nil for a large button, which spans the full width.
    package static func minWidth(_ size: ButtonSize) -> CGFloat? {
        switch size {
        case .compact: 60
        case .regular: 80
        case .large: nil
        case .text: 44
        }
    }
}
