import CrosstuneDesign
import SwiftUI

/// Words for pinning the recording or link a tune plays first in lists.
public enum PlaySourceText {
    public static let playFirstInLists = "Play first in lists"
    public static let dontPlayFirst = "Don't play first"
    public static let playsFirst = "Plays first in lists"
}

/// The action that pins a row as the one its tune plays first in lists, or unpins it. Nothing
/// shows when `onTogglePin` is nil.
struct PinAction: View {
    let pinned: Bool
    let onTogglePin: (() -> Void)?

    var body: some View {
        if let onTogglePin {
            if pinned {
                Button(PlaySourceText.dontPlayFirst, systemImage: "pin.slash", action: onTogglePin)
            } else {
                Button(PlaySourceText.playFirstInLists, systemImage: "pin.fill", action: onTogglePin)
            }
        }
    }
}

/// The mark on a row its tune plays first in lists.
struct PinnedMark: View {
    var body: some View {
        Image(systemName: "pin.fill")
            .foregroundStyle(.textSecondary)
            .accessibilityLabel(PlaySourceText.playsFirst)
    }
}
