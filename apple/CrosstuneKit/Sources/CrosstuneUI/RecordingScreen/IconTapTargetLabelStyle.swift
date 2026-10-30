import CrosstuneDesign
import SwiftUI

/// The icon alone, as `.iconOnly` shows it, taking taps across 44 points on a touch screen. The
/// target is on the icon rather than around the button, since a button takes taps only on its
/// label.
struct IconTapTargetLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        // Built on `.iconOnly`, which keeps the title as the name VoiceOver reads.
        Label {
            configuration.title
        } icon: {
            configuration.icon
                #if os(iOS)
                    .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                    .contentShape(.rect)
                #endif
        }
        .labelStyle(.iconOnly)
    }
}

extension LabelStyle where Self == IconTapTargetLabelStyle {
    static var iconTapTarget: IconTapTargetLabelStyle { IconTapTargetLabelStyle() }
}
